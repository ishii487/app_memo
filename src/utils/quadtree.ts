import { type DrawingElement, type Rectangle, getBounds } from './geometry';

export class Quadtree {
    private bounds: Rectangle;
    private capacity: number;
    private elements: DrawingElement[];
    private divided: boolean;
    private children: Quadtree[];
    private level: number;
    private maxLevels: number;

    constructor(bounds: Rectangle, capacity: number = 4, level: number = 0, maxLevels: number = 10) {
        this.bounds = bounds;
        this.capacity = capacity;
        this.elements = [];
        this.divided = false;
        this.children = [];
        this.level = level;
        this.maxLevels = maxLevels;
    }

    clear() {
        this.elements = [];
        this.children = [];
        this.divided = false;
    }

    insert(element: DrawingElement): boolean {
        const elementBounds = getBounds(element);

        if (!this.intersects(this.bounds, elementBounds)) {
            return false;
        }

        if (this.elements.length < this.capacity || this.level >= this.maxLevels) {
            this.elements.push(element);
            return true;
        }

        if (!this.divided) {
            this.subdivide();
        }

        let added = false;
        for (const child of this.children) {
            if (child.insert(element)) {
                added = true;
                // If an element overlaps multiple quadrants, we might add it to multiple?
                // Standard quadtree usually adds to the smallest node that fully contains it OR splits it.
                // Simple approach: Add to ALL interacting quadrants.
                // But this causes duplicates in query result. Handling duplicates is query's job.
            }
        }

        // If "Simple approach" above, we return true if added to ANY child.
        // BUT strict Point Quadtree puts points in leaves. Region Quadtree puts Rects.
        // For Rect Quadtree:
        // Option A: Store in this node if it doesn't fit in children.
        // Option B: Store references in all overlapping children.

        // Let's go with Option B (Reference in all overlapping) for culling accuracy,
        // but need to deduplicate in query.

        return added;
    }

    private subdivide() {
        const { x, y, width, height } = this.bounds;
        const w = width / 2;
        const h = height / 2;

        this.children.push(new Quadtree({ x: x, y: y, width: w, height: h }, this.capacity, this.level + 1, this.maxLevels));
        this.children.push(new Quadtree({ x: x + w, y: y, width: w, height: h }, this.capacity, this.level + 1, this.maxLevels));
        this.children.push(new Quadtree({ x: x, y: y + h, width: w, height: h }, this.capacity, this.level + 1, this.maxLevels));
        this.children.push(new Quadtree({ x: x + w, y: y + h, width: w, height: h }, this.capacity, this.level + 1, this.maxLevels));

        this.divided = true;

        // Redistribute existing elements?
        // If we adopt "Store in all overlapping", we should try to push existing elements down.
        // But if we do that, we must remove from here.
        // For simplicity in this implementation (and since insert is called mostly on batch load),
        // let's keep elements here only if they were stuck here.
        // Actually, clearer logic:
        // When capacity exceeded, we subdivide. Then we attempt to move ALL elements (including current) to children.
        // If an element fits in multiple children, add to all.
        // If we do this, "this.elements" should only imply "stuck at this level"?
        // No, standard simple implementation:
        // Just keep adding new ones to children. Existing ones stay? That makes query inefficient.

        // BETTER IMPLEMENTATION for Drawing App:
        // When inserting, if divided, try add to children.
        // If not divided, add to self. Check split.
        // If split, move all self elements to children, clear self elements.

        const oldElements = this.elements;
        this.elements = [];
        for (const el of oldElements) {
            let addedToChild = false;
            for (const child of this.children) {
                if (child.insert(el)) addedToChild = true;
            }
            if (!addedToChild) {
                // Should not happen if bounds check passed, unless it was outside?
                // But we check intersects at top.
            }
        }
    }


    query(range: Rectangle, found: Set<DrawingElement> = new Set()): DrawingElement[] {
        if (!this.intersects(this.bounds, range)) {
            return Array.from(found);
        }

        for (const element of this.elements) {
            if (this.intersects(getBounds(element), range)) {
                found.add(element);
            }
        }

        if (this.divided) {
            for (const child of this.children) {
                child.query(range, found);
            }
        }

        return Array.from(found);
    }

    private intersects(a: Rectangle, b: Rectangle): boolean {
        return !(a.x > b.x + b.width ||
            a.x + a.width < b.x ||
            a.y > b.y + b.height ||
            a.y + a.height < b.y);
    }
}
