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

  const handleLinkClick = async (title: string) => {
    const cleanTitle = title.replace(/^\[\[|\]\]$/g, '');
    const existing = await db.notes.where('title').equals(cleanTitle).first();

    if (existing) {
      setNoteHistory(prev => [...prev, existing.id]);
    } else {
      // Prompt before creating a missing linked note
      if (confirm(`Linked note "${cleanTitle}" not found. Create it?`)) {
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
      }
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
