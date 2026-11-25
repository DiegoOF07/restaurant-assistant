import { humanizeToolName } from "@restaurant/presentation";
import type { Entry } from "../useAssistant.js";

type ToolEntry = Extract<Entry, { kind: "tool" }>;

const ICON = { ok: "✓", warn: "▲", error: "✕", info: "•" } as const;

const STAMP = { ok: "Listo", warn: "Atención", error: "No se pudo", info: "Consulta" } as const;

const STATUS_TEXT: Record<ToolEntry["status"], string> = {
  pendiente: "trabajando…",
  "esperando confirmación": "esperando tu confirmación",
  cancelada: "cancelada",
  ok: "",
  error: "",
};

/** Un resultado como ticket de comanda: lo legible al frente, lo técnico plegado. */
export function ToolTicket({ entry }: { entry: ToolEntry }) {
  const summary = entry.summary;
  const tone = summary?.tone ?? (entry.status === "cancelada" ? "warn" : "info");
  return (
    <article className={`ticket ticket--${tone}`} aria-label={humanizeToolName(entry.toolName)}>
      <header className="ticket-head">
        <span className="ticket-kind">{humanizeToolName(entry.toolName)}</span>
        {STATUS_TEXT[entry.status] ? (
          <span className="ticket-status">{STATUS_TEXT[entry.status]}</span>
        ) : (
          summary && <span className="ticket-stamp">{STAMP[summary.tone]}</span>
        )}
      </header>
      {summary && (
        <>
          <p className="ticket-title">
            <span className="ticket-icon" aria-hidden="true">
              {ICON[summary.tone]}
            </span>
            {summary.title}
          </p>
          {summary.lines.length > 0 && (
            <ul className="ticket-lines">
              {summary.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {summary.items && summary.items.length > 0 && (
            <dl className="ticket-items">
              {summary.items.map((item, i) => (
                <div key={i} className={item.tone ? `item--${item.tone}` : undefined}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
      <details className="ticket-details">
        <summary>Ver detalles</summary>
        <dl>
          <div>
            <dt>herramienta</dt>
            <dd>
              <code>{entry.toolName}</code>
            </dd>
          </div>
          {entry.server && (
            <div>
              <dt>servidor</dt>
              <dd>{entry.server}</dd>
            </div>
          )}
        </dl>
        <p className="details-label">argumentos</p>
        <pre>{JSON.stringify(entry.args, null, 2)}</pre>
        {entry.technicalError && (
          <>
            <p className="details-label">error técnico</p>
            <pre>{entry.technicalError}</pre>
          </>
        )}
        {entry.result !== undefined && (
          <>
            <p className="details-label">resultado</p>
            <pre>{JSON.stringify(entry.result, null, 2)}</pre>
          </>
        )}
      </details>
    </article>
  );
}
