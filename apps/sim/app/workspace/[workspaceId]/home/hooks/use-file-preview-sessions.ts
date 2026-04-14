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

export function shouldReplaceSession(
  current: FilePreviewSession | undefined,
  next: FilePreviewSession
): boolean {
  if (!current) return true
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

      return {
        sessions: nextSessions,
        activeSessionId: pickActiveSessionId(nextSessions, state.activeSessionId),
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

      return {
        sessions: nextSessions,
        activeSessionId:
          action.activate === false
            ? pickActiveSessionId(nextSessions, state.activeSessionId)
            : action.session.status === 'complete'
              ? pickActiveSessionId(nextSessions, state.activeSessionId)
              : action.session.id,
      }
    }

    case 'complete': {
      if (!shouldReplaceSession(state.sessions[action.session.id], action.session)) {
        return state
      }

      const nextSessions = {
        ...state.sessions,
        [action.session.id]: action.session,
      }

      return {
        sessions: nextSessions,
        activeSessionId:
          state.activeSessionId === action.session.id
            ? pickActiveSessionId(nextSessions, null)
            : state.activeSessionId,
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
