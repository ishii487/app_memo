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

export interface Rectangle { x: number; y: number; width: number; height: number; }

export function getBounds(element: DrawingElement): Rectangle {
    if (element.type === 'stroke') {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        if (element.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
        for (const p of element.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        // Add stroke width padding
        const padding = element.width / 2;
        return { x: minX - padding, y: minY - padding, width: maxX - minX + element.width, height: maxY - minY + element.width };
    } else if (element.type === 'line') {
        const { start, end } = element.params;
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        const padding = element.width / 2;
        return { x: minX - padding, y: minY - padding, width: maxX - minX + element.width, height: maxY - minY + element.width };
    } else if (element.type === 'rect') {
        const { x, y, width, height } = element.params;
        const padding = element.width / 2;
        return { x: x - padding, y: y - padding, width: width + element.width, height: height + element.width };
    } else if (element.type === 'circle') {
        const { x, y, radius } = element.params;
        const padding = element.width / 2;
        const size = (radius + padding) * 2;
        return { x: x - radius - padding, y: y - radius - padding, width: size, height: size };
    } else if (element.type === 'text') {
        // Approximate bounds for text (since we don't have measureText here)
        // Assume rough aspect ratio or logic.
        // Or updated externally? For now, simple approximation:
        const approximateWidth = element.content.length * (element.fontSize * 0.6);
        const approximateHeight = element.fontSize * 1.2;
        return { x: element.x, y: element.y - element.fontSize, width: approximateWidth, height: approximateHeight };
    }
    return { x: 0, y: 0, width: 0, height: 0 };
}
