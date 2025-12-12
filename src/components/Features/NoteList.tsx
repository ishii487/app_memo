import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface NoteListProps {
    folderId: string | null;
    onSelectNote: (noteId: string) => void;
}

export const NoteList: React.FC<NoteListProps> = ({ folderId, onSelectNote }) => {
    const notes = useLiveQuery(
        () => folderId
            ? db.notes.where('folderId').equals(folderId).reverse().sortBy('updatedAt')
            : db.notes.orderBy('updatedAt').reverse().toArray()
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

    if (!notes) return <div className="p-8 text-center text-muted-foreground">読み込み中...</div>;

    if (notes.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                <p className="mb-4 text-center">このフォルダにはメモがありません</p>
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
                <h2 className="font-bold text-2xl tracking-tight">{folderId ? 'メモ' : 'すべてのメモ'}</h2>
                <button onClick={createNote} className="p-3 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-transform active:scale-95" aria-label="Create Note">
                    <Plus size={24} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 px-6 pb-20">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {notes.map(note => (
                        <div
                            key={note.id}
                            onClick={() => onSelectNote(note.id)}
                            className="group flex flex-col p-5 rounded-xl border border-border bg-card hover:border-primary/50 cursor-pointer transition-all shadow-sm hover:shadow-md hover:-translate-y-1 h-48 relative overflow-hidden"
                        >
                            <h3 className="font-bold text-lg mb-2 line-clamp-2 leading-snug">{note.title || '無題のメモ'}</h3>
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
