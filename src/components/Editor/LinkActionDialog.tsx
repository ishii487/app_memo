import React from 'react';
import { ExternalLink, Edit2, X } from 'lucide-react';

interface LinkActionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigate: () => void;
    onEdit: () => void;
    linkTitle: string;
}

export const LinkActionDialog: React.FC<LinkActionDialogProps> = ({ isOpen, onClose, onNavigate, onEdit, linkTitle }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold">Link Action</h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
                        <X size={20} />
                    </button>
                </div>

                <p className="mb-6 text-gray-600">
                    Link: <span className="font-medium text-blue-600">{linkTitle}</span>
                </p>

                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => { onNavigate(); onClose(); }}
                        className="flex items-center justify-center gap-2 w-full p-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                    >
                        <ExternalLink size={18} />
                        Go to Note
                    </button>
                    <button
                        onClick={() => { onEdit(); onClose(); }}
                        className="flex items-center justify-center gap-2 w-full p-3 border border-gray-300 rounded hover:bg-gray-50 transition"
                    >
                        <Edit2 size={18} />
                        Change Link
                    </button>
                </div>
            </div>
        </div>
    );
};
