import { useState, useEffect } from 'react'
import { AppLayout } from './components/Layout/AppLayout'
import { NoteList } from './components/Features/NoteList'
import { MemoEditor } from './components/Editor/MemoEditor'
import { db } from './db/db'
import { v4 as uuidv4 } from 'uuid'

function App() {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  // History stack: last item is current note
  const [noteHistory, setNoteHistory] = useState<string[]>([]);
  const activeNoteId = noteHistory.length > 0 ? noteHistory[noteHistory.length - 1] : null;
  const [activeNoteTitle, setActiveNoteTitle] = useState<string>("");
  const [initStatus, setInitStatus] = useState<string>("Initializing...");

  // Initial startup check
  useEffect(() => {
    const init = async () => {
      try {
        setInitStatus("Checking Database...");
        await db.open();
        setInitStatus("Loading Resources...");
        // Small artificial delay to let user see the status if it's too fast, 
        // reassuring them that things are working.
        await new Promise(r => setTimeout(r, 500));
        setInitStatus(""); // Clear status to finish loading
      } catch (e) {
        setInitStatus(`Error: ${e}`);
      }
    };
    init();
    init();
  }, []);

  // Fetch title when active note changes
  useEffect(() => {
    if (activeNoteId) {
      db.notes.get(activeNoteId).then(n => {
        if (n) setActiveNoteTitle(n.title);
      });
    }
  }, [activeNoteId]);

  if (initStatus) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground">
        <div className="text-xl font-bold mb-2">Memo App</div>
        <div className="text-sm text-muted-foreground animate-pulse">{initStatus}</div>
      </div>
    );
  }

  const handleLinkClick = async (title: string): Promise<'OPEN' | 'DELETE' | 'CANCEL'> => {
    const cleanTitle = title.replace(/^\[\[|\]\]$/g, '');
    const existing = await db.notes.where('title').equals(cleanTitle).first();

    if (existing) {
      setNoteHistory(prev => [...prev, existing.id]);
      return 'OPEN';
    } else {
      // Prompt: Create new or Delete link?
      // User requested: "Delete links where link destination is gone"
      // We offer a choice because maybe they just haven't created it yet.
      // But phrasing "Links to gone destinations should be deleted" implies stronger cleanup.
      // Let's prompt: "Note not found. [Create] [Delete Link] [Cancel]"
      // Using browser confirm/prompt is limited. We'll use a confirm for Create, and if No, maybe another confirm?
      // Or just a primitive flow:
      if (confirm(`Linked note "${cleanTitle}" not found.\n\nClick OK to CREATE it.\nClick Cancel to DELETE the link.`)) {
        const id = uuidv4();
        await db.notes.add({
          id,
          title: cleanTitle,
          folderId: activeFolderId,
          content: '',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        setNoteHistory(prev => [...prev, id]);
        return 'OPEN';
      } else {
        // If they cancelled creation, ask if they want to delete the link?
        // Or just assume Cancel = Delete? That's dangerous.
        // Let's ask explicitly.
        if (confirm(`Remove the broken link to "${cleanTitle}"?`)) {
          return 'DELETE';
        }
      }
      return 'CANCEL';
    }
  };

  const handleBack = () => {
    setNoteHistory(prev => {
      if (prev.length <= 1) return []; // If only 1 left, clear to go back to list
      return prev.slice(0, -1);
    });
  };

  const handleRenameTitle = async () => {
    if (!activeNoteId) return;
    const newTitle = prompt("Edit Note Title:", activeNoteTitle);
    if (newTitle && newTitle !== activeNoteTitle) {
      await db.notes.update(activeNoteId, { title: newTitle, updatedAt: Date.now() });
      setActiveNoteTitle(newTitle);
    }
  };

  return (
    <AppLayout
      activeFolderId={activeFolderId}
      onSelectFolder={(id) => {
        setActiveFolderId(id);
        setNoteHistory([]);
      }}
      title={activeNoteId ? activeNoteTitle : (activeFolderId ? "フォルダ" : "すべてのメモ")}
      onTitleClick={activeNoteId ? handleRenameTitle : undefined}
    >
      {activeNoteId ? (
        <MemoEditor
          noteId={activeNoteId}
          onBack={handleBack}
          onLinkClick={handleLinkClick}
          externalTitle={activeNoteTitle}
        />
      ) : (
        <NoteList
          folderId={activeFolderId}
          onSelectNote={(id) => setNoteHistory([id])}
          onSelectFolder={setActiveFolderId}
        />
      )}
    </AppLayout>
  )
}

export default App
