import { useEffect, useRef, useState } from "react";
import type { Entry } from "../useAssistant.js";
import { EmptyState } from "./EmptyState.js";
import { ToolTicket } from "./ToolTicket.js";

export function Conversation({ entries, busy, disabled, onSend }: { entries: Entry[]; busy: boolean; disabled: boolean; onSend: (text: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  // Lo último de un turno con varias herramientas es lo que importa
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, busy]);

  return (
    <section className="chat" aria-label="Conversación">
      <div className="transcript">
        {entries.length === 0 ? (
          <EmptyState disabled={disabled} onPick={onSend} />
        ) : (
          entries.map((entry) => <EntryView key={entry.id} entry={entry} />)
        )}
        {busy && <p className="thinking">pensando…</p>}
        <div ref={endRef} />
      </div>
      <Composer disabled={disabled} onSend={onSend} />
    </section>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  if (entry.kind === "user") return <p className="bubble bubble--user">{entry.text}</p>;
  if (entry.kind === "assistant") return <p className="bubble bubble--assistant">{entry.text}</p>;
  if (entry.kind === "error") return <p className="bubble bubble--error" role="alert">{entry.text}</p>;
  return <ToolTicket entry={entry} />;
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Al terminar cada turno el campo vuelve a tener el foco, salvo que haya un diálogo abierto
  useEffect(() => {
    if (!disabled && !document.querySelector("dialog[open]")) inputRef.current?.focus();
  }, [disabled]);
  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
  };
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="visually-hidden" htmlFor="message">
        Mensaje
      </label>
      <textarea
        ref={inputRef}
        id="message"
        rows={1}
        value={text}
        placeholder={disabled ? "Esperando respuesta…" : "Escribe tu mensaje"}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" className="btn btn--stamp" disabled={disabled || !text.trim()}>
        Enviar
      </button>
    </form>
  );
}
