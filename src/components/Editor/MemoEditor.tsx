import React, { useRef, useEffect, useState } from 'react';
import { LinkDialog } from './LinkDialog';
import { LinkActionDialog } from './LinkActionDialog';
import { db } from '../../db/db';
import { recognizeShape, type DrawingElement, type Point, type TextElement } from '../../utils/geometry';

import { Quadtree } from '../../utils/Quadtree';
import { v4 as uuidv4 } from 'uuid';
import { Undo, Eraser, Pen, Type, Save, Eye, Link as LinkIcon, MousePointer2 } from 'lucide-react';
import { cn } from '../../lib/utils';
// import { useLongPress } from 'use-long-press'; // Removed unused

interface MemoEditorProps {
    noteId: string;
    onBack: () => void;
    onLinkClick: (title: string, targetFolderId?: string | null) => Promise<'OPEN' | 'DELETE' | 'CANCEL'>;
    externalTitle?: string;
}

export const MemoEditor: React.FC<MemoEditorProps> = ({ noteId, onBack, onLinkClick, externalTitle }) => {
    const [mode, setMode] = useState<'text' | 'pen' | 'eraser' | 'view' | 'select'>('pen');
    const [noteContent, setNoteContent] = useState('');
    const [elements, setElements] = useState<DrawingElement[]>([]);
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // Lasso Selection State
    const [lassoPath, setLassoPath] = useState<Point[]>([]);

    // Transformation State
    const [transformMode, setTransformMode] = useState<'none' | 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'rotate'>('none');
    const [initialTransformState, setInitialTransformState] = useState<{
        startPos: Point,
        elements: DrawingElement[],
        center: Point,
        size: { width: number, height: number }
    } | null>(null);

    const [autoShape, setAutoShape] = useState(false);

    const [title, setTitle] = useState('');

    // Text Input State
    const [textInput, setTextInput] = useState<{ x: number, y: number, text: string, id?: string } | null>(null);

    // Link Dialog State
    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
    const [linkActionState, setLinkActionState] = useState<{ isOpen: boolean, target: { type: 'element' | 'text', id?: string, content: string } | null } | null>(null);

    // New state for widths (Must be declared before use)
    const [penWidth, setPenWidth] = useState(3);
    const [eraserWidth, setEraserWidth] = useState(20);
    const [fontSize, setFontSize] = useState(24);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const transformRef = useRef(transform); // Mutable transform for gestures
    const containerRef = useRef<HTMLDivElement>(null);
    const domLayerRef = useRef<HTMLDivElement>(null);

    const textInputRef = useRef<HTMLTextAreaElement>(null); // For canvas text input

    // Gesture state
    const activePointers = useRef<Map<number, { x: number, y: number, type: string }>>(new Map());
    const isPanning = useRef(false);

    // Drawing ref (for immediate updates without render lag)
    const currentStrokeRef = useRef<Point[]>([]);

    // Selection Moving State
    const isDraggingSelection = useRef(false);
    const lastDragPos = useRef<{ x: number, y: number } | null>(null);

    // Force render helper
    const [tick, setTick] = useState(0);

    const initialPinchDist = useRef<number>(0);
    const initialScale = useRef<number>(1);
    const initialCenter = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
    const initialTranslate = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
    const lastCenter = useRef<{ x: number, y: number } | null>(null); // Keep for compatibility logic if needed



    useEffect(() => {
        db.notes.get(noteId).then(n => {
            if (n) {
                setTitle(n.title || '');
                setNoteContent(n.content || '');
                if (n.drawings) setElements(n.drawings);
                setCurrentFolderId(n.folderId || null);
            }
        });
    }, [noteId]);


    useEffect(() => {
        if (externalTitle && externalTitle !== title) {
            setTitle(externalTitle);
        }
    }, [externalTitle]);

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

    useEffect(() => {
        if (mode !== 'select') {
            setSelectedIds(new Set());
        }
    }, [mode]);

    // ----------------------------------------------------------------------
    // RENDERING ENGINE (Viewport Based)
    // ----------------------------------------------------------------------

    // Max canvas size (logical space)
    const MAX_CANVAS_SIZE = { width: 20000, height: 20000 };

    // --- HELPER FUNCTIONS (Must be defined before use) ---

    // Coordinate conversion
    const getLocalPoint = (client_x: number, client_y: number) => {
        if (!containerRef.current) return { x: 0, y: 0 };
        const rect = containerRef.current.getBoundingClientRect();
        const screenX = client_x - rect.left;
        const screenY = client_y - rect.top;
        const x = (screenX - transform.x) / transform.scale;
        const y = (screenY - transform.y) / transform.scale;
        return { x, y };
    };

    // Math helpers
    const dist = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    };

    const mid = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
        return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    };

    const distanceToSegment = (p: Point, v: Point, w: Point) => {
        const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
        if (l2 === 0) return Math.sqrt(Math.pow(p.x - v.x, 2) + Math.pow(p.y - v.y, 2));
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.sqrt(Math.pow(p.x - (v.x + t * (w.x - v.x)), 2) + Math.pow(p.y - (v.y + t * (w.y - v.y)), 2));
    };

    // Hit testing
    const isPointNearElement = (point: Point, el: DrawingElement, threshold: number = 10): boolean => {
        if (el.type === 'stroke') {
            const t = threshold + el.width / 2;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of el.points) {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            if (point.x < minX - t || point.x > maxX + t || point.y < minY - t || point.y > maxY + t) return false;
            for (let i = 0; i < el.points.length - 1; i++) {
                if (distanceToSegment(point, el.points[i], el.points[i + 1]) < t) return true;
            }
            return false;
        }

        if (el.type === 'line') {
            const t = threshold + el.width / 2;
            const { start, end } = el.params;
            return distanceToSegment(point, start, end) < t;
        }

        if (el.type === 'circle') {
            const t = threshold + el.width / 2;
            const { x, y, radius } = el.params;
            const d = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
            return Math.abs(d - radius) < t;
        }

        if (el.type === 'rect') {
            const t = threshold + el.width / 2;
            const { x, y, width, height } = el.params;
            const p1 = { x, y };
            const p2 = { x: x + width, y };
            const p3 = { x: x + width, y: y + height };
            const p4 = { x, y: y + height };
            return distanceToSegment(point, p1, p2) < t ||
                distanceToSegment(point, p2, p3) < t ||
                distanceToSegment(point, p3, p4) < t ||
                distanceToSegment(point, p4, p1) < t;
        }

        if (el.type === 'text') {
            // Check bounding box
            const w = el.content.length * el.fontSize * 0.6;
            const h = el.fontSize;
            // Hit test: origin is bottom-left
            return point.x >= el.x && point.x <= el.x + w && point.y >= el.y - h && point.y <= el.y + 10;
        }

        return false;
        return false;
    };

    // Lasso Hit Testing (Ray Casting)
    const isPointInPolygon = (point: Point, vs: Point[]) => {
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].x, yi = vs[i].y;
            const xj = vs[j].x, yj = vs[j].y;
            const intersect = ((yi > point.y) !== (yj > point.y))
                && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    const isElementInLasso = (el: DrawingElement, polygon: Point[]) => {
        if (polygon.length < 3) return false;

        // Simple optimization: Check if any point of the element is inside or if center is inside
        // Better for user experience: center or bounding box corners
        if (el.type === 'stroke') {
            // Check sample points
            for (let i = 0; i < el.points.length; i += 5) {
                if (isPointInPolygon(el.points[i], polygon)) return true;
            }
            return false;
        }

        // Shape/Text center check
        let center = { x: 0, y: 0 };
        if (el.type === 'text') {
            const w = el.content.length * el.fontSize * 0.6;
            const h = el.fontSize;
            center = { x: el.x + w / 2, y: el.y - h / 2 };
        } else if (el.type === 'rect' || el.type === 'circle') {
            center = { x: el.params.x + (el.params.width || 0) / 2, y: el.params.y + (el.params.height || 0) / 2 };
            if (el.type === 'circle') center = { x: el.params.x, y: el.params.y };
        } else if (el.type === 'line') {
            center = mid(el.params.start, el.params.end);
        }

        return isPointInPolygon(center, polygon);
    };

    // Calculate Selection Bounds
    const getSelectionBounds = () => {
        if (selectedIds.size === 0) return null;
        const selectedEls = elements.filter(el => selectedIds.has(el.id));
        if (selectedEls.length === 0) return null;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        selectedEls.forEach(el => {
            if (el.type === 'stroke') {
                el.points.forEach(p => {
                    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                });
            } else if (el.type === 'text') {
                const w = el.content.length * el.fontSize * 0.6;
                const h = el.fontSize;
                minX = Math.min(minX, el.x); maxX = Math.max(maxX, el.x + w);
                minY = Math.min(minY, el.y - h); maxY = Math.max(maxY, el.y);
            } else if (el.type === 'rect') {
                const { x, y, width, height } = el.params;
                minX = Math.min(minX, x); maxX = Math.max(maxX, x + width);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y + height);
            } else if (el.type === 'circle') {
                const { x, y, radius } = el.params;
                minX = Math.min(minX, x - radius); maxX = Math.max(maxX, x + radius);
                minY = Math.min(minY, y - radius); maxY = Math.max(maxY, y + radius);
            } else if (el.type === 'line') {
                const { start, end } = el.params;
                minX = Math.min(minX, start.x, end.x); maxX = Math.max(maxX, start.x, end.x);
                minY = Math.min(minY, start.y, end.y); maxY = Math.max(maxY, start.y, end.y);
            }
        });

        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    };



    const isStrokeIntersectingElement = (stroke: Point[], el: DrawingElement, threshold: number) => {
        for (let i = 0; i < stroke.length; i += 3) {
            if (isPointNearElement(stroke[i], el, threshold)) return true;
        }
        return false;
    };

    // Drawing Helper
    const drawSmoothStroke = (ctx: CanvasRenderingContext2D, points: Point[]) => {
        if (points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
    };

    // State Updates
    const updateElementPosition = (el: DrawingElement, dx: number, dy: number): DrawingElement => {
        if (el.type === 'stroke') {
            return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
        } else if (el.type === 'line') {
            const { start, end } = el.params;
            return { ...el, params: { ...el.params, start: { x: start.x + dx, y: start.y + dy }, end: { x: end.x + dx, y: end.y + dy } } };
        } else if (el.type === 'circle') {
            const { x, y } = el.params;
            return { ...el, params: { ...el.params, x: x + dx, y: y + dy } };
        } else if (el.type === 'rect') {
            const { x, y } = el.params;
            return { ...el, params: { ...el.params, x: x + dx, y: y + dy } };
        } else if (el.type === 'text') {
            return { ...el, x: el.x + dx, y: el.y + dy };
        }
        return el;
    };

    const rotateElement = (el: DrawingElement, center: Point, angle: number): DrawingElement => {
        const rotate = (p: Point) => {
            const dx = p.x - center.x;
            const dy = p.y - center.y;
            return {
                x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
                y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle)
            };
        };

        if (el.type === 'stroke') {
            return { ...el, points: el.points.map(rotate) };
        } else if (el.type === 'line') {
            return { ...el, params: { ...el.params, start: rotate(el.params.start), end: rotate(el.params.end) } };
        } else if (el.type === 'text') {
            const p = rotate({ x: el.x, y: el.y });
            return { ...el, x: p.x, y: p.y }; // Rotation of text itself not supported in this model yet, just position
        } else if (el.type === 'rect') {
            // Convert rect to poly to rotate? Rect params are x,y,w,h (axis aligned).
            // If we support rotation, we must change Rect to Polygon or store rotation.
            // For now: Approximate by rotating center?
            // Actually user asked for rotation. 
            // LIMITATION: 'rect' type is axis aligned. 'circle' is invariant.
            // To support true rotation, we should convert shapes to strokes or add rotation prop.
            // Let's convert Rect/Circle to Stroke (polygon) upon rotation for now to support visual rotation?
            // OR: Just rotate the position for MVP if complex.
            // User Request: "大きさや角度を変えられるようにしたい"
            // I will implement "Convert to Stroke" behavior for rotation of Shapes to handle it correctly.

            // Convert Rect to Stroke Points
            const { x, y, width, height } = el.params;
            const p1 = { x, y };
            const p2 = { x: x + width, y };
            const p3 = { x: x + width, y: y + height };
            const p4 = { x, y: y + height };
            return {
                type: 'stroke',
                id: el.id,
                color: el.color,
                width: el.width,
                points: [p1, p2, p3, p4, p1].map(rotate),
                link: el.link
            };
        } else if (el.type === 'circle') {
            // Circle rotation only changes position
            const { x, y } = el.params;
            const p = rotate({ x, y });
            return { ...el, params: { ...el.params, x: p.x, y: p.y } };
        }
        return el;
    };

    const scaleElement = (el: DrawingElement, oldB: { x: number, y: number, w: number, h: number }, newB: { x: number, y: number, w: number, h: number }): DrawingElement => {
        const mapX = (x: number) => newB.x + (x - oldB.x) * (newB.w / oldB.w);
        const mapY = (y: number) => newB.y + (y - oldB.y) * (newB.h / oldB.h);

        const mapPt = (p: Point) => ({ x: mapX(p.x), y: mapY(p.y) });

        if (el.type === 'stroke') {
            return { ...el, points: el.points.map(mapPt) };
        } else if (el.type === 'line') {
            return { ...el, params: { ...el.params, start: mapPt(el.params.start), end: mapPt(el.params.end) } };
        } else if (el.type === 'rect') {
            const { x, y, width, height } = el.params;
            const nx = mapX(x);
            const ny = mapY(y);
            const nw = width * (newB.w / oldB.w);
            const nh = height * (newB.h / oldB.h);
            return { ...el, params: { ...el.params, x: nx, y: ny, width: nw, height: nh } };
        } else if (el.type === 'circle') {
            const { x, y, radius } = el.params;
            const nx = mapX(x);
            const ny = mapY(y);
            const nr = radius * Math.abs(newB.w / oldB.w); // simple uniform scaling assumption
            return { ...el, params: { ...el.params, x: nx, y: ny, radius: nr } };
        } else if (el.type === 'text') {
            const nx = mapX(el.x);
            const ny = mapY(el.y);
            const nf = el.fontSize * Math.abs(newB.h / oldB.h);
            return { ...el, x: nx, y: ny, fontSize: nf };
        }
        return el;
    };

    const setInitialTransform = (pt: Point) => {
        const selectedEls = elements.filter(el => selectedIds.has(el.id));
        const bounds = getSelectionBounds();
        if (bounds) {
            setInitialTransformState({
                startPos: pt,
                elements: selectedEls,
                center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
                size: { width: bounds.w, height: bounds.h }
            });
        }
    };

    // --- ACTIONS (Defined before use) ---

    const commitStroke = () => {
        const stroke = currentStrokeRef.current;
        if (stroke.length === 0) return;

        if (mode === 'eraser') {
            const threshold = eraserWidth / 2;
            setElements(prev => prev.filter(el => !isStrokeIntersectingElement(stroke, el, threshold)));
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

    const commitText = () => {
        if (!textInput) return;
        if (textInput.text.trim()) {
            const newEl: TextElement = {
                type: 'text',
                id: textInput.id || uuidv4(),
                x: textInput.x,
                y: textInput.y,
                content: textInput.text,
                fontSize: fontSize,
                color: 'black'
            };
            setElements(prev => [...prev, newEl]);
        }
        setTextInput(null);
    };



    const insertLink = () => {
        if (selectedIds.size > 0) {
            setIsLinkDialogOpen(true);
        } else {
            alert("Please select an element to link.");
        }
    };

    const handleLinkCreate = async (title: string) => {
        setIsLinkDialogOpen(false);
        try {
            // Create Note
            const newNote = {
                id: uuidv4(),
                title: title,
                content: '',
                drawings: [],
                folderId: currentFolderId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            await db.notes.add(newNote);
            applyLinkToSelection(title);
            alert(`Link created to "${title}"`);
            setMode('view');
        } catch (e: any) {
            console.error("Link Creation Error:", e);
            alert(`Error creating link: ${e.message}`);
        }
    };

    const handleLinkSelect = (_noteId: string, title: string) => {
        setIsLinkDialogOpen(false);

        // Check if we are editing a specific target from LinkActionDialog
        if (linkActionState?.target) {
            const target = linkActionState.target;
            if (target.type === 'element' && target.id) {
                setElements(prev => prev.map(el => {
                    if (el.id === target.id) {
                        return { ...el, link: title };
                    }
                    return el;
                }));
            } else if (target.type === 'text' && target.content) {
                // For text content, we replace the OLD link with NEW link
                // target.content holds the OLD link title
                const oldLinkStr = `[[${target.content}]]`;
                const newLinkStr = `[[${title}]]`;
                setNoteContent(prev => prev.replaceAll(oldLinkStr, newLinkStr));
            }
            // Close action dialog state
            setLinkActionState(null);
            return;
        }

        applyLinkToSelection(title);
        setMode('view');
    };

    const applyLinkToSelection = (linkTitle: string) => {
        setElements(prev => prev.map(el => {
            if (selectedIds.has(el.id)) {
                return { ...el, link: linkTitle };
            }
            return el;
        }));
        setSelectedIds(new Set());
    };

    const onDelete = () => {
        if (selectedIds.size > 0) {
            setElements(prev => prev.filter(el => !selectedIds.has(el.id)));
            setSelectedIds(new Set());
        }
    };


    // --- EVENT HANDLERS ---

    const onPointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();

        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
        e.currentTarget.setPointerCapture(e.pointerId);

        const pointers = Array.from(activePointers.current.values());
        const hasPen = pointers.some(p => p.type === 'pen');
        const pt = getLocalPoint(e.clientX, e.clientY);

        // TEXT MODE: Create or Edit
        if (mode === 'text' && pointers.length === 1) {
            let hitText = null;
            for (let i = elements.length - 1; i >= 0; i--) {
                const el = elements[i];
                if (el.type === 'text' && isPointNearElement(pt, el, 10)) {
                    hitText = el;
                    break;
                }
            }

            if (hitText) {
                setTextInput({ x: hitText.x, y: hitText.y, text: hitText.content, id: hitText.id });
                setElements(prev => prev.filter(e => e.id !== hitText!.id));
            } else {
                if (textInput) commitText();
                setTextInput({ x: pt.x, y: pt.y, text: '' });
            }
            return;
        }

        if (textInput) {
            commitText();
            return;
        }

        // SELECTION MODE
        // SELECTION MODE
        if (mode === 'select' && pointers.length === 1) {
            // Check for Transform Handles First
            const bounds = getSelectionBounds();
            if (bounds && selectedIds.size > 0) {
                const HANDLE_SIZE = 20 / transform.scale;
                const { x, y, w, h } = bounds;

                // Helper for handle hit test
                const hit = (hx: number, hy: number) => Math.abs(pt.x - hx) < HANDLE_SIZE && Math.abs(pt.y - hy) < HANDLE_SIZE;

                if (hit(x, y)) { setTransformMode('nw'); setInitialTransform(pt); return; }
                if (hit(x + w, y)) { setTransformMode('ne'); setInitialTransform(pt); return; }
                if (hit(x + w, y + h)) { setTransformMode('se'); setInitialTransform(pt); return; }
                if (hit(x, y + h)) { setTransformMode('sw'); setInitialTransform(pt); return; }
                if (hit(x + w / 2, y - 40 / transform.scale)) { setTransformMode('rotate'); setInitialTransform(pt); return; }

                // Check for move (inside bounds)
                if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) {
                    setTransformMode('move');
                    setInitialTransform(pt);
                    return;
                }
            }

            // Start Lasso
            setLassoPath([pt]);
            setSelectedIds(new Set()); // Clear selection on new lasso
            isPanning.current = false;
            return;
        }

        if (hasPen && e.pointerType === 'pen') {
            if (['pen', 'eraser'].includes(mode)) {
                isPanning.current = false;
                currentStrokeRef.current = [pt];
                setTick(t => t + 1);
            }
            return;
        }

        if (pointers.length === 2 && !hasPen) {
            isPanning.current = true;

            const center = mid(pointers[0], pointers[1]);
            initialPinchDist.current = dist(pointers[0], pointers[1]);
            initialCenter.current = center;
            initialTranslate.current = { x: transform.x, y: transform.y };
            initialScale.current = transform.scale;

            // Sync ref
            transformRef.current = transform;
            currentStrokeRef.current = [];
            setTick(t => t + 1);
        } else if (pointers.length === 1 && !hasPen) {
            if (['pen', 'eraser'].includes(mode)) {
                isPanning.current = false;
                currentStrokeRef.current = [pt];
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
        const pt = getLocalPoint(e.clientX, e.clientY);

        if (lassoPath.length > 0) {
            setLassoPath(prev => [...prev, pt]);
            return;
        }

        if (transformMode !== 'none' && initialTransformState && mode === 'select') {
            const { startPos, elements: initialEls, center, size } = initialTransformState;
            const dx = pt.x - startPos.x;
            const dy = pt.y - startPos.y;

            if (transformMode === 'move') {
                setElements(prev => prev.map(el => {
                    const initEl = initialEls.find(ie => ie.id === el.id);
                    if (!initEl) return el;
                    return updateElementPosition(initEl, dx, dy);
                }));
            } else if (transformMode === 'rotate') {
                // Calculate angle
                const startAngle = Math.atan2(startPos.y - center.y, startPos.x - center.x);
                const currentAngle = Math.atan2(pt.y - center.y, pt.x - center.x);
                const dAngle = currentAngle - startAngle;

                // Rotate elements around center
                setElements(prev => prev.map(el => {
                    const initEl = initialEls.find(ie => ie.id === el.id);
                    if (!initEl) return el;
                    return rotateElement(initEl, center, dAngle);
                }));
            } else {
                // Scale
                // Calculate scale factor based on handle


                // Simplified Uniform Scale for MVP to avoid complexity with flip logic
                // But user asked for "change size", so aspect ratio might change? 
                // Let's implement independent scaling for corner handles

                // Logic: 
                // 1. Calculate new width/height based on dx/dy and handle position
                // 2. Scale elements relative to the FIXED opposite corner

                // For simplicity, let's just do translation of points for now or uniform scale? 
                // Implementing full matrix transform for vector shapes is complex.
                // Let's try a simpler approach: Scale relative to center.

                // Actually the easiest robust way is:
                // Calculate new Bounds.
                // Map point (x,y) from OldBounds to NewBounds.
                // NewX = NewBounds.X + (x - OldBounds.X) * (NewWidth / OldWidth)

                let newBounds = { x: initialTransformState.center.x - size.width / 2, y: initialTransformState.center.y - size.height / 2, w: size.width, h: size.height };

                if (transformMode === 'se') { newBounds.w += dx; newBounds.h += dy; }
                else if (transformMode === 'sw') { newBounds.x += dx; newBounds.w -= dx; newBounds.h += dy; }
                else if (transformMode === 'ne') { newBounds.y += dy; newBounds.h -= dy; newBounds.w += dx; }
                else if (transformMode === 'nw') { newBounds.x += dx; newBounds.w -= dx; newBounds.y += dy; newBounds.h -= dy; }

                // Prevent negative size
                if (newBounds.w < 1) newBounds.w = 1; // Flip logic would be better but let's clamp for safety
                if (newBounds.h < 1) newBounds.h = 1;

                setElements(prev => prev.map(el => {
                    const initEl = initialEls.find(ie => ie.id === el.id);
                    if (!initEl) return el;
                    return scaleElement(initEl, { x: initialTransformState.center.x - size.width / 2, y: initialTransformState.center.y - size.height / 2, w: size.width, h: size.height }, newBounds);
                }));
            }
            return;
        }

        // Pan/Zoom (Smooth Ref-based)
        if (isPanning.current && pointers.length === 2) {
            const newDist = dist(pointers[0], pointers[1]);
            const newCenter = mid(pointers[0], pointers[1]);

            // Calculate Scale
            const scaleFactor = newDist / initialPinchDist.current;
            let newScale = initialScale.current * scaleFactor;
            newScale = Math.min(Math.max(newScale, 0.1), 5); // Clamping

            // Calculate Translation (Absolute)
            // Tx_new = Center_new - (Center_start - Tx_start) * (Scale_new / Scale_start)
            const P_world_start_x = (initialCenter.current.x - initialTranslate.current.x) / initialScale.current;
            const P_world_start_y = (initialCenter.current.y - initialTranslate.current.y) / initialScale.current;

            let nextX = newCenter.x - P_world_start_x * newScale;
            let nextY = newCenter.y - P_world_start_y * newScale;

            // Bounds Clamping
            if (containerRef.current) {
                const cw = containerRef.current.clientWidth;
                const ch = containerRef.current.clientHeight;
                const contentW = MAX_CANVAS_SIZE.width * newScale;
                const contentH = MAX_CANVAS_SIZE.height * newScale;
                const minX = cw - contentW;
                const minY = ch - contentH;

                if (minX < 0) nextX = Math.max(minX, Math.min(nextX, 0));
                else nextX = Math.max(0, Math.min(nextX, minX));

                if (minY < 0) nextY = Math.max(minY, Math.min(nextY, 0));
                else nextY = Math.max(0, Math.min(nextY, minY));
            }

            const newTransform = { scale: newScale, x: nextX, y: nextY };
            transformRef.current = newTransform;

            // Direct DOM Update (Bypass React)
            if (domLayerRef.current) {
                domLayerRef.current.style.transform = `translate(${nextX}px, ${nextY}px) scale(${newScale})`;
            }

            // Direct Render
            renderCanvas(newTransform);
            return;
        }

        // Drawing
        if (!isPanning.current && ['pen', 'eraser'].includes(mode)) {
            if (hasPen && e.pointerType !== 'pen') return;

            if (currentStrokeRef.current.length > 0) {
                const last = currentStrokeRef.current[currentStrokeRef.current.length - 1];
                if (Math.abs(last.x - pt.x) > 1 || Math.abs(last.y - pt.y) > 1) {
                    currentStrokeRef.current.push(pt);
                    setTick(t => t + 1); // Trigger render loop
                }
            }
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        activePointers.current.delete(e.pointerId);
        e.currentTarget.releasePointerCapture(e.pointerId);

        isDraggingSelection.current = false;
        lastDragPos.current = null;
        setTransformMode('none');
        setInitialTransformState(null);

        if (lassoPath.length > 0) {
            // Close loop logic check? Not strictly needed for polygon test usually
            const found = elements.filter(el => isElementInLasso(el, lassoPath));
            const newIds = new Set(found.map(el => el.id));
            setSelectedIds(newIds);
            setLassoPath([]);
        }

        if (activePointers.current.size < 2) {
            if (isPanning.current) {
                // Sync final state
                setTransform(transformRef.current);
            }
            isPanning.current = false;
            lastCenter.current = null;
        }

        if (currentStrokeRef.current.length > 0) {
            if (e.pointerType === 'pen' || activePointers.current.size === 0) {
                commitStroke();
            }
        } else {
            // Check for Link Navigation (Tap in View Mode)
            if (mode === 'view' && !isPanning.current && activePointers.current.size === 0) {
                const pt = getLocalPoint(e.clientX, e.clientY);
                (async () => {
                    for (let i = elements.length - 1; i >= 0; i--) {
                        const el = elements[i];
                        if (el.link && isPointNearElement(pt, el, 10)) {
                            // Open Action Dialog
                            setLinkActionState({
                                isOpen: true,
                                target: { type: 'element', id: el.id, content: el.link }
                            });
                            break;
                        }
                    }
                })();
            }
        }
    };


    // --- EFFECTS ---

    // Update screen canvas size on resize
    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current && canvasRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                canvasRef.current.width = rect.width;
                canvasRef.current.height = rect.height;
                setTick(t => t + 1); // Force redraw
            }
        };
        window.addEventListener('resize', handleResize);
        handleResize(); // Init
        return () => window.removeEventListener('resize', handleResize);
    }, []);


    // Quadtree Ref
    // Initialize with MAX_CANVAS_SIZE or sufficiently large bounds
    // Since MAX_CANVAS_SIZE is 20000x20000, we use that.
    const quadtreeRef = useRef<Quadtree>(new Quadtree({ x: 0, y: 0, width: 20000, height: 20000 }));

    // Rebuild Quadtree when elements change
    useEffect(() => {
        // We could optimize this to not rebuild entirely if we swtiched to mutable elements or action-based updates
        // But for now, full rebuild is safe.
        const qt = new Quadtree({ x: 0, y: 0, width: 20000, height: 20000 });
        elements.forEach(el => qt.insert(el));
        quadtreeRef.current = qt;
    }, [elements]);

    // Auto-focus text input
    useEffect(() => {
        if (textInput && textInputRef.current) {
            textInputRef.current.focus();
        }
    }, [textInput]);


    // Auto-focus text input
    useEffect(() => {
        if (textInput && textInputRef.current) {
            textInputRef.current.focus();
        }
    }, [textInput]);


    // MAIN RENDER FUNCTION (Extracted for direct access)
    const renderCanvas = (currentTransform: { x: number, y: number, scale: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear Screen
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Apply Viewport Transform
        ctx.save();
        ctx.setTransform(currentTransform.scale, 0, 0, currentTransform.scale, currentTransform.x, currentTransform.y);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Calculate Viewport AABB (Logical Coordinates)
        const viewport = {
            x: -currentTransform.x / currentTransform.scale,
            y: -currentTransform.y / currentTransform.scale,
            width: canvas.width / currentTransform.scale,
            height: canvas.height / currentTransform.scale
        };

        // Query Quadtree
        const visibleElements = quadtreeRef.current.query(viewport);

        // Draw Visible Elements
        visibleElements.forEach(el => {
            const isSelected = selectedIds.has(el.id);
            ctx.strokeStyle = isSelected ? '#3b82f6' : el.color;
            ctx.fillStyle = el.color;
            const elWidth = el.type === 'text' ? 0 : el.width;
            if (isSelected) ctx.shadowBlur = 5; else ctx.shadowBlur = 0;
            ctx.shadowColor = '#3b82f6';

            // Adaptive Line Width for Zoom (Minimum 0.5px visual width)
            const minLineWidth = 0.5 / currentTransform.scale;
            let finalWidth = isSelected ? (elWidth + 2) : elWidth;
            if (finalWidth < minLineWidth) finalWidth = minLineWidth;
            ctx.lineWidth = finalWidth;

            if (el.type === 'stroke') {
                drawSmoothStroke(ctx, el.points);
            } else if (el.type === 'line') {
                const { start, end } = el.params;
                ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
            } else if (el.type === 'circle') {
                const { x, y, radius } = el.params;
                ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
            } else if (el.type === 'rect') {
                const { x, y, width, height } = el.params;
                ctx.strokeRect(x, y, width, height);
            } else if (el.type === 'text') {
                ctx.font = `${el.fontSize}px sans-serif`;
                ctx.fillStyle = 'black';
                ctx.fillText(el.content, el.x, el.y);

                if (isSelected) {
                    const metrics = ctx.measureText(el.content);
                    const h = el.fontSize;
                    ctx.save();
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(el.x - 2, el.y - h, metrics.width + 4, h + 4);
                    ctx.restore();
                }
            }

            // Link Indicators
            if (el.link && mode === 'view') {
                const LINK_COLOR = '#0ea5e9';
                if (el.type === 'text') {
                    ctx.fillStyle = LINK_COLOR;
                    ctx.fillText(el.content, el.x, el.y);
                    // Underline
                    const metrics = ctx.measureText(el.content);
                    ctx.beginPath(); ctx.moveTo(el.x, el.y + 4); ctx.lineTo(el.x + metrics.width, el.y + 4);
                    ctx.strokeStyle = LINK_COLOR; ctx.lineWidth = 2; ctx.stroke();
                } else {
                    ctx.save();
                    ctx.strokeStyle = LINK_COLOR;
                    if (el.type === 'rect') ctx.strokeRect(el.params.x, el.params.y, el.params.width, el.params.height);
                    else if (el.type === 'circle') { ctx.beginPath(); ctx.arc(el.params.x, el.params.y, el.params.radius, 0, Math.PI * 2); ctx.stroke(); }
                    else if (el.type === 'line') { ctx.beginPath(); ctx.moveTo(el.params.start.x, el.params.start.y); ctx.lineTo(el.params.end.x, el.params.end.y); ctx.stroke(); }
                    else if (el.type === 'stroke') drawSmoothStroke(ctx, el.points);
                    ctx.restore();
                }
            } else if (el.link && el.type === 'text') {
                // Edit Mode Underline
                const metrics = ctx.measureText(el.content);
                ctx.beginPath(); ctx.moveTo(el.x, el.y + 4); ctx.lineTo(el.x + metrics.width, el.y + 4);
                ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke();
            }
        });

        // Draw Current Stroke
        const stroke = currentStrokeRef.current;
        if (stroke.length > 0) {
            ctx.strokeStyle = mode === 'eraser' ? '#ff0000' : 'black';
            let strokeWidth = mode === 'eraser' ? eraserWidth : penWidth;
            // Adaptive width for current stroke
            const minLineWidth = 0.5 / currentTransform.scale;
            if (strokeWidth < minLineWidth) strokeWidth = minLineWidth;

            ctx.lineWidth = strokeWidth;
            if (mode === 'eraser') ctx.globalAlpha = 0.5;

            if (stroke.length < 2) {
                ctx.beginPath(); ctx.moveTo(stroke[0].x, stroke[0].y); ctx.stroke();
            } else {
                drawSmoothStroke(ctx, stroke);
            }
            ctx.globalAlpha = 1.0;
        }

        // Draw Lasso Path
        if (lassoPath.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1 / currentTransform.scale;
            ctx.setLineDash([5 / currentTransform.scale, 5 / currentTransform.scale]);
            ctx.beginPath();
            ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
            for (let i = 1; i < lassoPath.length; i++) {
                ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
            }
            ctx.stroke();
            ctx.restore();
        }

        // Draw Transform Bounds & Handles (if selecting)
        if (mode === 'select' && selectedIds.size > 0) {
            const bounds = getSelectionBounds();
            if (bounds) {
                const { x, y, w, h } = bounds;
                ctx.save();
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 1 / currentTransform.scale;
                ctx.setLineDash([4 / currentTransform.scale, 4 / currentTransform.scale]);
                ctx.strokeRect(x, y, w, h);

                // Handles
                const HANDLE_SIZE = 8 / currentTransform.scale;
                ctx.fillStyle = 'white';
                ctx.setLineDash([]);

                const drawHandle = (hx: number, hy: number) => {
                    ctx.fillRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
                    ctx.strokeRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
                };

                drawHandle(x, y); // NW
                drawHandle(x + w, y); // NE
                drawHandle(x + w, y + h); // SE
                drawHandle(x, y + h); // SW
                drawHandle(x + w / 2, y - 40 / currentTransform.scale); // Rotate

                // Connector to rotate handle
                ctx.beginPath();
                ctx.moveTo(x + w / 2, y);
                ctx.lineTo(x + w / 2, y - 40 / currentTransform.scale);
                ctx.stroke();

                ctx.restore();
            }
        }

        ctx.restore(); // End Viewport Transform
    };

    // React Render Loop (Low frequency or logic updates)
    useEffect(() => {
        renderCanvas(transform);
    }, [elements, mode, transform, lassoPath, selectedIds, penWidth, eraserWidth, tick]);


    const renderContentView = () => {
        const parts = noteContent.split(/(\[\[.*?\]\])/g);
        return parts.map((part, i) => {
            if (part.startsWith('[[') && part.endsWith(']]')) {
                const content = part.slice(2, -2);
                return (
                    <span
                        key={i}
                        className="text-blue-600 underline cursor-pointer hover:text-blue-800"
                        onClick={async (e) => {
                            e.stopPropagation();
                            // Open Action Dialog
                            setLinkActionState({
                                isOpen: true,
                                target: { type: 'text', content: content } // No ID for text content replace yet, usage needs care
                            });
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
                <button onClick={() => setMode('select')} className={cn("p-2 rounded", mode === 'select' && "bg-primary/20 text-primary")} title="Select Mode"><MousePointer2 size={20} /></button>
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

                {/* Font Size for Text Mode */}
                {mode === 'text' && (
                    <div className="flex items-center gap-1 ml-2 bg-white/50 p-1 rounded border">
                        <Type size={14} className="text-gray-500" />
                        <input
                            type="number"
                            min="10"
                            max="100"
                            value={fontSize}
                            onChange={e => setFontSize(Number(e.target.value))}
                            className="w-12 h-6 text-sm border rounded px-1"
                        />
                    </div>
                )}

                {/* Delete Button for Selection */}
                {selectedIds.size > 0 && mode === 'select' && (
                    <button onClick={onDelete} className="p-2 rounded bg-red-100 text-red-600 font-bold text-xs ml-2">DELETE {selectedIds.size}</button>
                )}

                <div className="flex-1" />

                {/* Shape Checkbox */}
                <label className="flex items-center gap-1 text-xs select-none cursor-pointer mr-2 px-2 hover:bg-muted py-1 rounded">
                    <input type="checkbox" checked={autoShape} onChange={e => setAutoShape(e.target.checked)} />
                    <span>Shape</span>
                </label>

                {/* Extra Tools */}
                <button onClick={insertLink} className="p-2 hover:bg-muted" title="Insert Link"><LinkIcon size={18} /></button>


                <button onClick={() => setElements(e => e.slice(0, -1))} className="p-2 hover:bg-muted"><Undo size={18} /></button>
                <button onClick={saveNote} className="p-2 hover:bg-muted text-primary"><Save size={18} /></button>
            </div>



            {/* Canvas Container */}
            <div
                className="flex-1 relative overflow-hidden bg-gray-50 touch-none"
                ref={containerRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
            >
                {/* 
                   Canvas Layer 
                   Now occupies full container, handles all vector rendering with viewport transform
                */}
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 pointer-events-none"
                    style={{ width: '100%', height: '100%' }}
                />

                {/* 
                   DOM Layer (Transform applied via CSS)
                   For Text Input Overlay and Backround Text (Legacy)
                */}
                <div
                    ref={domLayerRef}
                    style={{
                        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                        transformOrigin: '0 0',
                        width: MAX_CANVAS_SIZE.width,
                        height: MAX_CANVAS_SIZE.height,
                        willChange: 'transform',
                        pointerEvents: 'none' // Let clicks pass to container, but enable for inputs
                    }}
                >
                    {/* Background Text Note (Legacy/Underlay) */}
                    <div className={cn("absolute inset-0 p-6 whitespace-pre-wrap leading-loose text-lg font-mono pointer-events-none")}>
                        {renderContentView()}
                    </div>

                    {/* Text Input Overlay */}
                    {textInput && (
                        <textarea
                            ref={textInputRef}
                            style={{
                                position: 'absolute',
                                left: textInput.x,
                                top: textInput.y - fontSize,
                                fontSize: fontSize + 'px',
                                minWidth: '100px',
                                color: 'black',
                                background: 'transparent',
                                border: '1px dashed #3b82f6',
                                outline: 'none',
                                resize: 'none',
                                overflow: 'hidden',
                                height: (fontSize * 1.5) + 'px',
                                whiteSpace: 'nowrap',
                                zIndex: 100,
                                fontFamily: 'sans-serif',
                                lineHeight: '1',
                                pointerEvents: 'auto' // Re-enable pointer events for input
                            }}
                            value={textInput.text}
                            onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
                            onPointerDown={(e) => e.stopPropagation()}
                        />
                    )}
                </div>

                {/* Info Overlay */}
                <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded pointer-events-none z-50">
                    {Math.round(transform.scale * 100)}%
                </div>
            </div>

            {/* Link Dialog */}
            <LinkDialog
                isOpen={isLinkDialogOpen}
                onClose={() => setIsLinkDialogOpen(false)}
                onSelect={handleLinkSelect}
                onCreate={handleLinkCreate}
                currentFolderId={currentFolderId}
                excludeNoteId={noteId}
            />
            <LinkActionDialog
                isOpen={!!linkActionState?.isOpen}
                onClose={() => setLinkActionState(null)}
                linkTitle={linkActionState?.target?.content || ''}
                onNavigate={async () => {
                    if (linkActionState?.target?.content) {
                        const action = await onLinkClick(linkActionState.target.content, currentFolderId);
                        if (action === 'DELETE') {
                            const target = linkActionState.target;
                            if (target.type === 'element' && target.id) {
                                setElements(prev => prev.map(item => {
                                    if (item.id === target.id) {
                                        const { link, ...rest } = item;
                                        return rest;
                                    }
                                    return item;
                                }));
                            } else if (target.type === 'text') {
                                const linkStr = `[[${target.content}]]`;
                                setNoteContent(prev => prev.replaceAll(linkStr, target.content));
                            }
                        }
                    }
                }}
                onEdit={() => {
                    setIsLinkDialogOpen(true);
                    // Note: We are keeping linkActionState active or should we?
                    // Actually we need to know what we are editing when handleLinkSelect is called.
                    // But handleLinkSelect currently uses 'selectedIds'.
                    // We need to update handleLinkSelect/Create to support explicit target.
                    // For now, let's just Open the dialog. The ActionDialog will close (via onClose above? No, onEdit calls onClose).
                    // Wait, onEdit prop in LinkActionDialog calls onClose AND onEdit.
                    // So here we open LinkDialog.
                    // IMPORTANT: We need to set a state to know we are UPDATING THIS target.
                    // Let's reuse 'linkActionState' or create 'pendingLinkTarget'.
                    // Since linkActionDialog is closed, linkActionState might be set to null.
                    // We should modify 'onClose' behavior or use a separate state.
                }}
            />
        </div>

    );
};
