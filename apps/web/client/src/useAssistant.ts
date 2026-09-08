import { useCallback, useEffect, useMemo, useReducer } from "react";
import { sendCommand, subscribeToEvents, type ServerEvent, type SessionState } from "./api.js";
import type { LogEntry } from "@restaurant/host";

/** Una entrada visible de la conversación. */
export type Entry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "error"; text: string }
  | {
      id: string;
      kind: "tool";
      toolName: string;
      server?: string;
      args: Record<string, unknown>;
      status: "pendiente" | "esperando confirmación" | "ok" | "error" | "cancelada";
    };

export interface PendingConfirmation {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface State {
  entries: Entry[];
  session?: SessionState;
  log: LogEntry[];
  busy: boolean;
  connected: boolean;
  confirmation?: PendingConfirmation;
}

type Action =
  | { type: "server_event"; event: ServerEvent }
  | { type: "user_message"; text: string }
  | { type: "connection"; connected: boolean };

const initialState: State = { entries: [], log: [], busy: false, connected: false };

let sequence = 0;
const nextId = () => `e${++sequence}`;

/** Marca la última llamada a una herramienta que siga abierta. */
function updateLastTool(entries: Entry[], toolName: string, status: Extract<Entry, { kind: "tool" }>["status"]): Entry[] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.kind === "tool" && entry.toolName === toolName && entry.status !== "ok" && entry.status !== "error") {
      const updated = [...entries];
      updated[i] = { ...entry, status };
      return updated;
    }
  }
  return entries;
}

function reducer(state: State, action: Action): State {
  if (action.type === "connection") return { ...state, connected: action.connected };

  if (action.type === "user_message") {
    return { ...state, entries: [...state.entries, { id: nextId(), kind: "user", text: action.text }] };
  }

  const event = action.event;
  switch (event.kind) {
    case "state":
      return { ...state, session: event.state, entries: [], log: [], confirmation: undefined };

    case "busy":
      return { ...state, busy: event.busy };

    case "assistant":
      return { ...state, entries: [...state.entries, { id: nextId(), kind: "assistant", text: event.text }] };

    case "error":
      return { ...state, entries: [...state.entries, { id: nextId(), kind: "error", text: event.message }] };

    case "log":
      return { ...state, log: event.entries };

    case "confirmation_required":
      return {
        ...state,
        confirmation: { requestId: event.requestId, toolName: event.toolName, args: event.args },
        entries: updateLastTool(state.entries, event.toolName, "esperando confirmación"),
      };

    case "confirmation_resolved":
      return { ...state, confirmation: undefined };

    case "conversation": {
      const inner = event.event;
      switch (inner.kind) {
        case "tool_call_requested":
          return {
            ...state,
            entries: [
              ...state.entries,
              {
                id: nextId(),
                kind: "tool",
                toolName: inner.toolCall.name,
                ...(event.serverName ? { server: event.serverName } : {}),
                args: inner.toolCall.arguments,
                status: "pendiente",
              },
            ],
          };

        case "tool_call_rejected":
          return { ...state, entries: updateLastTool(state.entries, inner.toolCall.name, "cancelada") };

        case "tool_call_confirmed":
          return { ...state, entries: updateLastTool(state.entries, inner.toolCall.name, "pendiente") };

        case "tool_call_result":
          return {
            ...state,
            entries: updateLastTool(state.entries, inner.toolCall.name, inner.isError ? "error" : "ok"),
          };

        case "tool_call_protocol_error":
          return {
            ...state,
            entries: [
              ...updateLastTool(state.entries, inner.toolCall.name, "error"),
              { id: nextId(), kind: "error", text: `${inner.toolCall.name}: ${inner.message}` },
            ],
          };

        default:
          return state;
      }
    }

    default:
      return state;
  }
}

/** Conecta con el backend y expone el estado de la conversación más las acciones. */
export function useAssistant() {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const unsubscribe = subscribeToEvents(
      (event) => {
        dispatch({ type: "connection", connected: true });
        dispatch({ type: "server_event", event });
      },
      () => dispatch({ type: "connection", connected: false }),
    );
    return unsubscribe;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    // El mensaje se pinta de inmediato; su respuesta llegará por el flujo de eventos.
    dispatch({ type: "user_message", text });
    try {
      await sendCommand({ kind: "message", text });
    } catch (err) {
      dispatch({
        type: "server_event",
        event: { kind: "error", message: err instanceof Error ? err.message : String(err) },
      });
    }
  }, []);

  const confirm = useCallback(async (requestId: string, approved: boolean) => {
    await sendCommand({ kind: "confirm", requestId, approved });
  }, []);

  const setRole = useCallback(async (role: string) => {
    await sendCommand({ kind: "set_role", role });
  }, []);

  const actions = useMemo(() => ({ sendMessage, confirm, setRole }), [sendMessage, confirm, setRole]);

  return { ...state, ...actions };
}
