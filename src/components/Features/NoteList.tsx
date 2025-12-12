import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { Plus, Folder as FolderIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '../../lib/utils';

interface NoteListProps {
    folderId: string | null;
    onSelectNote: (noteId: string) => void;
    onSelectFolder: (folderId: string) => void;
}

export const NoteList: React.FC<NoteListProps> = ({ folderId, onSelectNote, onSelectFolder }) => {
    // Notes: If folderId is null, filter where folderId is NOT set (uncategorized)
    const notes = useLiveQuery(
        () => folderId
            ? db.notes.where('folderId').equals(folderId).reverse().sortBy('updatedAt')
            : db.notes.filter(n => !n.folderId).reverse().sortBy('updatedAt')
        , [folderId]
    );

    // Folders: Fetch subfolders (or root folders)
    const subFolders = useLiveQuery(
        () => folderId
            ? db.folders.where('parentId').equals(folderId).toArray()
            : db.folders.filter(f => !f.parentId).toArray()
        , [folderId]
    );

    const createNote = async () => {
        const id = uuidv4();
        await db.notes.add({
            id,
            folderId,
            title: '無題のメモ',
            content: '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        onSelectNote(id);
    };

    if (!notes || !subFolders) return <div className="p-8 text-center text-muted-foreground">読み込み中...</div>;

    const isEmpty = notes.length === 0 && subFolders.length === 0;

    if (isEmpty) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                <p className="mb-4 text-center">このフォルダには何もありません</p>
                <button onClick={createNote} className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-transform shadow-lg active:scale-95">
                    <Plus size={20} />
                    新規作成
                </button>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col w-full max-w-5xl mx-auto">
            <div className="p-4 pt-6 pb-2 px-6 flex justify-between items-center sticky top-0 bg-background/95 backdrop-blur z-10">
                <h2 className="font-bold text-2xl tracking-tight">{folderId ? 'メモ' : 'ホーム'}</h2>
                <button onClick={createNote} className="p-3 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-transform active:scale-95" aria-label="Create Note">
                    <Plus size={24} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 px-6 pb-20">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {/* Folders */}
                    {subFolders.map(folder => (
                        <div
                            key={folder.id}
                            onClick={() => onSelectFolder(folder.id)}
                            className="group flex flex-col p-5 rounded-xl border border-border bg-secondary/50 hover:bg-secondary cursor-pointer transition-all shadow-sm hover:shadow-md h-32 relative overflow-hidden justify-center items-center"
                        >
                            <FolderIcon size={32} className="mb-2 opacity-50 text-foreground" />
                            <h3 className="font-bold text-lg text-center line-clamp-2">{folder.title}</h3>
                        </div>
                    ))}

                    {/* Notes */}
                    {notes.map(note => (
                        <div
                            key={note.id}
                            onClick={() => onSelectNote(note.id)}
                            className="group flex flex-col p-5 rounded-xl border border-border bg-card hover:border-primary/50 cursor-pointer transition-all shadow-sm hover:shadow-md hover:-translate-y-1 h-48 relative overflow-hidden"
                        >
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="font-bold text-lg line-clamp-2 leading-snug flex-1">{note.title || '無題のメモ'}</h3>
                                <button
                                    onClick={(e) => deleteNote(e, note.id)}
                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all -mr-2 -mt-2"
                                    title="Delete"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <div className="flex-1 text-sm text-muted-foreground overflow-hidden relative">
                                <p className="line-clamp-4 leading-relaxed opacity-80">{note.content || '(本文なし)'}</p>
                                <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent" />
                            </div>
                            <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground flex justify-between items-center opacity-60 group-hover:opacity-100 transition-opacity">
                                <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
