declare global {
  namespace Express {
    interface Request {
      /** Attached by requireAuth (R-AUTH-3). Role is a token snapshot — the
       * per-request DB check (R-AUTH-8) is authoritative. */
      user?: { id: string; username: string; role: string }
    }
  }
}

export {}