import type { Note } from '../db/db';

export interface GraphNode {
    id: string;
    title: string;
    // For force simulation
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
}

export interface GraphEdge {
    source: string; // Note ID
    target: string; // Note ID
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export const extractLinks = (notes: Note[]): GraphData => {
    const nodes: GraphNode[] = notes.map(n => ({
        id: n.id,
        title: n.title || '無題'
    }));

    const edges: GraphEdge[] = [];
    const noteIdMap = new Map<string, string>(); // Title -> ID mapping (first match win)

    // Build map for title lookup
    notes.forEach(n => {
        if (n.title) {
            // Normalize title for simpler matching? For now, exact match.
            noteIdMap.set(n.title, n.id);
        }
    });

    notes.forEach(note => {
        // 1. Text Links: [[Title]]
        const content = note.content || '';
        const regex = /\[\[(.*?)\]\]/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            const linkedTitle = match[1];
            const targetId = noteIdMap.get(linkedTitle);
            if (targetId && targetId !== note.id) {
                // Check if edge already exists to avoid duplicates
                const exists = edges.some(e =>
                    (e.source === note.id && e.target === targetId)
                );
                if (!exists) {
                    edges.push({ source: note.id, target: targetId });
                }
            }
        }

        // 2. Element Links: Drawings with 'link' property
        if (note.drawings) {
            note.drawings.forEach((el: any) => {
                if (el.link) {
                    const targetId = noteIdMap.get(el.link);
                    if (targetId && targetId !== note.id) {
                        const exists = edges.some(e =>
                            (e.source === note.id && e.target === targetId)
                        );
                        if (!exists) {
                            edges.push({ source: note.id, target: targetId });
                        }
                    }
                }
            });
        }
    });

    // Filter out nodes that have no edges? 
    // User requested "Mind map like", usually implies connected. 
    // But isolated notes are also part of the folder. 
    // Let's keep all nodes for now, or maybe only connected ones + selected?
    // "配置場所は各フォルダ内のトップ" -> Likely wants to see the structure.
    // Let's show all notes in the folder as nodes, even isolated ones.

    return { nodes, edges };
};
