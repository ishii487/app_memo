import React, { useEffect, useRef, useState } from 'react';
import type { Note } from '../../db/db';
import { extractLinks, type GraphData } from '../../utils/graphUtils';

interface NoteGraphViewProps {
    notes: Note[];
    onSelectNote: (noteId: string) => void;
}

export const NoteGraphView: React.FC<NoteGraphViewProps> = ({ notes, onSelectNote }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
    const [dimensions, setDimensions] = useState({ width: 0, height: 300 });

    // Initialize Graph Data
    useEffect(() => {
        const data = extractLinks(notes);
        // Initialize positions randomly but centered
        data.nodes.forEach(node => {
            node.x = Math.random() * 100 - 50;
            node.y = Math.random() * 100 - 50;
            node.vx = 0;
            node.vy = 0;
        });
        setGraphData(data);
    }, [notes]);

    // Handle Resize
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setDimensions(prev => ({
                    ...prev,
                    width: containerRef.current!.clientWidth
                }));
            }
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Simulation Loop
    useEffect(() => {
        if (!graphData.nodes.length) return;

        let animationFrameId: number;

        const simulate = () => {
            const nodes = graphData.nodes;
            const edges = graphData.edges;
            const width = dimensions.width || 300;
            const height = dimensions.height;
            const center = { x: width / 2, y: height / 2 };

            // Parameters
            const repulsion = 5000;
            const springLength = 100;
            const springStrength = 0.05;
            const centeringStrength = 0.005;
            const friction = 0.9;
            const dt = 1; // Time step

            // 1. Repulsion (Node-Node)
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const n1 = nodes[i];
                    const n2 = nodes[j];
                    if (!n1.x || !n1.y || !n2.x || !n2.y) continue;

                    let dx = n1.x - n2.x;
                    let dy = n1.y - n2.y;
                    let distSq = dx * dx + dy * dy;
                    if (distSq === 0) { dx = 1; dy = 0; distSq = 1; }

                    const dist = Math.sqrt(distSq);
                    const force = repulsion / (distSq + 1); // Clamp

                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;

                    n1.vx = (n1.vx || 0) + fx * dt;
                    n1.vy = (n1.vy || 0) + fy * dt;
                    n2.vx = (n2.vx || 0) - fx * dt;
                    n2.vy = (n2.vy || 0) - fy * dt;
                }
            }

            // 2. Spring (Edge)
            edges.forEach(edge => {
                const source = nodes.find(n => n.id === edge.source);
                const target = nodes.find(n => n.id === edge.target);
                if (!source || !target) return;

                // Initialize positions if missing (shouldn't happen with init)
                if (source.x === undefined) source.x = center.x;
                if (source.y === undefined) source.y = center.y;
                if (target.x === undefined) target.x = center.x;
                if (target.y === undefined) target.y = center.y;

                let dx = target.x - source.x;
                let dy = target.y - source.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Hooke's Law
                const displacement = dist - springLength;
                const force = displacement * springStrength;

                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                source.vx = (source.vx || 0) + fx * dt;
                source.vy = (source.vy || 0) + fy * dt;
                target.vx = (target.vx || 0) - fx * dt;
                target.vy = (target.vy || 0) - fy * dt;
            });

            // 3. Centering & Integration
            nodes.forEach(node => {
                // Initialize if needed
                if (node.x === undefined) node.x = 0;
                if (node.y === undefined) node.y = 0;
                // Center force
                node.vx = (node.vx || 0) - (node.x) * centeringStrength;
                node.vy = (node.vy || 0) - (node.y) * centeringStrength;

                // Update position
                node.vx *= friction;
                node.vy *= friction;
                node.x += node.vx * dt;
                node.y += node.vy * dt;
            });

            // Force strict Re-render? 
            // In React, modifying mutable objects in state array doesn't trigger re-render unless we set state.
            // But doing setGraphData every frame is heavy.
            // Using a ref for data and forcing update via requestAnimationFrame loop is better?
            // For simplicity in React, let's use a forceUpdate or set a tick state.
            setGraphData(prev => ({ ...prev }));

            animationFrameId = requestAnimationFrame(simulate);
        };

        simulate();

        return () => cancelAnimationFrame(animationFrameId);
    }, [graphData.edges, graphData.nodes.length, dimensions]);
    // Dependency on 'length' ensures we restart simulation on data change, 
    // but keep running otherwise. 'edges' stable ref ideally.

    if (graphData.nodes.length === 0) return null;

    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;

    return (
        <div ref={containerRef} className="w-full bg-slate-50 border-b border-border overflow-hidden relative" style={{ height: dimensions.height }}>
            <svg width="100%" height="100%">
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="22" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                    </marker>
                </defs>
                <g transform={`translate(${centerX}, ${centerY})`}>
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
                            onClick={(e) => { e.stopPropagation(); onSelectNote(node.id); }}
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                        >
                            <circle r="18" fill="white" stroke="#3b82f6" strokeWidth="2" className="drop-shadow-sm" />
                            <text
                                dy="30"
                                textAnchor="middle"
                                className="text-[10px] fill-slate-700 font-medium pointer-events-none select-none"
                            >
                                {node.title.length > 8 ? node.title.substring(0, 8) + '...' : node.title}
                            </text>
                            {/* Icon/First Letter inside circle? */}
                            <text dy="4" textAnchor="middle" className="text-xs font-bold fill-blue-600 pointer-events-none select-none">
                                {node.title.charAt(0)}
                            </text>
                        </g>
                    ))}
                </g>
            </svg>
            <div className="absolute top-2 left-2 text-xs text-slate-400 font-bold bg-white/50 px-2 py-1 rounded">
                Map
            </div>
        </div>
    );
};
