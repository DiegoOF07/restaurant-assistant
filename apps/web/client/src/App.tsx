import { useState } from "react";
import { useAssistant } from "./useAssistant.js";
import { Header } from "./components/Header.js";
import { Conversation } from "./components/Conversation.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { DetailsSheet, SidePanel } from "./components/SidePanel.js";

export function App() {
  const assistant = useAssistant();
  const { session, entries, log, busy, connected, confirmation } = assistant;
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="app">
      <Header session={session} connected={connected} busy={busy} onRoleChange={assistant.setRole} onOpenDetails={() => setSheetOpen(true)} />
      <main className="main">
        <Conversation entries={entries} busy={busy} disabled={busy || !connected} onSend={assistant.sendMessage} />
        <SidePanel session={session} log={log} />
      </main>
      <DetailsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} session={session} log={log} />
      {confirmation && <ConfirmDialog pending={confirmation} onAnswer={assistant.confirm} />}
    </div>
  );
}
