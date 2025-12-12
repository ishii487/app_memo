export interface Point { x: number; y: number; }
export interface Stroke { points: Point[]; color: string; width: number; type: 'stroke'; id: string; link?: string }
export interface Shape { type: 'line' | 'rect' | 'circle'; params: any; color: string; width: number; id: string; link?: string }

export interface TextElement { x: number; y: number; content: string; fontSize: number; color: string; type: 'text'; id: string; link?: string }
export type DrawingElement = Stroke | Shape | TextElement;

export function distance(a: Point, b: Point) {
    return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

export function recognizeShape(points: Point[]): { type: 'line' | 'rect' | 'circle', params: any } | null {
    if (points.length < 10) return null;

    const start = points[0];
    const end = points[points.length - 1];
    const dist = distance(start, end);

    let totalLength = 0;
    let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;

    for (let i = 1; i < points.length; i++) {
        totalLength += distance(points[i - 1], points[i]);
        minX = Math.min(minX, points[i].x);
        maxX = Math.max(maxX, points[i].x);
        minY = Math.min(minY, points[i].y);
        maxY = Math.max(maxY, points[i].y);
    }

    // Line Detection
    // Straightness: (distance start to end) / total path length
    const straightness = dist / totalLength;
    if (straightness > 0.93) {
        return { type: 'line', params: { start, end } };
    }

    // Closed Loop Check (Circle or Rect)
    // If start and end are close relative to total length ( < 20% or fixed pixel threshold)
    if (dist < totalLength * 0.2 || dist < 40) {
        const width = maxX - minX;
        const height = maxY - minY;

        // Check for Circle
        // Simple heuristic: deviation from average radius?
        // Or just assume it's a circle if aspect ratio is roughly 1?
        const ratio = width / height;

        // Rect detection is harder (corners). 
        // Let's implement Circle first for simplicity if loop is relatively round.

        if (ratio > 0.8 && ratio < 1.2) {
            return {
                type: 'circle',
                params: {
                    x: minX + width / 2,
                    y: minY + height / 2,
                    radius: (width + height) / 4
                }
            };
        }

        // If not a circle, maybe a Rect?
        // Simplified: Just returning Rect for non-circle loops
        return {
            type: 'rect',
            params: {
                x: minX,
                y: minY,
                width,
                height
            }
        }
    }

    return null;
}
