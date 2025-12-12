import React, { useRef, useEffect, useState } from 'react';
import { db } from '../../db/db';
import { recognizeShape, type DrawingElement, type Point } from '../../utils/geometry';
import { recognizeTextFromCanvas } from '../../utils/ocr';
import { v4 as uuidv4 } from 'uuid';
import { Undo, Eraser, Pen, Type, Save, ScanText, Eye, Link as LinkIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface MemoEditorProps {
    noteId: string;
    onBack: () => void;
    onLinkClick: (title: string) => void;
}

export const MemoEditor: React.FC<MemoEditorProps> = ({ noteId, onBack, onLinkClick }) => {
    const [mode, setMode] = useState<'text' | 'pen' | 'eraser' | 'view'>('pen');
    const [noteContent, setNoteContent] = useState('');
    const [elements, setElements] = useState<DrawingElement[]>([]);
    const [autoShape, setAutoShape] = useState(true);
    const [isProcessingOCR, setIsProcessingOCR] = useState(false);
    const [title, setTitle] = useState('');

    // New state for widths (Must be declared before use)
    const [penWidth, setPenWidth] = useState(3);
    const [eraserWidth, setEraserWidth] = useState(20);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const containerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Gesture state
    const activePointers = useRef<Map<number, { x: number, y: number, type: string }>>(new Map());
    const isPanning = useRef(false);

    // Drawing ref (for immediate updates without render lag)
    const currentStrokeRef = useRef<Point[]>([]);
    // Force render helper
    const [, setTick] = useState(0);

    const initialPinchDist = useRef<number>(0);
    const initialScale = useRef<number>(1);
    const lastCenter = useRef<{ x: number, y: number } | null>(null);

    useEffect(() => {
        db.notes.get(noteId).then(n => {
            if (n) {
                setTitle(n.title || '');
                setNoteContent(n.content || '');
                if (n.drawings) setElements(n.drawings);
            }
        });
    }, [noteId]);

    const saveNote = async () => {
        await db.notes.update(noteId, {
            title,
            content: noteContent,
            drawings: elements,
            updatedAt: Date.now()
        });
    };

    useEffect(() => {
        const timer = setInterval(saveNote, 3000);
        return () => {
            clearInterval(timer);
            saveNote();
        };
    }, [noteContent, elements, title]);

    // Constant for the infinite-ish canvas size
    // Note: 20000x20000 causes canvas crash. 5000x10000 was still heavy.
    // User requested 2000x4000 for better performance.
    const PAGE_SIZE = { width: 2000, height: 4000 };

    // Draw canvas
    const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);

    // 1. Init/Update Buffer when elements change
    useEffect(() => {
        // Create buffer if needed
        if (!bufferCanvasRef.current) {
            bufferCanvasRef.current = document.createElement('canvas');
            bufferCanvasRef.current.width = PAGE_SIZE.width;
            bufferCanvasRef.current.height = PAGE_SIZE.height;
        }
        const buffer = bufferCanvasRef.current;
        const ctx = buffer.getContext('2d');
        if (!ctx) return;

        // Clear buffer
        ctx.clearRect(0, 0, buffer.width, buffer.height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Render saved elements to buffer
        elements.forEach(el => {
            ctx.strokeStyle = el.color;
            ctx.lineWidth = el.width;

            if (el.type === 'stroke') {
                if (el.points.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(el.points[0].x, el.points[0].y);
                for (let i = 1; i < el.points.length; i++) {
                    ctx.lineTo(el.points[i].x, el.points[i].y);
                }
                ctx.stroke();
            } else if (el.type === 'line') {
                const { start, end } = el.params;
                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(end.x, end.y);
                ctx.stroke();
            } else if (el.type === 'circle') {
                const { x, y, radius } = el.params;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.stroke();
            } else if (el.type === 'rect') {
                const { x, y, width, height } = el.params;
                ctx.strokeRect(x, y, width, height);
            }
        });

        // Force screen update
        setTick(t => t + 1);

    }, [elements, PAGE_SIZE.width, PAGE_SIZE.height]);

    // 2. Render Screen (Fast Loop)
    useEffect(() => {
        const canvas = canvasRef.current;
        const buffer = bufferCanvasRef.current;
        if (!canvas || !buffer) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Ensure visible canvas matches page size (it should already)
        if (canvas.width !== PAGE_SIZE.width || canvas.height !== PAGE_SIZE.height) {
            canvas.width = PAGE_SIZE.width;
            canvas.height = PAGE_SIZE.height;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // A. Blit the Buffer (O(1) operation)
        ctx.drawImage(buffer, 0, 0);

        // B. Draw current stroke (Dynamic, usually small)
        const stroke = currentStrokeRef.current;
        if (stroke.length > 0) {
            ctx.strokeStyle = mode === 'eraser' ? '#ff0000' : 'black'; // Eraser still red trace
            ctx.lineWidth = mode === 'eraser' ? eraserWidth : penWidth;
            // Opacity for eraser trace to make it look like a "selection"
            if (mode === 'eraser') ctx.globalAlpha = 0.5;

            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            for (let i = 1; i < stroke.length; i++) {
                ctx.lineTo(stroke[i].x, stroke[i].y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
    }, [mode, penWidth, eraserWidth, setTick, PAGE_SIZE.width, PAGE_SIZE.height, elements]);

    // Coordinate helper: Screen -> Canvas Local
    const getLocalPoint = (client_x: number, client_y: number) => {
        if (!containerRef.current) return { x: 0, y: 0 };
        const rect = containerRef.current.getBoundingClientRect();
        const screenX = client_x - rect.left;
        const screenY = client_y - rect.top;
        const x = (screenX - transform.x) / transform.scale;
        const y = (screenY - transform.y) / transform.scale;
        return { x, y };
    };

    const dist = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    };

    const mid = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
        return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        e.preventDefault(); // Stop default touch actions
        e.stopPropagation();

        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
        e.currentTarget.setPointerCapture(e.pointerId);

        const pointers = Array.from(activePointers.current.values());

        // Pen priority: If Pen is down, we draw. Ignore multi-touch palm.
        const hasPen = pointers.some(p => p.type === 'pen');

        if (hasPen && e.pointerType === 'pen') {
            // Start Drawing with Pen
            if (['pen', 'eraser'].includes(mode)) {
                isPanning.current = false;
                currentStrokeRef.current = [getLocalPoint(e.clientX, e.clientY)];
                setTick(t => t + 1); // Trigger render
            }
            return;
        }

        // Touch logic
        if (pointers.length === 2 && !hasPen) {
            // Start Pinch/Pan (only if no pen)
            isPanning.current = true;
            currentStrokeRef.current = []; // Cancel drawing
            setTick(t => t + 1);

            initialPinchDist.current = dist(pointers[0], pointers[1]);
            initialScale.current = transform.scale;
            lastCenter.current = mid(pointers[0], pointers[1]);
        } else if (pointers.length === 1 && !hasPen) {
            // Start 1-finger Drawing (if mode is pen/eraser and not view)
            if (['pen', 'eraser'].includes(mode)) {
                isPanning.current = false;
                currentStrokeRef.current = [getLocalPoint(e.clientX, e.clientY)];
                setTick(t => t + 1);
            }
        }
    };

    const onPointerMove = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!activePointers.current.has(e.pointerId)) return;
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

        const pointers = Array.from(activePointers.current.values());
        const hasPen = pointers.some(p => p.type === 'pen');

        if (isPanning.current && pointers.length === 2 && lastCenter.current) {
            // Handle Zoom & Pan
            const newDist = dist(pointers[0], pointers[1]);
            const newCenter = mid(pointers[0], pointers[1]);

            const scaleFactor = newDist / initialPinchDist.current;
            let newScale = initialScale.current * scaleFactor;
            newScale = Math.min(Math.max(newScale, 0.1), 3);

            // Zoom-at-point & Clamping Logic
            const scaleRatio = newScale / transform.scale;
            const dx = newCenter.x - lastCenter.current.x;
            const dy = newCenter.y - lastCenter.current.y;

            let nextX = newCenter.x - (newCenter.x - transform.x) * scaleRatio + dx;
            let nextY = newCenter.y - (newCenter.y - transform.y) * scaleRatio + dy;

            if (containerRef.current) {
                const cw = containerRef.current.clientWidth;
                const ch = containerRef.current.clientHeight;
                const minX = cw - PAGE_SIZE.width * newScale;
                const minY = ch - PAGE_SIZE.height * newScale;

                if (minX < 0) nextX = Math.max(minX, Math.min(nextX, 0));
                else nextX = Math.max(0, Math.min(nextX, minX));

                if (minY < 0) nextY = Math.max(minY, Math.min(nextY, 0));
                else nextY = Math.max(0, Math.min(nextY, minY));
            }

            setTransform({
                scale: newScale,
                x: nextX,
                y: nextY
            });
            lastCenter.current = newCenter;
            return;
        }

        // Drawing Logic
        if (!isPanning.current && ['pen', 'eraser'].includes(mode)) {
            // Be stricter: only draw if this pointer is the one that started it?
            // Or just append.
            // If Pen exists, only process Pen events for drawing?
            if (hasPen && e.pointerType !== 'pen') return; // Ignore touch if pen is active

            if (currentStrokeRef.current.length > 0) {
                const pt = getLocalPoint(e.clientX, e.clientY);
                // Optimization: Don't add duplicate points
                const last = currentStrokeRef.current[currentStrokeRef.current.length - 1];
                if (Math.abs(last.x - pt.x) > 1 || Math.abs(last.y - pt.y) > 1) {
                    currentStrokeRef.current.push(pt);

                    // Direct canvas draw optimization (optional, but good for latency)
                    const canvas = canvasRef.current;
                    const ctx = canvas?.getContext('2d');
                    if (ctx) {
                        ctx.strokeStyle = mode === 'eraser' ? '#ff0000' : 'black';
                        ctx.lineWidth = mode === 'eraser' ? eraserWidth : penWidth;
                        if (mode === 'eraser') ctx.globalAlpha = 0.5;
                        ctx.beginPath();
                        ctx.moveTo(last.x, last.y);
                        ctx.lineTo(pt.x, pt.y);
                        ctx.stroke();
                        if (mode === 'eraser') ctx.globalAlpha = 1.0;
                    }
                }
            }
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        activePointers.current.delete(e.pointerId);
        e.currentTarget.releasePointerCapture(e.pointerId);

        if (activePointers.current.size < 2) {
            isPanning.current = false;
            lastCenter.current = null;
        }

        if (currentStrokeRef.current.length > 0) {
            if (e.pointerType === 'pen' || activePointers.current.size === 0) {
                commitStroke();
            }
        }
    };

    // ... (refs)

    // Helper to check if a point is close to a segment
    // Simplified: Check if point is close to any point in the stroke
    const isPointNearStroke = (point: Point, stroke: Point[], threshold: number) => {
        // Fast bounding box check
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of stroke) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        if (point.x < minX - threshold || point.x > maxX + threshold ||
            point.y < minY - threshold || point.y > maxY + threshold) return false;

        // Detailed check
        for (const p of stroke) {
            const d = Math.sqrt(Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2));
            if (d < threshold) return true;
        }
        return false;
    };

    const isStrokeNearStroke = (stroke1: Point[], stroke2: Point[], threshold: number) => {
        // Check if any point in stroke1 is near stroke2
        // Optimization: Check only a subset of points or bounding boxes
        for (let i = 0; i < stroke1.length; i += 2) { // Skip some points for speed
            if (isPointNearStroke(stroke1[i], stroke2, threshold)) return true;
        }
        return false;
    };

    const commitStroke = () => {
        const stroke = currentStrokeRef.current;
        if (stroke.length === 0) return;

        if (mode === 'eraser') {
            // Object Eraser Logic
            const threshold = eraserWidth / 2;
            setElements(prev => prev.filter(el => {
                if (el.type !== 'stroke') return true; // TODO: Support erasing shapes
                // Check intersection
                if (isStrokeNearStroke(stroke, el.points, threshold + (el.width || 2) / 2)) {
                    return false; // Remove element
                }
                return true;
            }));

            currentStrokeRef.current = [];
            setTick(t => t + 1);
            return;
        }

        let newElement: DrawingElement = {
            type: 'stroke',
            points: stroke,
            color: 'black',
            width: penWidth,
            id: uuidv4(),
            // @ts-ignore
            params: {}
        };

        if (autoShape) {
            const shape = recognizeShape(stroke);
            if (shape) {
                newElement = { ...newElement, ...shape } as DrawingElement;
            }
        }

        setElements(prev => [...prev, newElement]);
        currentStrokeRef.current = [];
        setTick(t => t + 1);
    };

    const handleOCR = async () => {
        if (!canvasRef.current) return;
        setIsProcessingOCR(true);
        try {
            const text = await recognizeTextFromCanvas(canvasRef.current);
            if (text) {
                if (confirm(`Convert handwriting to text?\n\n"${text}"`)) {
                    setNoteContent(prev => prev + (prev ? '\n' : '') + text);
                    setElements([]);
                    setMode('text');
                }
            } else {
                alert("No text detected.");
            }
        } catch (e) {
            console.error(e);
            alert("OCR failed.");
        } finally {
            setIsProcessingOCR(false);
        }
    };

    const insertLink = () => {
        if (!textareaRef.current) return;
        const start = textareaRef.current.selectionStart;
        const end = textareaRef.current.selectionEnd;
        const text = noteContent;
        const selection = text.substring(start, end);
        if (!selection) return;

        const newText = text.substring(0, start) + `[[${selection}]]` + text.substring(end);
        setNoteContent(newText);
        setMode('view');
    };

    const renderContentView = () => {
        const parts = noteContent.split(/(\[\[.*?\]\])/g);
        return parts.map((part, i) => {
            if (part.startsWith('[[') && part.endsWith(']]')) {
                const content = part.slice(2, -2);
                return (
                    <span
                        key={i}
                        className="text-blue-600 underline cursor-pointer hover:text-blue-800"
                        onClick={(e) => {
                            e.stopPropagation();
                            onLinkClick(content);
                        }}
                    >
                        {content}
                    </span>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };


    return (
        <div className="flex flex-col h-full bg-white relative overflow-hidden">
            {/* Toolbar (Fixed) */}
            <div className="flex items-center gap-2 p-2 px-4 border-b bg-muted/20 z-50 overflow-x-auto shrink-0 relative shadow-sm">
                <button onClick={onBack} className="p-2 hover:bg-muted text-sm font-bold flex items-center gap-1">Back</button>
                <div className="h-6 w-px bg-border mx-2" />
                <button onClick={() => setMode('view')} className={cn("p-2 rounded", mode === 'view' && "bg-primary/20 text-primary")} title="Read/Pan Mode"><Eye size={20} /></button>
                <button onClick={() => setMode('text')} className={cn("p-2 rounded", mode === 'text' && "bg-primary/20 text-primary")} title="Text Mode"><Type size={20} /></button>
                <button onClick={() => setMode('pen')} className={cn("p-2 rounded", mode === 'pen' && "bg-primary/20 text-primary")} title="Pen Mode"><Pen size={20} /></button>
                <button onClick={() => setMode('eraser')} className={cn("p-2 rounded", mode === 'eraser' && "bg-destructive/10 text-destructive")} title="Eraser Mode"><Eraser size={20} /></button>

                {/* Width Slider (Only for Pen/Eraser) */}
                {(mode === 'pen' || mode === 'eraser') && (
                    <div className="flex items-center gap-2 ml-2 bg-white/50 p-1 rounded border">
                        <div className={cn("w-2 h-2 rounded-full bg-black", mode === 'eraser' && "bg-red-500")}
                            style={{ width: mode === 'pen' ? penWidth : eraserWidth / 3, height: mode === 'pen' ? penWidth : eraserWidth / 3 }} />
                        <input
                            type="range"
                            min={mode === 'pen' ? "1" : "5"}
                            max={mode === 'pen' ? "20" : "50"}
                            value={mode === 'pen' ? penWidth : eraserWidth}
                            onChange={e => mode === 'pen' ? setPenWidth(Number(e.target.value)) : setEraserWidth(Number(e.target.value))}
                            className="w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                )}
                <div className="h-6 w-px bg-border mx-2" />
                <label className="flex items-center gap-2 text-xs select-none cursor-pointer">
                    <input type="checkbox" checked={autoShape} onChange={e => setAutoShape(e.target.checked)} />
                    <span>Shape</span>
                </label>
                <div className="flex-1" />
                {mode === 'text' && <button onClick={insertLink} className="p-2 hover:bg-muted"><LinkIcon size={18} /></button>}
                <button onClick={handleOCR} disabled={isProcessingOCR} className="p-2 hover:bg-muted"><ScanText size={18} /></button>
                <button onClick={() => setElements(e => e.slice(0, -1))} className="p-2 hover:bg-muted"><Undo size={18} /></button>
                <button onClick={saveNote} className="p-2 hover:bg-muted text-primary"><Save size={18} /></button>
            </div>

            {/* Main Title Input (Fixed below toolbar) */}
            <div className="px-4 py-2 z-40 bg-white border-b">
                <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Title"
                    className="text-2xl font-bold w-full outline-none"
                />
            </div>

            {/* Canvas Container - The Viewport */}
            <div
                className="flex-1 relative overflow-hidden bg-gray-50 touch-none"
                ref={containerRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
            >
                {/* Transformed Layer - Huge Page */}
                <div
                    style={{
                        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                        transformOrigin: '0 0',
                        width: PAGE_SIZE.width,
                        height: PAGE_SIZE.height,
                        willChange: 'transform',
                        backgroundColor: 'white', // Ensure it looks like paper
                        boxShadow: '0 0 20px rgba(0,0,0,0.1)' // Boundary visual
                    }}
                >
                    {/* Text Content Layer */}
                    <div className={cn("absolute inset-0 p-6 whitespace-pre-wrap leading-loose text-lg font-mono", mode === 'text' && "hidden")}>
                        {renderContentView()}
                    </div>

                    <textarea
                        ref={textareaRef}
                        className={cn("absolute inset-0 w-full h-full p-6 bg-transparent resize-none outline-none leading-loose text-lg font-mono", mode !== 'text' && "hidden")}
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        placeholder="Start typing..."
                    />

                    <canvas
                        ref={canvasRef}
                        className={cn("absolute inset-0 pointer-events-none")} // Pointer events handled by container
                    />
                </div>

                {/* Info Overlay (Debug/Status) */}
                <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded pointer-events-none">
                    {Math.round(transform.scale * 100)}%
                </div>
            </div>
        </div>
    );
};
