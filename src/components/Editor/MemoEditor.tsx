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

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (containerRef.current) {
            canvas.width = containerRef.current.clientWidth;
            canvas.height = containerRef.current.clientHeight;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

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
    }, [elements, currentStroke, mode]);

    const getPoint = (e: React.PointerEvent) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (mode === 'text' || mode === 'view') return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setCurrentStroke([getPoint(e)]);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (mode === 'text' || mode === 'view') return;
        if (e.buttons !== 1) return;
        setCurrentStroke(prev => [...prev, getPoint(e)]);
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (mode === 'text' || mode === 'view') return;
        e.currentTarget.releasePointerCapture(e.pointerId);
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
                        "absolute inset-0 w-full h-full z-0 touch-none",
                        mode === 'view' && "pointer-events-none"
                    )}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                    style={{
                        cursor: mode === 'pen' ? 'crosshair' : 'default',
                        pointerEvents: (mode === 'pen' || mode === 'eraser') ? 'auto' : 'none'
                    }}
                />
            </div>
        </div>
    );
};
