import { useState, useEffect } from 'react'
import { AppLayout } from './components/Layout/AppLayout'
import { NoteList } from './components/Features/NoteList'
import { MemoEditor } from './components/Editor/MemoEditor'
import { db } from './db/db'
import { v4 as uuidv4 } from 'uuid'

function App() {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
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
  }, []);

  if (initStatus) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground">
        <div className="text-xl font-bold mb-2">Memo App</div>
        <div className="text-sm text-muted-foreground animate-pulse">{initStatus}</div>
      </div>
    );
  }

  const handleLinkClick = async (title: string) => {
    // Clean title (remove brackets if passed)
    const cleanTitle = title.replace(/^\[\[|\]\]$/g, '');

    // Find existing note
    const existing = await db.notes.where('title').equals(cleanTitle).first();
    if (existing) {
      setActiveNoteId(existing.id);
    } else {
      // Create new note
      const confirmCreate = confirm(`Create new note "${cleanTitle}"?`);
      if (!confirmCreate) return;

      const id = uuidv4();
      await db.notes.add({
        id,
        title: cleanTitle,
        folderId: activeFolderId, // Create in current folder view
        content: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      setActiveNoteId(id);
    }
  };

  return (
    <AppLayout
      activeFolderId={activeFolderId}
      onSelectFolder={(id) => {
        setActiveFolderId(id);
        setActiveNoteId(null);
      }}
      title={activeNoteId ? "エディタ" : (activeFolderId ? "フォルダ" : "すべてのメモ")}
    >
      {activeNoteId ? (
        <MemoEditor
          noteId={activeNoteId}
          onBack={() => setActiveNoteId(null)}
          onLinkClick={handleLinkClick}
        />
      ) : (
        <NoteList folderId={activeFolderId} onSelectNote={setActiveNoteId} />
      )}
    </AppLayout>
  )
}

export default App
