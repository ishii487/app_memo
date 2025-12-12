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
    const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
    const [autoShape, setAutoShape] = useState(true);
    const [isProcessingOCR, setIsProcessingOCR] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        db.notes.get(noteId).then(n => {
            if (n) {
                setNoteContent(n.content || '');
                if (n.drawings) setElements(n.drawings);
            }
        });
    }, [noteId]);

    const saveNote = async () => {
        await db.notes.update(noteId, {
            content: noteContent,
            drawings: elements,
            updatedAt: Date.now()
        });
    };

    useEffect(() => {
        const timer = setInterval(saveNote, 5000);
        return () => {
            clearInterval(timer);
            saveNote();
        };
    }, [noteContent, elements]);

    // State for gestures
    const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
    const isPanning = useRef(false);

    // ... (useEffect for db loading and saveNote remain same)

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Resize handling
        // We need to ensure canvas matches specific dimensions or container size
        // If containerRef updates, we might lose drawing if we just reset width/height.
        // For now, assume fixed or handled by container.
        if (containerRef.current) {
            // Only set if different to avoid clearing
            if (canvas.width !== containerRef.current.clientWidth || canvas.height !== containerRef.current.clientHeight) {
                canvas.width = containerRef.current.clientWidth;
                canvas.height = containerRef.current.clientHeight;
            }
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw saved elements
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

        // Draw current stroke
        if (currentStroke.length > 0) {
            ctx.strokeStyle = mode === 'eraser' ? '#ff0000' : 'black';
            ctx.lineWidth = mode === 'eraser' ? 10 : 2;
            ctx.beginPath();
            ctx.moveTo(currentStroke[0].x, currentStroke[0].y);
            for (let i = 1; i < currentStroke.length; i++) {
                ctx.lineTo(currentStroke[i].x, currentStroke[i].y);
            }
            ctx.stroke();
        }
    }, [elements, currentStroke, mode, containerRef.current?.clientWidth, containerRef.current?.clientHeight]);

    const getPoint = (e: React.PointerEvent) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        // Track pointer
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);

        // Check gesture state
        if (activePointers.current.size === 2) {
            // Switch to panning
            isPanning.current = true;
            setCurrentStroke([]); // Cancel drawing
            return;
        }

        // If panning, do nothing else
        if (isPanning.current) return;

        // Drawing logic
        if (mode === 'text' || mode === 'view') return;

        // Only start stroke if 1 pointer
        if (activePointers.current.size === 1) {
            setCurrentStroke([getPoint(e)]);
        }
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const prev = activePointers.current.get(e.pointerId);
        if (prev) {
            // Update pointer pos
            activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (isPanning.current && containerRef.current) {
                // Manual Scroll
                const dx = e.clientX - prev.x;
                const dy = e.clientY - prev.y;
                containerRef.current.scrollLeft -= dx;
                containerRef.current.scrollTop -= dy;
                return;
            }
        }

        if (isPanning.current) return;
        if (mode === 'text' || mode === 'view') return;

        // Drawing: we rely on currentStroke having content (initiated by Down)
        // rather than checking e.buttons which can be flaky on mobile
        if (currentStroke.length > 0) {
            setCurrentStroke(prev => [...prev, getPoint(e)]);
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        activePointers.current.delete(e.pointerId);
        e.currentTarget.releasePointerCapture(e.pointerId);

        if (activePointers.current.size < 2) {
            isPanning.current = false;
        }

        if (isPanning.current) return;
        if (mode === 'text' || mode === 'view') return;

        // Finish drawing
        if (currentStroke.length === 0) return;

        if (mode === 'eraser') {
            setCurrentStroke([]);
            return;
        }

        let startStroke = currentStroke;
        let newElement: DrawingElement = {
            type: 'stroke',
            points: startStroke,
            color: 'black',
            width: 2,
            id: uuidv4(),
            // @ts-ignore
            params: {}
        };

        if (autoShape) {
            const shape = recognizeShape(startStroke);
            if (shape) {
                newElement = {
                    ...shape,
                    color: 'black',
                    width: 2,
                    id: uuidv4()
                } as DrawingElement;
            }
        }

        setElements(prev => [...prev, newElement]);
        setCurrentStroke([]);
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
        <div className="flex flex-col h-full bg-white relative">
            <div className="flex items-center gap-2 p-2 px-4 border-b bg-muted/20 z-20 overflow-x-auto shrink-0">
                <button onClick={onBack} className="p-2 hover:bg-muted text-sm font-bold flex items-center gap-1">
                    Back
                </button>
                <div className="h-6 w-px bg-border mx-2" />

                <button onClick={() => setMode('view')} className={cn("p-2 rounded", mode === 'view' && "bg-primary/20 text-primary")} title="Read Mode">
                    <Eye size={20} />
                </button>
                <button onClick={() => setMode('text')} className={cn("p-2 rounded", mode === 'text' && "bg-primary/20 text-primary")} title="Text Mode">
                    <Type size={20} />
                </button>
                <button onClick={() => setMode('pen')} className={cn("p-2 rounded", mode === 'pen' && "bg-primary/20 text-primary")} title="Pen Mode">
                    <Pen size={20} />
                </button>
                <button onClick={() => setMode('eraser')} className={cn("p-2 rounded", mode === 'eraser' && "bg-destructive/10 text-destructive")} title="Eraser Mode">
                    <Eraser size={20} />
                </button>

                <div className="h-6 w-px bg-border mx-2" />
                <label className="flex items-center gap-2 text-xs select-none cursor-pointer" title="Auto-correct shapes">
                    <input type="checkbox" checked={autoShape} onChange={e => setAutoShape(e.target.checked)} />
                    <span className="hidden sm:inline">Shape</span>
                </label>

                <div className="flex-1" />

                {mode === 'text' && (
                    <button onClick={insertLink} className="p-2 hover:bg-muted flex gap-1 items-center" title="Make Link">
                        <LinkIcon size={18} />
                        <span className="text-xs hidden sm:inline">Link</span>
                    </button>
                )}

                <button
                    onClick={handleOCR}
                    disabled={isProcessingOCR}
                    className={cn("p-2 hover:bg-muted flex items-center gap-1", isProcessingOCR && "opacity-50")} title="OCR"
                >
                    <ScanText size={18} />
                </button>

                <button onClick={() => setElements(e => e.slice(0, -1))} className="p-2 hover:bg-muted" title="Undo">
                    <Undo size={18} />
                </button>
                <button onClick={saveNote} className="p-2 hover:bg-muted text-primary">
                    <Save size={18} />
                </button>
            </div>

            <div className="flex-1 relative overflow-hidden bg-white" ref={containerRef}>
                <div
                    className={cn(
                        "absolute inset-0 w-full h-full p-6 z-10 overflow-auto whitespace-pre-wrap leading-loose text-lg font-mono",
                        mode === 'text' && "hidden"
                    )}
                >
                    {renderContentView()}
                </div>

                <textarea
                    ref={textareaRef}
                    className={cn(
                        "absolute inset-0 w-full h-full p-6 bg-transparent z-10 resize-none outline-none leading-loose text-lg font-mono",
                        mode !== 'text' && "hidden"
                    )}
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Start typing..."
                />

                <canvas
                    ref={canvasRef}
                    className={cn(
                        "absolute inset-0 z-0 touch-none", // Keeping touch-none, manual scroll handling
                        mode === 'view' && "pointer-events-none"
                    )}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                    style={{
                        cursor: mode === 'pen' ? 'crosshair' : 'default',
                        pointerEvents: (mode === 'pen' || mode === 'eraser') ? 'auto' : 'none',
                        // Ensure canvas is large enough. Actually we might need it to follow scroll?
                        // If we are scrolling the CONTAINER, the canvas behaves like a fixed background if current CSS.
                        // Wait, we need the canvas to scroll WITH the content?
                        // If "absolute inset-0", it's sized to parent. 
                        // If parent scrolls, does absolute move? 
                        // If parent `overflow: hidden`, and we manipulate scrollLeft/Top, the CHILDREN need to be larger?
                        // Actually logic is: Container is fixed size window. Canvas is window. 
                        // If we "scroll", we typically mean we want a larger virtual canvas.
                        // BUT for now, let's assume "page" is just the viewport size or whatever fits.
                        // OR we assume standard scrolling.
                        // IF we manual scroll, what are we scrolling? 
                        // `containerRef` has `overflow: hidden` (from `overflow-hidden` class).
                        // So setting scrollTop does nothing unless content is larger.

                        // FIX: We probably want the canvas to be static viewport for "infinite" scroll? 
                        // OR, simpler: "Move within page" = Standard scrolling of text/content?
                    }}
                // Note regarding scrolling:
                // If the user wants to scroll DOWN to write more, we need the container to allow scrolling.
                // Currently `containerRef` has `overflow-hidden`. 
                // To support infinite canvas or long notes, we usually need `overflow-auto`.
                // BUT `touch-none` prevents scrolling it.
                // So `containerRef` should be the window, and we scroll it manually.
                // However, `canvas` is `absolute inset-0` of container. If container scrolls, `absolute` stays relative to padding box?
                // Sticky positioning?
                />
            </div>
        </div>
    );
};
