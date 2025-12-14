import type { DrawingElement } from './geometry';

export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class Quadtree {
    private bounds: Rectangle;
    private capacity: number;
    private elements: DrawingElement[];
    private divided: boolean;
    private northWest: Quadtree | null;
    private northEast: Quadtree | null;
    private southWest: Quadtree | null;
    private southEast: Quadtree | null;
    private depth: number;
    private maxDepth: number;

    constructor(bounds: Rectangle, capacity: number = 4, depth: number = 0, maxDepth: number = 10) {
        this.bounds = bounds;
        this.capacity = capacity;
        this.elements = [];
        this.divided = false;
        this.northWest = null;
        this.northEast = null;
        this.southWest = null;
        this.southEast = null;
        this.depth = depth;
        this.maxDepth = maxDepth;
    }

    clear() {
        this.elements = [];
        this.divided = false;
        this.northWest = null;
        this.northEast = null;
        this.southWest = null;
        this.southEast = null;
    }

    insert(element: DrawingElement): boolean {
        const elBounds = this.getElementBounds(element);

        if (!this.intersects(this.bounds, elBounds)) {
            return false;
        }

        if (this.elements.length < this.capacity || this.depth >= this.maxDepth) {
            this.elements.push(element);
            return true;
        }

        if (!this.divided) {
            this.subdivide();
        }

        // Add to all children that it intersects with
        // Note: This means an element might be in multiple leaf nodes, which is fine for rendering query
        // but might need deduplication in result if not careful.
        // Actually for simplicity, let's keep it simple: push to children.
        // If it doesn't fit exclusively in one, we might keep it in parent or push to multiple.
        // Standard Quadtree for AABB often pushes to all overlapping children.

        if (this.northWest!.insert(element)) return true;
        if (this.northEast!.insert(element)) return true;
        if (this.southWest!.insert(element)) return true;
        if (this.southEast!.insert(element)) return true;

        return false;
    }

    private subdivide() {
        const x = this.bounds.x;
        const y = this.bounds.y;
        const w = this.bounds.width / 2;
        const h = this.bounds.height / 2;

        this.northWest = new Quadtree({ x: x, y: y, width: w, height: h }, this.capacity, this.depth + 1, this.maxDepth);
        this.northEast = new Quadtree({ x: x + w, y: y, width: w, height: h }, this.capacity, this.depth + 1, this.maxDepth);
        this.southWest = new Quadtree({ x: x, y: y + h, width: w, height: h }, this.capacity, this.depth + 1, this.maxDepth);
        this.southEast = new Quadtree({ x: x + w, y: y + h, width: w, height: h }, this.capacity, this.depth + 1, this.maxDepth);

        this.divided = true;

        // Re-distribute existing elements?
        // Usually better to push them down if possible, but for AABB quadtree, 
        // objects can overlap boundaries.
        // Simple approach: Keep existing elements here? Or re-insert?
        // If we re-insert, we handle the multi-child overlap logic again.

        const oldElements = this.elements;
        this.elements = [];
        for (const el of oldElements) {
            if (this.northWest!.insert(el)) continue;
            if (this.northEast!.insert(el)) continue;
            if (this.southWest!.insert(el)) continue;
            if (this.southEast!.insert(el)) continue;

            // If for some reason it didn't fit in children (shouldn't happen if logic matches), put it back
            // But since 'insert' checks bounds, it should fit.
            // With AABB insertion logic above, it adds to ALL intersecting nodes.
        }
    }

    query(range: Rectangle, found: Set<DrawingElement> = new Set()): Set<DrawingElement> {
        if (!this.intersects(this.bounds, range)) {
            return found;
        }

        for (const el of this.elements) {
            // Check coarse bounds intersection
            if (this.intersects(this.getElementBounds(el), range)) {
                found.add(el);
            }
        }

        if (this.divided) {
            this.northWest!.query(range, found);
            this.northEast!.query(range, found);
            this.southWest!.query(range, found);
            this.southEast!.query(range, found);
        }

        return found;
    }

    private intersects(a: Rectangle, b: Rectangle): boolean {
        return !(b.x > a.x + a.width ||
            b.x + b.width < a.x ||
            b.y > a.y + a.height ||
            b.y + b.height < a.y);
    }

    private getElementBounds(el: DrawingElement): Rectangle {
        if (el.type === 'stroke') {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            // Pad for stroke width
            const padding = el.width / 2;
            for (const p of el.points) {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            }
            return { x: minX - padding, y: minY - padding, width: maxX - minX + el.width, height: maxY - minY + el.width };
        } else if (el.type === 'line') {
            const padding = el.width / 2;
            const { start, end } = el.params;
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            return { x: minX - padding, y: minY - padding, width: maxX - minX + el.width, height: maxY - minY + el.width };
        } else if (el.type === 'rect') {
            const padding = el.width / 2;
            const { x, y, width, height } = el.params;
            return { x: x - padding, y: y - padding, width: width + el.width, height: height + el.width };
        } else if (el.type === 'circle') {
            const padding = el.width / 2;
            const { x, y, radius } = el.params;
            // x, y is center
            return { x: x - radius - padding, y: y - radius - padding, width: (radius * 2) + el.width, height: (radius * 2) + el.width };
        } else if (el.type === 'text') {
            const w = el.content.length * el.fontSize * 0.6; // Approx
            const h = el.fontSize;
            return { x: el.x, y: el.y - h, width: w, height: h + 10 }; // Padding
        }
        return { x: 0, y: 0, width: 0, height: 0 };
    }
}
