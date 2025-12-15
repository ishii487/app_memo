import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Note } from '../../db/db';
import { extractLinks, type GraphData, type GraphNode, type GraphEdge } from '../../utils/graphUtils';
import { Maximize2, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface NoteGraphViewProps {
    notes: Note[];
    onSelectNote: (noteId: string) => void;
}

// Physics Parameters
const REPULSION = 2000; // Stronger repulsion for clearer spread
const SPRING_LENGTH = 120;
const SPRING_STRENGTH = 0.05;
const CENTERING_STRENGTH = 0.01; // Slightly stronger centering
const FRICTION = 0.85; // More friction for stability
const DT = 0.5; // Smaller time step for stability

export const NoteGraphView: React.FC<NoteGraphViewProps> = ({ notes, onSelectNote }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 300 }); // Initial height
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
    const [isExpanded, setIsExpanded] = useState(false);

    // Zoom & Pan State
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const [isDragging, setIsDragging] = useState(false);
    const lastPos = useRef({ x: 0, y: 0 });

    // Physics Logic (Pure function style for re-use)
    const runPhysicsTick = useCallback((nodes: GraphNode[], edges: GraphEdge[]) => {
        // 1. Repulsion
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const n1 = nodes[i];
                const n2 = nodes[j];
                if (n1.x === undefined || n1.y === undefined || n2.x === undefined || n2.y === undefined) continue;

                let dx = n1.x - n2.x;
                let dy = n1.y - n2.y;
                let distSq = dx * dx + dy * dy;
                // Prevent division by zero and extreme forces
                if (distSq < 1) { dx = 1; dy = 0; distSq = 1; }

                const dist = Math.sqrt(distSq);
                const force = REPULSION / (distSq + 100); // Add epsilon

                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                n1.vx = (n1.vx || 0) + fx * DT;
                n1.vy = (n1.vy || 0) + fy * DT;
                n2.vx = (n2.vx || 0) - fx * DT;
                n2.vy = (n2.vy || 0) - fy * DT;
            }
        }

        // 2. Spring
        edges.forEach(edge => {
            const source = nodes.find(n => n.id === edge.source);
            const target = nodes.find(n => n.id === edge.target);
            if (!source || !target) return;
            // Check both coords
            if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) return;

            let dx = target.x - source.x;
            let dy = target.y - source.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const displacement = dist - SPRING_LENGTH;
            const force = displacement * SPRING_STRENGTH;

            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            source.vx = (source.vx || 0) + fx * DT;
            source.vy = (source.vy || 0) + fy * DT;
            target.vx = (target.vx || 0) - fx * DT;
            target.vy = (target.vy || 0) - fy * DT;
        });

        // 3. Centering
        nodes.forEach(node => {
            if (node.x === undefined) node.x = 0;
            if (node.y === undefined) node.y = 0;
            // Pull towards (0,0) - which is relative center
            node.vx = (node.vx || 0) - node.x * CENTERING_STRENGTH;
            node.vy = (node.vy || 0) - node.y * CENTERING_STRENGTH;

            // Integration
            node.vx *= FRICTION;
            node.vy *= FRICTION;
            node.x += node.vx * DT;
            node.y += node.vy * DT;
        });
    }, []);

    // Initialize Graph Data with Pre-computation
    useEffect(() => {
        if (!notes || notes.length === 0) return;
        const data = extractLinks(notes);

        // Initial Random Positions
        // Distribute them a bit wider initially to avoid congestion
        data.nodes.forEach((node, i) => {
            // Spiral or random
            const angle = i * 0.5;
            const radius = 50 + i * 5;
            node.x = Math.cos(angle) * radius;
            node.y = Math.sin(angle) * radius;
            node.vx = 0;
            node.vy = 0;
        });

        // Pre-tick calculation to stabilize (prevent "exploding" on load)
        const iterations = 150;

        for (let i = 0; i < iterations; i++) {
            runPhysicsTick(data.nodes, data.edges);
        }

        // Find Hub Node (Max Connections) to center view
        let maxDegree = -1;
        let hubNode: GraphNode | null = null;
        const degreeMap = new Map<string, number>();
        data.edges.forEach(e => {
            degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
            degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
        });

        data.nodes.forEach(n => {
            const deg = degreeMap.get(n.id) || 0;
            if (deg > maxDegree) {
                maxDegree = deg;
                hubNode = n;
            }
        });

        let initialX = 0;
        let initialY = 0;

        if (hubNode) {
            const h = hubNode as GraphNode;
            if (h.x !== undefined && h.y !== undefined) {
                initialX = -h.x;
                initialY = -h.y;
            }
        }

        setGraphData(data);
        setTransform(prev => ({ ...prev, x: initialX, y: initialY, scale: 1 }));
    }, [notes, runPhysicsTick]);

    // Resize Handler
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };
        updateSize();
        // Use ResizeObserver for more robust resizing (e.g. when expanding)
        const ro = new ResizeObserver(updateSize);
        if (containerRef.current) ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, [isExpanded]);


    // Animation Loop
    useEffect(() => {
        if (!graphData.nodes.length) return;

        let animationFrameId: number;
        const simulate = () => {
            // Run one tick
            runPhysicsTick(graphData.nodes, graphData.edges);

            // Force re-render to update positions
            setGraphData(prev => ({ ...prev }));

            animationFrameId = requestAnimationFrame(simulate);
        };
        simulate();
        return () => cancelAnimationFrame(animationFrameId);
    }, [graphData.nodes.length, graphData.edges, runPhysicsTick]);


    // Interaction Handlers
    const handlePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation(); // Stop propagation to prevent immediate re-expansion if closing
        containerRef.current?.setPointerCapture(e.pointerId);
        setIsDragging(true);
        lastPos.current = { x: e.clientX, y: e.clientY };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        e.stopPropagation();
        if (isDragging) {
            const dx = e.clientX - lastPos.current.x;
            const dy = e.clientY - lastPos.current.y;
            setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            lastPos.current = { x: e.clientX, y: e.clientY };
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        containerRef.current?.releasePointerCapture(e.pointerId);
        setIsDragging(false);
    };

    // Toggle Expand
    const toggleExpand = (expanded: boolean) => {
        setIsExpanded(expanded);
    };

    if (graphData.nodes.length === 0) return null;

    // View Center
    const viewCenterX = dimensions.width / 2;
    const viewCenterY = dimensions.height / 2;

    return (
        <div
            ref={containerRef}
            className={cn(
                "bg-slate-50 border-b border-border overflow-hidden relative transition-all duration-300 ease-in-out touch-none",
                isExpanded ? "fixed inset-0 z-50 h-screen w-screen" : "w-full h-[200px]"
            )}
            onClick={() => !isExpanded && toggleExpand(true)}
            onPointerDown={(e) => isExpanded && handlePointerDown(e)} // Only handle drag here if expanded? No, always if draggable
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            <div className="absolute top-2 left-2 flex gap-2 z-10 pointer-events-none">
                <div className="text-[10px] text-slate-500 font-bold bg-white/80 px-2 py-1 rounded shadow-sm backdrop-blur">
                    Map Preview
                </div>
            </div>

            {/* Expand/Close Button */}
            {isExpanded ? (
                <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(false); }}
                    className="absolute top-2 right-2 p-2 bg-white/90 hover:bg-white rounded-full shadow-md border border-slate-200 z-50 text-slate-700 hover:text-red-500 transition-colors"
                    title="Close"
                >
                    <X size={24} />
                </button>
            ) : (
                <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(true); }}
                    className="absolute top-2 right-2 p-1.5 bg-white/80 hover:bg-white rounded-md shadow-sm border border-slate-200 z-10 transition-colors"
                    title="Maximize"
                >
                    <Maximize2 size={16} />
                </button>
            )}

            <svg
                width="100%"
                height="100%"
                className={cn("w-full h-full", isExpanded ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")} // Pointer cursor when small to indicate click-to-expand
                onPointerDown={handlePointerDown} // Attach drag logic here too
            >
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="22" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                    </marker>
                </defs>
                <g transform={`translate(${viewCenterX + transform.x}, ${viewCenterY + transform.y}) scale(${transform.scale})`}>
                    {/* Edges */}
                    {graphData.edges.map((edge, i) => {
                        const source = graphData.nodes.find(n => n.id === edge.source);
                        const target = graphData.nodes.find(n => n.id === edge.target);
                        if (!source || !target) return null;
                        return (
                            <line
                                key={i}
                                x1={source.x} y1={source.y}
                                x2={target.x} y2={target.y}
                                stroke="#cbd5e1"
                                strokeWidth="2"
                                markerEnd="url(#arrowhead)"
                            />
                        );
                    })}

                    {/* Nodes */}
                    {graphData.nodes.map(node => (
                        <g
                            key={node.id}
                            transform={`translate(${node.x}, ${node.y})`}
                            onClick={(e) => { e.stopPropagation(); if (!isDragging && isExpanded) onSelectNote(node.id); }}
                            className={cn("transition-opacity", isExpanded ? "cursor-pointer hover:opacity-80" : "")}
                        >
                            <circle r="18" fill="white" stroke="#3b82f6" strokeWidth="2" className="drop-shadow-sm" />
                            <text
                                dy="30"
                                textAnchor="middle"
                                className="text-[10px] fill-slate-700 font-medium pointer-events-none select-none"
                            >
                                {node.title.length > 8 ? node.title.substring(0, 8) + '...' : node.title}
                            </text>
                            <text dy="4" textAnchor="middle" className="text-xs font-bold fill-blue-600 pointer-events-none select-none">
                                {node.title.charAt(0)}
                            </text>
                        </g>
                    ))}
                </g>
            </svg>

            {/* Hint Overlay (only when small) */}
            {!isExpanded && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-transparent pointer-events-none"
                >
                    {/* Transparent overlay to catch taps if svg doesn't? No, container onClick handles it. */}
                </div>
            )}
        </div>
    );
};
