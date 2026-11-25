import { useEffect, useRef } from "react";
import type { PendingConfirmation } from "../useAssistant.js";

export function ConfirmDialog({ pending, onAnswer }: { pending: PendingConfirmation; onAnswer: (requestId: string, approved: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // Ante la duda no se toca el inventario: el foco empieza en Cancelar, no en la acción
    cancelRef.current?.focus();
    return () => dialog?.close();
  }, [pending.requestId]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onAnswer(pending.requestId, false);
      }}
    >
      <p className="confirm-kicker">Confirmar antes de ejecutar</p>
      <h2 id="confirm-title">{pending.text.question}</h2>
      {pending.text.details.map((d, i) => (
        <p key={i} className="confirm-detail">
          {d}
        </p>
      ))}
      <details className="ticket-details">
        <summary>Ver detalles</summary>
        <p className="details-label">
          herramienta <code>{pending.toolName}</code>
        </p>
        <pre>{JSON.stringify(pending.args, null, 2)}</pre>
      </details>
      <div className="confirm-actions">
        <button ref={cancelRef} type="button" className="btn" onClick={() => onAnswer(pending.requestId, false)}>
          Cancelar
        </button>
        <button type="button" className="btn btn--stamp" onClick={() => onAnswer(pending.requestId, true)}>
          {pending.text.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
