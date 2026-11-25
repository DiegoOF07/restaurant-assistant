import { useEffect, useRef } from "react";
import type { LogEntry } from "@restaurant/host";
import type { SessionState } from "../api.js";

function PanelContent({ session, log }: { session?: SessionState; log: LogEntry[] }) {
  return (
    <>
      <section className="panel" aria-labelledby="servers-title">
        <h2 id="servers-title">Servidores MCP</h2>
        {(session?.servers ?? []).map((server) => (
          <div key={server.name} className="server">
            <p className="server-name">{server.name}</p>
            <p className="server-target">{server.target}</p>
            <details>
              <summary>{server.toolNames.length} herramientas</summary>
              <ul>
                {server.toolNames.map((t) => (
                  <li key={t}>
                    <code>{t}</code>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
      </section>
      <section className="panel" aria-labelledby="log-title">
        <h2 id="log-title">Registro MCP</h2>
        {log.length === 0 ? (
          <p className="muted">Sin eventos todavía.</p>
        ) : (
          <ol className="log" aria-live="polite">
            {log.slice(-60).map((entry) => (
              <li key={entry.sequence} className={entry.ok === false ? "log--bad" : undefined}>
                <time>{new Date(entry.timestamp).toLocaleTimeString("es-GT", { hour12: false })}</time>
                <span>
                  <span className="log-source">{entry.source}</span> <span className="log-kind">{entry.kind}</span>
                  {(entry.toolName || entry.method) && <code> {entry.toolName ?? entry.method}</code>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/** Columna fija en pantallas anchas. */
export function SidePanel({ session, log }: { session?: SessionState; log: LogEntry[] }) {
  return (
    <aside className="side" aria-label="Detalles técnicos">
      <PanelContent session={session} log={log} />
    </aside>
  );
}

/** En teléfono, los mismos detalles en una hoja que se abre desde el encabezado. */
export function DetailsSheet({ open, onClose, session, log }: { open: boolean; onClose: () => void; session?: SessionState; log: LogEntry[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" aria-label="Detalles técnicos" onClose={onClose}>
      <div className="sheet-head">
        <h2>Detalles</h2>
        <button type="button" className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <PanelContent session={session} log={log} />
    </dialog>
  );
}
