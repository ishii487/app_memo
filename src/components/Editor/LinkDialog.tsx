import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { Search, Plus, FileText, X } from 'lucide-react';

interface LinkDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (noteId: string, title: string) => void;
    onCreate: (title: string) => void;
    currentFolderId: string | null;
}

export const LinkDialog: React.FC<LinkDialogProps> = ({ isOpen, onClose, onSelect, onCreate, currentFolderId }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [newTitle, setNewTitle] = useState('');

    const notes = useLiveQuery(
        async () => {
            let collection = currentFolderId
                ? db.notes.where('folderId').equals(currentFolderId)
                : db.notes.filter(n => !n.folderId);

            const items = await collection.toArray();
            return items.sort((a, b) => b.updatedAt - a.updatedAt);
        },
        [currentFolderId]
    );

    if (!isOpen) return null;

    const filteredNotes = notes?.filter(n =>
        n.title.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    const handleCreate = () => {
        if (!newTitle.trim()) return;
        onCreate(newTitle);
        setNewTitle('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col max-h-[80vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold">Insert Link</h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                {/* Create New Section */}
                <div className="p-4 border-b bg-gray-50">
                    <label className="text-xs font-medium text-gray-500 mb-1 block">New Note Link</label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Title for new page..."
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                        />
                        <button
                            onClick={handleCreate}
                            disabled={!newTitle.trim()}
                            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                            <Plus size={16} /> Create
                        </button>
                    </div>
                </div>

                {/* Existing Notes List */}
                <div className="flex-1 overflow-y-auto min-h-0 p-2">
                    <div className="px-2 py-2 sticky top-0 bg-white z-10">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 text-gray-400" size={16} />
                            <input
                                type="text"
                                className="w-full border rounded pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="Search existing notes..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="mt-1 space-y-1">
                        {filteredNotes.length === 0 ? (
                            <div className="text-center text-gray-400 py-8 text-sm">
                                No notes found in this folder.
                            </div>
                        ) : (
                            filteredNotes.map(note => (
                                <button
                                    key={note.id}
                                    onClick={() => onSelect(note.id, note.title)}
                                    className="w-full text-left flex items-start gap-3 p-3 rounded hover:bg-blue-50 group transition-colors"
                                >
                                    <div className="p-2 bg-gray-100 rounded group-hover:bg-white transition-colors">
                                        <FileText size={18} className="text-gray-500 group-hover:text-blue-500" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate text-gray-800 group-hover:text-blue-700">
                                            {note.title || "Untitled"}
                                        </div>
                                        <div className="text-xs text-gray-400 mt-0.5">
                                            {new Date(note.updatedAt).toLocaleDateString()}
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
