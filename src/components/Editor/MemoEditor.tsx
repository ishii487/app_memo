import React, { useRef, useEffect, useState } from 'react';
import { LinkDialog } from './LinkDialog';
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
    const [selectionBox, setSelectionBox] = useState<{ start: Point, end: Point } | null>(null);

    const [autoShape, setAutoShape] = useState(true);

    const [title, setTitle] = useState('');

    // Text Input State
    const [textInput, setTextInput] = useState<{ x: number, y: number, text: string, id?: string } | null>(null);

    // Link Dialog State
    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

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
    };

    const isElementInBox = (el: DrawingElement, box: { start: Point, end: Point }) => {
        const x1 = Math.min(box.start.x, box.end.x);
        const x2 = Math.max(box.start.x, box.end.x);
        const y1 = Math.min(box.start.y, box.end.y);
        const y2 = Math.max(box.start.y, box.end.y);

        const isInside = (p: Point) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;

        if (el.type === 'stroke') {
            return el.points.some(isInside);
        }
        if (el.type === 'line') {
            return isInside(el.params.start) || isInside(el.params.end);
        }
        if (el.type === 'circle') {
            return isInside({ x: el.params.x, y: el.params.y });
        }
        if (el.type === 'rect') {
            return isInside({ x: el.params.x, y: el.params.y });
        }
        if (el.type === 'text') {
            return isInside({ x: el.x, y: el.y - el.fontSize / 2 });
        }
        return false;
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
        if (mode === 'select' && pointers.length === 1) {
            let foundId: string | null = null;
            for (let i = elements.length - 1; i >= 0; i--) {
                if (isPointNearElement(pt, elements[i], 10)) {
                    foundId = elements[i].id;
                    break;
                }
            }

            if (foundId) {
                if (selectedIds.has(foundId)) {
                    // dragged
                } else {
                    setSelectedIds(new Set([foundId]));
                }
                isDraggingSelection.current = true;
                lastDragPos.current = pt;
            } else {
                setSelectedIds(new Set());
                setSelectionBox({ start: pt, end: pt });
            }
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

        if (selectionBox) {
            setSelectionBox(prev => prev ? { ...prev, end: pt } : null);
            return;
        }

        if (mode === 'select' && isDraggingSelection.current && lastDragPos.current) {
            const dx = pt.x - lastDragPos.current.x;
            const dy = pt.y - lastDragPos.current.y;
            setElements(prev => prev.map(el => {
                if (selectedIds.has(el.id)) return updateElementPosition(el, dx, dy);
                return el;
            }));
            lastDragPos.current = pt;
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

        if (selectionBox) {
            const found = elements.filter(el => isElementInBox(el, selectionBox));
            const newIds = new Set(found.map(el => el.id));
            setSelectedIds(newIds);
            setSelectionBox(null);
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
                            const action = await onLinkClick(el.link, currentFolderId);
                            if (action === 'DELETE') {
                                setElements(prev => prev.map(item => {
                                    if (item.id === el.id) {
                                        const { link, ...rest } = item;
                                        return rest;
                                    }
                                    return item;
                                }));
                            }
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

        // Draw Selection Box
        if (selectionBox) {
            const { start, end } = selectionBox;
            const x = Math.min(start.x, end.x);
            const y = Math.min(start.y, end.y);
            const w = Math.abs(end.x - start.x);
            const h = Math.abs(end.y - start.y);

            ctx.save();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1 / currentTransform.scale;
            ctx.setLineDash([5 / currentTransform.scale, 5 / currentTransform.scale]);
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }

        ctx.restore(); // End Viewport Transform
    };

    // React Render Loop (Low frequency or logic updates)
    useEffect(() => {
        renderCanvas(transform);
    }, [elements, mode, transform, selectionBox, penWidth, eraserWidth, tick]);


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
                            const action = await onLinkClick(content, currentFolderId);
                            if (action === 'DELETE') {
                                const linkStr = `[[${content}]]`;
                                setNoteContent(prev => prev.replaceAll(linkStr, content));
                            }
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
        </div>

    );
};
