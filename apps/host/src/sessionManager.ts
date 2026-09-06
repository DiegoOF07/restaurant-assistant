import { Session } from "@restaurant/conversation";

/** Mapea sessionId a una Session, creando una nueva la primera vez que se pide un id no visto */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  get(sessionId: string): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new Session(sessionId);
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}