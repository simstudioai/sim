import { useCallback, useMemo, useReducer } from 'react'
import type { FilePreviewSession } from '@/lib/copilot/request/session'

export interface FilePreviewSessionsState {
  activeSessionId: string | null
  sessions: Record<string, FilePreviewSession>
}

export type FilePreviewSessionsAction =
  | { type: 'hydrate'; sessions: FilePreviewSession[] }
  | { type: 'upsert'; session: FilePreviewSession; activate?: boolean }
  | { type: 'complete'; session: FilePreviewSession }
  | { type: 'remove'; sessionId: string }
  | { type: 'reset' }

export const INITIAL_FILE_PREVIEW_SESSIONS_STATE: FilePreviewSessionsState = {
  activeSessionId: null,
  sessions: {},
}

export function hasRenderableFilePreviewContent(session: FilePreviewSession): boolean {
  return session.previewText.length > 0 || session.previewVersion > 0
}

export function shouldReplaceSession(
  current: FilePreviewSession | undefined,
  next: FilePreviewSession
): boolean {
  if (!current) return true
  if (
    current.status === 'complete' &&
    next.status !== 'complete' &&
    next.previewVersion <= current.previewVersion
  ) {
    return false
  }
  if (next.previewVersion !== current.previewVersion) {
    return next.previewVersion > current.previewVersion
  }
  return next.updatedAt >= current.updatedAt
}

export function pickActiveSessionId(
  sessions: Record<string, FilePreviewSession>,
  preferredId?: string | null
): string | null {
  if (preferredId && sessions[preferredId]?.status !== 'complete') {
    return preferredId
  }

  let latestActive: FilePreviewSession | null = null
  for (const session of Object.values(sessions)) {
    if (session.status === 'complete') continue
    if (!latestActive || shouldReplaceSession(latestActive, session)) {
      latestActive = session
    }
  }

  return latestActive?.id ?? null
}

export function buildCompletedPreviewSessions(
  sessions: Record<string, FilePreviewSession>,
  completedAt: string
): FilePreviewSession[] {
  return Object.values(sessions)
    .filter((session) => session.status !== 'complete')
    .map((session) => ({
      ...session,
      status: 'complete' as const,
      updatedAt: completedAt,
      completedAt,
    }))
}

export function reduceFilePreviewSessions(
  state: FilePreviewSessionsState,
  action: FilePreviewSessionsAction
): FilePreviewSessionsState {
  switch (action.type) {
    case 'hydrate': {
      if (action.sessions.length === 0) {
        return state
      }

      const nextSessions = { ...state.sessions }
      for (const session of action.sessions) {
        if (shouldReplaceSession(nextSessions[session.id], session)) {
          nextSessions[session.id] = session
        }
      }

      const successor = pickActiveSessionId(nextSessions, state.activeSessionId)
      return {
        sessions: nextSessions,
        activeSessionId: successor ?? state.activeSessionId,
      }
    }

    case 'upsert': {
      if (!shouldReplaceSession(state.sessions[action.session.id], action.session)) {
        return state
      }

      const nextSessions = {
        ...state.sessions,
        [action.session.id]: action.session,
      }

      let nextActiveSessionId: string | null
      if (action.activate === false || action.session.status === 'complete') {
        const successor = pickActiveSessionId(nextSessions, state.activeSessionId)
        nextActiveSessionId = successor ?? state.activeSessionId
      } else {
        // Don't switch to a new session until it has renderable content — keeps the viewer mounted.
        const currentActive = state.activeSessionId ? nextSessions[state.activeSessionId] : null
        const currentHasContent = currentActive
          ? hasRenderableFilePreviewContent(currentActive)
          : false
        const incomingHasContent = hasRenderableFilePreviewContent(action.session)
        nextActiveSessionId =
          currentHasContent && !incomingHasContent ? state.activeSessionId : action.session.id
      }

      return { sessions: nextSessions, activeSessionId: nextActiveSessionId }
    }

    case 'complete': {
      if (!shouldReplaceSession(state.sessions[action.session.id], action.session)) {
        return state
      }

      const nextSessions = {
        ...state.sessions,
        [action.session.id]: action.session,
      }

      if (state.activeSessionId !== action.session.id) {
        return { sessions: nextSessions, activeSessionId: state.activeSessionId }
      }

      const successor = pickActiveSessionId(nextSessions, null)
      return {
        sessions: nextSessions,
        // Linger on this session until a successor upserts. Without it, streamingContent
        // becomes undefined between tool calls, collapsing the viewer and clipping scrollTop.
        activeSessionId: successor ?? action.session.id,
      }
    }

    case 'remove': {
      if (!state.sessions[action.sessionId]) {
        return state
      }

      const nextSessions = { ...state.sessions }
      delete nextSessions[action.sessionId]

      return {
        sessions: nextSessions,
        activeSessionId:
          state.activeSessionId === action.sessionId
            ? pickActiveSessionId(nextSessions, null)
            : state.activeSessionId,
      }
    }

    case 'reset':
      return INITIAL_FILE_PREVIEW_SESSIONS_STATE

    default:
      return state
  }
}

export function useFilePreviewSessions() {
  const [state, dispatch] = useReducer(
    reduceFilePreviewSessions,
    INITIAL_FILE_PREVIEW_SESSIONS_STATE
  )

  const previewSession = useMemo(
    () => (state.activeSessionId ? (state.sessions[state.activeSessionId] ?? null) : null),
    [state.activeSessionId, state.sessions]
  )

  const hydratePreviewSessions = useCallback((sessions: FilePreviewSession[]) => {
    dispatch({ type: 'hydrate', sessions })
  }, [])

  const upsertPreviewSession = useCallback(
    (session: FilePreviewSession, options?: { activate?: boolean }) => {
      dispatch({
        type: 'upsert',
        session,
        ...(options?.activate === false ? { activate: false } : {}),
      })
    },
    []
  )

  const completePreviewSession = useCallback((session: FilePreviewSession) => {
    dispatch({ type: 'complete', session })
  }, [])

  const removePreviewSession = useCallback((sessionId: string) => {
    dispatch({ type: 'remove', sessionId })
  }, [])

  const resetPreviewSessions = useCallback(() => {
    dispatch({ type: 'reset' })
  }, [])

  return {
    previewSession,
    previewSessionsById: state.sessions,
    activePreviewSessionId: state.activeSessionId,
    hydratePreviewSessions,
    upsertPreviewSession,
    completePreviewSession,
    removePreviewSession,
    resetPreviewSessions,
  }
}
