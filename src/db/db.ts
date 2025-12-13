import Dexie, { type EntityTable } from 'dexie';

export interface Folder {
    id: string;
    title: string;
    parentId: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface Note {
    id: string;
    folderId: string | null;
    title: string;
    content: string; // Text content
    drawings?: any[]; // Vector strokes
    isFavorite?: boolean; // New field for favorite status
    createdAt: number;
    updatedAt: number;
}

const db = new Dexie('MemoAppDB') as Dexie & {
    folders: EntityTable<Folder, 'id'>,
    notes: EntityTable<Note, 'id'>
};

// Schema registration
db.version(3).stores({
    folders: 'id, name, parentId, createdAt, updatedAt',
    notes: 'id, title, folderId, isFavorite, createdAt, updatedAt'
}).upgrade(_trans => {
    // Determine if any migration logic is needed, usually dexie handles adding new indices gracefully
});


// Keep version 2 for backward compatibility reference if needed, but Dexie handles versions strictly
db.version(2).stores({
    folders: 'id, name, parentId, createdAt, updatedAt',
    notes: 'id, title, folderId, createdAt, updatedAt'
});

export { db };
