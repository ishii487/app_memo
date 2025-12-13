import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Folder } from '../../db/db';
import { Plus, Folder as FolderIcon, Trash2, Star, Copy, FolderInput, X, Edit2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface NoteListProps {
    folderId: string | null;
    onSelectNote: (noteId: string) => void;
    onSelectFolder: (folderId: string) => void;
}

export const NoteList: React.FC<NoteListProps> = ({ folderId, onSelectNote, onSelectFolder }) => {
    // Notes: sort by Favorite then Date
    const notes = useLiveQuery(
        async () => {
            let collection = folderId
                ? db.notes.where('folderId').equals(folderId)
                : db.notes.filter(n => !n.folderId);

            const items = await collection.toArray();
            return items.sort((a, b) => {
                // Favorites first
                const favA = a.isFavorite ? 1 : 0;
                const favB = b.isFavorite ? 1 : 0;
                if (favA !== favB) return favB - favA;
                // Then Date Descending
                return b.updatedAt - a.updatedAt;
            });
        },
        [folderId]
    );

    // Folders: Fetch subfolders (or root folders)
    const subFolders = useLiveQuery(
        () => folderId
            ? db.folders.where('parentId').equals(folderId).toArray()
            : db.folders.filter(f => !f.parentId).toArray()
        , [folderId]
    );

    // Folder Info: Fetch current folder if we are inside one
    const currentFolder = useLiveQuery(
        async () => folderId ? await db.folders.get(folderId) : null,
        [folderId]
    );

    const createNote = async () => {
        const titleInput = prompt("新規メモのタイトルを入力してください:", "無題のメモ");
        if (titleInput === null) return; // Cancelled

        const id = uuidv4();
        await db.notes.add({
            id,
            folderId,
            title: titleInput || '無題のメモ',
            content: '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        onSelectNote(id);
    };

    const createFolder = async () => {
        const titleInput = prompt("新規フォルダの名前を入力してください:", "新しいフォルダ");
        if (titleInput === null) return;

        const id = uuidv4();
        await db.folders.add({
            id,
            title: titleInput || '新しいフォルダ',
            parentId: folderId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    };

    const deleteNote = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm("このメモを削除しますか？")) {
            await db.notes.delete(id);
        }
    };

    const duplicateNote = async (e: React.MouseEvent, noteId: string) => {
        e.stopPropagation();
        const note = await db.notes.get(noteId);
        if (!note) return;

        await db.notes.add({
            ...note,
            id: uuidv4(),
            title: `${note.title} のコピー`,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    };

    // Recursive folder duplication
    const duplicateFolderRecursive = async (sourceHeaderId: string, targetParentId: string | null) => {
        const sourceFolder = await db.folders.get(sourceHeaderId);
        if (!sourceFolder) return;

        const newFolderId = uuidv4();
        await db.folders.add({
            id: newFolderId,
            title: `${sourceFolder.title} のコピー`,
            parentId: targetParentId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });

        // Duplicate children notes
        const childNotes = await db.notes.where('folderId').equals(sourceHeaderId).toArray();
        for (const note of childNotes) {
            await db.notes.add({
                ...note,
                id: uuidv4(),
                folderId: newFolderId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }

        // Duplicate children folders
        const childFolders = await db.folders.where('parentId').equals(sourceHeaderId).toArray();
        for (const folder of childFolders) {
            // Recurse: child folder copies keep their own name structure logic, 
            // but for simplicity here we just copy the tree content. 
            // We reuse the function but we need to tweak it because we don't want "Copy of Copy of".
            // Actually, copying a subfolder should probably keep its original name if it's inside a copied folder structure.
            // But to use the same function, I'll separate the "create folder" and "copy content" logic?
            // For simplicity: We will just copy the subfolder structure exactly.
            // But wait, the function above adds "のコピー" to the title.
            // Let's manually do it here to avoid double "Copy".

            const newSubFolderId = uuidv4();
            await db.folders.add({
                ...folder,
                id: newSubFolderId,
                parentId: newFolderId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            // We need to copy *its* children too.
            // So we need a helper that copies contents from A to B.
            await copyFolderContents(folder.id, newSubFolderId);
        }
    };

    const copyFolderContents = async (sourceId: string, targetId: string) => {
        const childNotes = await db.notes.where('folderId').equals(sourceId).toArray();
        for (const note of childNotes) {
            await db.notes.add({
                ...note,
                id: uuidv4(),
                folderId: targetId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }
        const childFolders = await db.folders.where('parentId').equals(sourceId).toArray();
        for (const folder of childFolders) {
            const newSubId = uuidv4();
            await db.folders.add({
                ...folder,
                id: newSubId,
                parentId: targetId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            await copyFolderContents(folder.id, newSubId);
        }
    };

    const handleDuplicateFolder = async (e: React.MouseEvent, folderId: string) => {
        e.stopPropagation();
        if (!confirm("フォルダとその中身をすべて複製しますか？")) return;
        await duplicateFolderRecursive(folderId, currentFolder?.id || null);
    };

    const handleRenameFolder = async (e: React.MouseEvent, folder: Folder) => {
        e.stopPropagation();
        const newTitle = prompt("新しいフォルダ名を入力してください:", folder.title);
        if (newTitle === null || newTitle === folder.title) return;
        await db.folders.update(folder.id, { title: newTitle || '新しいフォルダ', updatedAt: Date.now() });
    };


    const toggleFavorite = async (e: React.MouseEvent, id: string, currentStatus?: boolean) => {
        e.stopPropagation();
        await db.notes.update(id, { isFavorite: !currentStatus });
    };

    const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = React.useState(false);

    // Reset selection when changing folder
    React.useEffect(() => {
        setIsSelectionMode(false);
        setSelectedIds(new Set());
    }, [folderId]);

    const handleSelect = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const toggleSelectionMode = () => {
        if (isSelectionMode) {
            setIsSelectionMode(false);
            setSelectedIds(new Set());
        } else {
            setIsSelectionMode(true);
        }
    };

    const handleBulkDelete = async () => {
        if (!confirm(`${selectedIds.size} 件の項目を削除しますか？`)) return;

        const ids = Array.from(selectedIds);
        // Determine if it's note or folder? IDs are unique UUIDs, but we need to know which table.
        // Or we can try deleting from both? ID collision unlikely.
        // But for correctness, we should know.
        // Actually, we can just try delete from both for simplicity or check.
        // Better: check current list.

        await db.transaction('rw', db.notes, db.folders, async () => {
            for (const id of ids) {
                await db.notes.delete(id);
                // For folders, we need recursive delete?
                // Or just delete the folder entry?
                // If we delete folder, we should probably delete children or move them to root?
                // Standard behavior: delete folder = delete contents.
                // We need to find if it is a folder.
                const folder = await db.folders.get(id);
                if (folder) {
                    // Recursive delete helper needed for bulk delete too.
                    // For now, let's just delete the folder and orphans will appear in root or be hidden?
                    // If we delete folder, `folderId` in notes remains pointing to deleted folder.
                    // Notes will be hidden (filtered out) unless we show orphans.
                    // Let's implement cascade delete for folders.
                    await deleteFolderRecursive(id);
                }
            }
        });
        setIsSelectionMode(false);
        setSelectedIds(new Set());
    };

    const deleteFolderRecursive = async (folderId: string) => {
        // Delete children notes
        const childNotes = await db.notes.where('folderId').equals(folderId).toArray();
        for (const note of childNotes) await db.notes.delete(note.id); // Or bulk delete

        // Delete children folders
        const childFolders = await db.folders.where('parentId').equals(folderId).toArray();
        for (const folder of childFolders) await deleteFolderRecursive(folder.id);

        await db.folders.delete(folderId);
    }

    const handleBulkFavorite = async () => {
        const ids = Array.from(selectedIds);
        await db.transaction('rw', db.notes, async () => {
            for (const id of ids) {
                const note = await db.notes.get(id);
                if (note) {
                    await db.notes.update(id, { isFavorite: !note.isFavorite });
                }
            }
        });
        setIsSelectionMode(false);
        setSelectedIds(new Set());
    };

    const [isMoveModalOpen, setIsMoveModalOpen] = React.useState(false);

    const handleBulkMove = async (targetFolderId: string) => {
        const ids = Array.from(selectedIds);
        await db.transaction('rw', db.notes, db.folders, async () => {
            for (const id of ids) {
                if (id === targetFolderId) continue;

                // Try Note
                const note = await db.notes.get(id);
                if (note) {
                    await db.notes.update(id, { folderId: targetFolderId, updatedAt: Date.now() });
                    continue;
                }

                // Try Folder
                const folder = await db.folders.get(id);
                if (folder) {
                    const isCircular = await checkCircularReference(id, targetFolderId);
                    if (!isCircular) {
                        await db.folders.update(id, { parentId: targetFolderId, updatedAt: Date.now() });
                    }
                }
            }
        });
        setIsMoveModalOpen(false);
        setIsSelectionMode(false);
        setSelectedIds(new Set());
    };

    // D&D Handlers removed to fix scroll issue and per user request. 
    // Only kept checkCircularReference for Bulk Move.

    // Check if targetParentId is a descendant of folderId (or is folderId itself)
    const checkCircularReference = async (folderId: string, targetParentId: string): Promise<boolean> => {
        if (folderId === targetParentId) return true;

        let currentId: string | null = targetParentId;
        while (currentId) {
            const fetchedFolder: Folder | undefined = await db.folders.get(currentId);
            if (!fetchedFolder) break;
            if (fetchedFolder.parentId === folderId) return true;
            if (fetchedFolder.id === folderId) return true; // Should be covered by first check but just in case
            currentId = fetchedFolder.parentId;
        }
        return false;
    };

    if (!notes || !subFolders) return <div className="p-8 text-center text-muted-foreground">読み込み中...</div>;

    const isEmpty = notes.length === 0 && subFolders.length === 0;
    const headerTitle = folderId ? (currentFolder?.title || 'フォルダ') : 'ホーム';

    if (isEmpty && !isSelectionMode) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                <p className="mb-4 text-center">このフォルダには何もありません</p>
                <div className="flex gap-4">
                    <button onClick={createFolder} className="flex items-center gap-2 px-6 py-3 bg-secondary text-secondary-foreground rounded-full font-medium hover:bg-secondary/80 transition-transform shadow-lg active:scale-95">
                        <FolderIcon size={20} />
                        新規フォルダ
                    </button>
                    <button onClick={createNote} className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-transform shadow-lg active:scale-95">
                        <Plus size={20} />
                        新規メモ
                    </button>
                </div>
            </div>
        );
    }

    // Helper to get folder style
    const getFolderStyle = (folder: Folder) => {
        const isSelected = selectedIds.has(folder.id);

        let className = "group flex flex-col p-5 rounded-xl border transition-all h-32 relative overflow-hidden justify-center items-center ";
        if (isSelected) {
            className += "bg-primary/10 border-primary ring-2 ring-primary ring-offset-2 ";
        } else {
            className += "border-border bg-secondary/50 hover:bg-secondary shadow-sm hover:shadow-md ";
        }

        if (isSelectionMode) className += "cursor-pointer";
        else className += "cursor-pointer"; // Folders always clickable

        return className;
    };


    return (
        <div className="h-full flex flex-col w-full max-w-5xl mx-auto">
            <div className={`p-4 pt-6 pb-2 px-6 flex justify-between items-center sticky top-0 bg-background/95 backdrop-blur z-10 transition-all ${isSelectionMode ? 'bg-primary/10' : ''}`}>
                {isSelectionMode ? (
                    <div className="flex items-center w-full justify-between">
                        <div className="font-bold text-xl">{selectedIds.size} 選択中</div>
                        <div className="flex gap-2">
                            <button onClick={handleBulkFavorite} className="p-2 hover:bg-background/20 rounded-full" title="Toggle Favorite">
                                <Star size={20} />
                            </button>
                            <button onClick={() => setIsMoveModalOpen(true)} className="p-2 hover:bg-background/20 rounded-full" title="Move Selected">
                                <FolderInput size={20} />
                            </button>
                            <button onClick={handleBulkDelete} className="p-2 hover:bg-destructive/20 hover:text-destructive rounded-full" title="Delete Selected">
                                <Trash2 size={20} />
                            </button>
                            <button onClick={toggleSelectionMode} className="px-4 py-2 text-sm font-bold bg-background/50 rounded-full" >
                                キャンセル
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <h2 className="font-bold text-2xl tracking-tight">{headerTitle}</h2>
                        <div className="flex gap-2">
                            <button onClick={toggleSelectionMode} className="p-3 bg-secondary text-secondary-foreground rounded-full shadow-lg hover:bg-secondary/80 transition-transform active:scale-95" title="選択">
                                <div className="w-6 h-6 border-2 border-current rounded-md flex items-center justify-center text-[10px]">✓</div>
                            </button>
                            <button onClick={createFolder} className="p-3 bg-secondary text-secondary-foreground rounded-full shadow-lg hover:bg-secondary/80 transition-transform active:scale-95" aria-label="Create Folder" title="新規フォルダ">
                                <FolderIcon size={24} />
                            </button>
                            <button onClick={createNote} className="p-3 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-transform active:scale-95" aria-label="Create Note" title="新規メモ">
                                <Plus size={24} />
                            </button>
                        </div>
                    </>
                )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 px-6 pb-20">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {/* Folders */}
                    {subFolders.map(folder => (
                        <div
                            key={folder.id}
                            onClick={isSelectionMode ? (e) => handleSelect(e, folder.id) : () => onSelectFolder(folder.id)}
                            className={getFolderStyle(folder)}
                        >
                            {isSelectionMode && (
                                <div className="absolute top-3 left-3">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${selectedIds.has(folder.id) ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground bg-background'}`}>
                                        {selectedIds.has(folder.id) && <Plus size={14} className="rotate-45" />}
                                    </div>
                                </div>
                            )}
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                {!isSelectionMode && (
                                    <>
                                        <button onClick={(e) => handleRenameFolder(e, folder)} className="p-1.5 hover:bg-background/50 rounded-full" title="Rename">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={(e) => handleDuplicateFolder(e, folder.id)} className="p-1.5 hover:bg-background/50 rounded-full" title="Duplicate">
                                            <Copy size={16} />
                                        </button>
                                    </>
                                )}
                            </div>
                            <FolderIcon size={32} className={`mb-2 ${selectedIds.has(folder.id) ? 'text-primary' : 'opacity-50 text-foreground'}`} />
                            <h3 className="font-bold text-lg text-center line-clamp-2">{folder.title}</h3>
                        </div>
                    ))}

                    {/* Notes */}
                    {notes.map(note => (
                        <div
                            key={note.id}
                            onClick={isSelectionMode ? (e) => handleSelect(e, note.id) : () => onSelectNote(note.id)}
                            className={`group flex flex-col p-5 rounded-xl border transition-all h-48 relative overflow-hidden ${selectedIds.has(note.id)
                                ? 'bg-primary/5 border-primary ring-2 ring-primary ring-offset-2'
                                : 'border-border bg-card hover:border-primary/50 shadow-sm hover:shadow-md hover:-translate-y-1'
                                } ${isSelectionMode ? 'cursor-pointer' : 'cursor-pointer'}`}
                        >
                            {isSelectionMode && (
                                <div className="absolute top-3 left-3 z-20">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${selectedIds.has(note.id) ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground bg-background'}`}>
                                        {selectedIds.has(note.id) && <Plus size={14} className="rotate-45" />}
                                    </div>
                                </div>
                            )}
                            <div className="flex justify-between items-start mb-2 relative z-10">
                                <h3 className={`font-bold text-lg line-clamp-2 leading-snug flex-1 pr-6 ${isSelectionMode ? 'pl-6' : ''}`}>{note.title || '無題のメモ'}</h3>
                                {!isSelectionMode && (
                                    <div className="flex flex-col gap-1 -mr-2 -mt-2">
                                        <button
                                            onClick={(e) => deleteNote(e, note.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 hover:text-destructive rounded transition-all"
                                            title="Delete"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <button
                                            onClick={(e) => duplicateNote(e, note.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-primary/10 hover:text-primary rounded transition-all"
                                            title="Duplicate"
                                        >
                                            <Copy size={16} />
                                        </button>
                                        <button
                                            onClick={(e) => toggleFavorite(e, note.id, note.isFavorite)}
                                            className={`p-1.5 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded transition-all ${note.isFavorite ? 'opacity-100 text-yellow-500' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-yellow-500'}`}
                                            title={note.isFavorite ? "Unfavorite" : "Favorite"}
                                        >
                                            <Star size={16} fill={note.isFavorite ? "currentColor" : "none"} />
                                        </button>
                                    </div>
                                )}
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

            {/* Move Modal */}
            {isMoveModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="flex justify-between items-center p-4 border-b border-border/50">
                            <h3 className="font-bold text-lg">移動先を選択</h3>
                            <button onClick={() => setIsMoveModalOpen(false)} className="p-1 hover:bg-muted rounded-full">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                            {(!subFolders || subFolders.filter(f => !selectedIds.has(f.id)).length === 0) ? (
                                <p className="p-4 text-center text-muted-foreground text-sm">移動可能なフォルダがありません</p>
                            ) : (
                                <div className="grid gap-1">
                                    {subFolders
                                        .filter(f => !selectedIds.has(f.id))
                                        .map(folder => (
                                            <button
                                                key={folder.id}
                                                onClick={() => handleBulkMove(folder.id)}
                                                className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
                                            >
                                                <FolderIcon size={20} className="text-secondary-foreground" />
                                                <span className="font-medium truncate">{folder.title}</span>
                                            </button>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
