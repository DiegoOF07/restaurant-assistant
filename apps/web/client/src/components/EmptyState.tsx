const SUGGESTIONS = [
  "¿Cuántas hamburguesas especiales puedo preparar?",
  "¿Qué alérgenos tiene el pastel de chocolate?",
  "Se dañaron 200 g de lechuga",
];

export function EmptyState({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
  return (
    <div className="empty">
      <p className="empty-kicker">Comanda abierta</p>
      <p className="empty-title">¿Qué necesitas saber de la cocina?</p>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="suggestion" disabled={disabled} onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
