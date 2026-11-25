import type { SessionState } from "../api.js";

export function Header({
  session,
  connected,
  busy,
  onRoleChange,
  onOpenDetails,
}: {
  session?: SessionState;
  connected: boolean;
  busy: boolean;
  onRoleChange: (role: string) => void;
  onOpenDetails: () => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <h1>La Comanda</h1>
        <p>Asistente de cocina</p>
      </div>
      <div className="meta">
        <label className="role">
          <span className="role-label">Rol</span>
          <select value={session?.userRole ?? ""} disabled={!session || busy} onChange={(e) => onRoleChange(e.target.value)}>
            {(session?.roles ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <span className="tag tag--model" title="Modelo en uso">
          {session?.model ?? "demostración"}
        </span>
        <span className={`tag ${connected ? "tag--ok" : "tag--bad"}`}>
          <span className="dot" aria-hidden="true" />
          {connected ? "conectado" : "sin conexión"}
        </span>
        <button type="button" className="details-btn" onClick={onOpenDetails}>
          Detalles
        </button>
      </div>
    </header>
  );
}
