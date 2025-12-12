import React, { useState } from 'react';
import { FolderList } from '../Features/FolderList';
import { Menu, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface AppLayoutProps {
    children: React.ReactNode;
    activeFolderId: string | null;
    onSelectFolder: (id: string | null) => void;
    title?: string;
    onTitleClick?: () => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children, activeFolderId, onSelectFolder, title = "Memo App", onTitleClick }) => {
    const [isSidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="flex h-screen w-full bg-background text-foreground overflow-hidden relative transition-colors duration-300">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                "fixed md:relative z-50 w-72 h-full bg-card border-r border-border transition-transform duration-300 ease-in-out md:translate-x-0 shadow-xl md:shadow-none",
                isSidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="p-4 border-b border-border flex items-center justify-between md:hidden">
                    <span className="font-bold text-lg">Menu</span>
                    <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-accent rounded-md">
                        <X size={20} />
                    </button>
                </div>

                <div className="h-full pt-4 md:pt-2">
                    {/* Logo or Title Area for Desktop */}
                    <div className="hidden md:flex items-center px-4 py-3 mb-2">
                        <div className="w-8 h-8 bg-primary rounded-lg mr-3 flex items-center justify-center font-bold text-primary-foreground">M</div>
                        <span className="font-bold text-xl tracking-tight">Memo</span>
                    </div>
                    <FolderList
                        activeFolderId={activeFolderId}
                        onSelectFolder={(id) => {
                            onSelectFolder(id);
                            if (window.innerWidth < 768) setSidebarOpen(false);
                        }}
                    />
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col h-full overflow-hidden relative w-full bg-background">
                {/* Mobile Header */}
                <header className="md:hidden flex items-center p-4 border-b border-border bg-card/50 backdrop-blur">
                    <button onClick={() => setSidebarOpen(true)} className="mr-4 p-2 -ml-2 hover:bg-accent rounded-md">
                        <Menu size={24} />
                    </button>
                    <h1
                        className={cn("text-lg font-bold truncate flex-1", onTitleClick && "cursor-pointer active:opacity-70")}
                        onClick={onTitleClick}
                    >
                        {title}
                    </h1>

                </header>

                <div className="flex-1 overflow-hidden relative">
                    {children}
                </div>
            </main>
        </div>
    );
};
