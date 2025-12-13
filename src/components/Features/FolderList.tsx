import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { cn } from '../../lib/utils';
import { Folder as FolderIcon, Plus, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface FolderListProps {
    activeFolderId: string | null;
    onSelectFolder: (id: string | null) => void;
}

export const FolderList: React.FC<FolderListProps> = ({ activeFolderId, onSelectFolder }) => {
    const folders = useLiveQuery(() => db.folders.toArray());

    const createFolder = async () => {
        // Ideally use a modal, using prompt for MVP
        const title = prompt("フォルダ名を入力:");
        if (!title) return;
        await db.folders.add({
            id: uuidv4(),
            title,
            parentId: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    };

    const deleteFolder = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm("このフォルダと中のメモを全て削除しますか？")) {
            await db.transaction('rw', db.folders, db.notes, async () => {
                await db.notes.where('folderId').equals(id).delete();
                await db.folders.delete(id);
            });
            if (activeFolderId === id) onSelectFolder(null);
        }
    };

    if (!folders) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;

    return (
        <div className="flex flex-col gap-1 p-2 h-full">
            <div className="flex items-center justify-between p-2 mb-2">
                <h2 className="text-sm font-bold opacity-70">FOLDERS</h2>
                <button onClick={createFolder} className="p-1 hover:bg-accent rounded transition-colors" aria-label="New Folder">
                    <Plus size={16} />
                </button>
            </div>

            <button
                onClick={() => onSelectFolder(null)}
                className={cn(
                    "flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors text-sm font-medium",
                    activeFolderId === null
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
            >
                <FolderIcon size={18} />
                <span>すべてのメモ</span>
            </button>

            <div className="flex flex-col gap-1 mt-1 overflow-y-auto">
                {folders.filter(f => !f.parentId).map(folder => (
                    <div key={folder.id}
                        className={cn(
                            "group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors text-sm font-medium",
                            activeFolderId === folder.id
                                ? "bg-secondary text-secondary-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                        onClick={() => onSelectFolder(folder.id)}
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            <FolderIcon size={18} />
                            <span className="truncate">{folder.title}</span>
                        </div>
                        <button
                            onClick={(e) => deleteFolder(e, folder.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all"
                            aria-label="Delete"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
