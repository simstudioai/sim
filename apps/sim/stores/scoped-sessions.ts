/**
 * Shared scope-lifecycle transitions for the per-chat desktop surface stores
 * (browser session, copilot terminal). Both stores keep a `sessions[scopeId]`
 * bucket map plus the id of the active scope; these pure helpers own that
 * bookkeeping so the lifecycle rules — identity-preserving no-ops and the
 * pristine-destination migrate guard — cannot drift between the two surfaces.
 */

export interface ScopedSessionsState<TSession> {
  activeScopeId: string | null
  sessions: Record<string, TSession>
}

/**
 * Applies `update` to one scope's bucket. Returning the same reference from
 * `update` is the no-op signal and produces an empty patch.
 */
export function withScopedSession<TSession extends object>(
  state: ScopedSessionsState<TSession>,
  scopeId: string,
  createInitial: () => TSession,
  update: (current: TSession) => TSession
) {
  const current = state.sessions[scopeId] ?? createInitial()
  const next = update(current)
  if (next === current) return {}
  return { sessions: { ...state.sessions, [scopeId]: next } }
}

/** Makes a scope active, clearing a suspension left by a previous deactivation. */
export function activateScopedSession<TSession extends { suspended: boolean }>(
  state: ScopedSessionsState<TSession>,
  scopeId: string,
  createInitial: () => TSession
) {
  const current = state.sessions[scopeId] ?? createInitial()
  const session = current.suspended ? { ...current, suspended: false } : current
  if (scopeId === state.activeScopeId && session === current) return {}
  const sessions =
    state.sessions[scopeId] === session ? state.sessions : { ...state.sessions, [scopeId]: session }
  return { activeScopeId: scopeId, sessions }
}

/**
 * Moves a scope's bucket to a new id (a pending chat adopting its server-
 * assigned id). A destination that already carries real state wins; only a
 * pristine placeholder may be replaced.
 */
export function migrateScopedSession<TSession extends object>(
  state: ScopedSessionsState<TSession>,
  fromScopeId: string,
  toScopeId: string,
  isPristine: (session: TSession) => boolean
) {
  if (fromScopeId === toScopeId) return {}
  const source = state.sessions[fromScopeId]
  const destination = state.sessions[toScopeId]
  if (!source || (destination && !isPristine(destination))) return {}
  const sessions = { ...state.sessions }
  delete sessions[fromScopeId]
  sessions[toScopeId] = source
  const activeScopeId = state.activeScopeId === fromScopeId ? toScopeId : state.activeScopeId
  return { activeScopeId, sessions }
}

/** Drops a scope's bucket entirely, deactivating it when it was active. */
export function discardScopedSession<TSession extends object>(
  state: ScopedSessionsState<TSession>,
  scopeId: string
) {
  if (!state.sessions[scopeId]) return {}
  const sessions = { ...state.sessions }
  delete sessions[scopeId]
  return state.activeScopeId === scopeId ? { activeScopeId: null, sessions } : { sessions }
}
