import { useEffect, useRef, useState } from "react";
import { useAssistant, type Entry, type PendingConfirmation } from "./useAssistant.js";
import type { LogEntry } from "@restaurant/host";
import type { SessionState } from "./api.js";

export function App() {
  const assistant = useAssistant();
  const { session, entries, log, busy, connected, confirmation } = assistant;

  return (
    <div className="app">
      <Header session={session} connected={connected} onRoleChange={assistant.setRole} busy={busy} />

      <main className="main">
        <section className="chat">
          <Transcript entries={entries} busy={busy} />
          <Composer disabled={busy || !connected} onSend={assistant.sendMessage} />
        </section>

        <aside className="side">
          <ServersPanel session={session} />
          <LogPanel entries={log} />
        </aside>
      </main>

      {confirmation && <ConfirmationDialog pending={confirmation} onAnswer={assistant.confirm} />}
    </div>
  );
}

function Header({
  session,
  connected,
  busy,
  onRoleChange,
}: {
  session?: SessionState;
  connected: boolean;
  busy: boolean;
  onRoleChange: (role: string) => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <h1>Asistente MCP de Restaurante</h1>
        <p>Host + cliente MCP sobre JSON-RPC 2.0, sin SDK</p>
      </div>

      <div className="meta">
        <label className="role">
          <span>rol</span>
          <select
            value={session?.userRole ?? ""}
            disabled={!session || busy}
            onChange={(e) => onRoleChange(e.target.value)}
          >
            {(session?.availableRoles ?? []).map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>

        <span className="chip" title="Modelo en uso">
          {session?.model ?? "demostración"}
        </span>

        <span className={`chip ${connected ? "ok" : "bad"}`}>{connected ? "conectado" : "sin conexión"}</span>
      </div>
    </header>
  );
}

function Transcript({ entries, busy }: { entries: Entry[]; busy: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  // Se baja al final en cada cambio: durante un turno con varias herramientas, lo último
  // es lo que importa.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, busy]);

  if (entries.length === 0) {
    return (
      <div className="transcript empty">
        <p>Preguntá por la disponibilidad de un platillo, sus alérgenos, o pedí un ajuste de inventario.</p>
      </div>
    );
  }

  return (
    <div className="transcript">
      {entries.map((entry) => (
        <EntryView key={entry.id} entry={entry} />
      ))}
      {busy && <div className="thinking">pensando…</div>}
      <div ref={endRef} />
    </div>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  if (entry.kind === "user") return <div className="bubble user">{entry.text}</div>;
  if (entry.kind === "assistant") return <div className="bubble assistant">{entry.text}</div>;
  if (entry.kind === "error") return <div className="bubble error">{entry.text}</div>;

  return (
    <div className={`tool ${entry.status.replace(/\s/g, "-")}`}>
      <div className="tool-head">
        <strong>{entry.toolName}</strong>
        {entry.server && <span className="server">{entry.server}</span>}
        <span className="status">{entry.status}</span>
      </div>
      <code className="args">{formatArgs(entry.args)}</code>
    </div>
  );
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <form className="composer" onSubmit={submit}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? "Esperando respuesta…" : "Escribí tu mensaje"}
        disabled={disabled}
        autoFocus
      />
      <button type="submit" disabled={disabled || text.trim() === ""}>
        Enviar
      </button>
    </form>
  );
}

function ServersPanel({ session }: { session?: SessionState }) {
  if (!session) return <Panel title="Servidores MCP">Conectando…</Panel>;

  return (
    <Panel title={`Servidores MCP (${session.servers.length})`} subtitle={session.serverSource}>
      {session.servers.map((server) => (
        <div key={server.name} className="server-card">
          <div className="server-name">{server.name}</div>
          <div className="server-target">{server.target}</div>
          <ul className="tool-list">
            {server.toolNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ))}
    </Panel>
  );
}

function LogPanel({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) return <Panel title="Registro MCP">Sin eventos todavía.</Panel>;

  return (
    <Panel title={`Registro MCP (${entries.length})`}>
      <div className="log">
        {entries.map((entry) => (
          <div key={entry.sequence} className={`log-line ${entry.source}`}>
            <span className="log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span className="log-source">{entry.source}</span>
            <span className="log-kind">{entry.kind}</span>
            <span className="log-detail">{[entry.toolName, entry.method].filter(Boolean).join(" ")}</span>
            {entry.ok !== undefined && <span className={entry.ok ? "ok" : "bad"}>{entry.ok ? "✓" : "✗"}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ConfirmationDialog({
  pending,
  onAnswer,
}: {
  pending: PendingConfirmation;
  onAnswer: (requestId: string, approved: boolean) => void;
}) {
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Se requiere tu confirmación</h2>
        <p className="dialog-sub">Esta operación modifica datos.</p>

        <dl className="dialog-args">
          <dt>herramienta</dt>
          <dd>{pending.toolName}</dd>
          {Object.entries(pending.args).map(([key, value]) => (
            <div key={key} className="arg-row">
              <dt>{key}</dt>
              <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>

        <div className="dialog-actions">
          {/* Cancelar es el botón con foco: ante la duda, no se toca el inventario. */}
          <button autoFocus onClick={() => onAnswer(pending.requestId, false)}>Cancelar</button>
          <button className="danger" onClick={() => onAnswer(pending.requestId, true)}>
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {subtitle && <span>{subtitle}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function formatArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return parts.join("  ") || "(sin argumentos)";
}
