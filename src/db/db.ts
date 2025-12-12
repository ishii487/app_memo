import Dexie, { type EntityTable } from 'dexie';

export interface Folder {
    id: string;
    title: string;
    parentId: string | null;
    createdAt: number;
}

export interface Note {
    id: string;
    folderId: string | null;
    title: string;
    content: string; // Text content
    drawings?: any[]; // Vector strokes
    createdAt: number;
    updatedAt: number;
}

const db = new Dexie('MemoAppDB') as Dexie & {
    folders: EntityTable<Folder, 'id'>,
    notes: EntityTable<Note, 'id'>
};

// Schema registration
db.version(2).stores({
    folders: 'id, name, parentId, createdAt, updatedAt',
    notes: 'id, title, folderId, createdAt, updatedAt'
});

export { db };
