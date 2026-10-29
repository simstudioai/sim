'use client'

import { useCallback, useEffect, useReducer } from 'react'
import {
  type AppToExtensionMessage,
  extensionToAppMessageSchema,
  type PageSnapshot,
} from '@sim/browser-extension-protocol'
import { generateId } from '@sim/utils/id'
import { getPageContextBudgetError } from '@/lib/mothership/chat/page-context'

interface CaptureState {
  scopeKey: string
  snapshots: PageSnapshot[]
  error?: string
}

type CaptureAction =
  | { type: 'receive'; snapshot: PageSnapshot; scopeKey: string }
  | { type: 'scope'; scopeKey: string }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

function reduceCaptures(state: CaptureState, action: CaptureAction): CaptureState {
  if (action.type === 'scope') return { scopeKey: action.scopeKey, snapshots: [] }
  if (action.type === 'clear') return { scopeKey: state.scopeKey, snapshots: [] }
  if (action.type === 'remove')
    return {
      scopeKey: state.scopeKey,
      snapshots: state.snapshots.filter((snapshot) => snapshot.id !== action.id),
    }
  if (action.scopeKey !== state.scopeKey) return state
  if (state.snapshots.some((snapshot) => snapshot.id === action.snapshot.id)) return state
  const snapshots = [...state.snapshots, action.snapshot]
  const error = getPageContextBudgetError(
    snapshots.map((snapshot) => ({ kind: 'browser_page', snapshot }))
  )
  return error
    ? { ...state, error: `${error}. Remove one and capture again.` }
    : { scopeKey: state.scopeKey, snapshots }
}

/** Receives explicitly captured page snapshots only from the configured extension parent. */
export function usePageContext(origins: string[], scopeKey: string) {
  const [state, dispatch] = useReducer(reduceCaptures, { scopeKey, snapshots: [] })
  if (state.scopeKey !== scopeKey) dispatch({ type: 'scope', scopeKey })

  useEffect(() => {
    if (window.parent === window) return
    const sessionId = generateId()
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || !origins.includes(event.origin)) return
      const parsed = extensionToAppMessageSchema.safeParse(event.data)
      if (!parsed.success || parsed.data.sessionId !== sessionId) return
      const next = parsed.data.snapshot
      dispatch({ type: 'receive', snapshot: next, scopeKey })
      const acknowledgement: AppToExtensionMessage = {
        channel: 'sim-extension',
        version: 1,
        type: 'context-received',
        sessionId,
        snapshotId: next.id,
      }
      window.parent.postMessage(acknowledgement, event.origin)
    }
    window.addEventListener('message', receive)
    const ready: AppToExtensionMessage = {
      channel: 'sim-extension',
      version: 1,
      type: 'ready',
      sessionId,
    }
    for (const origin of origins) window.parent.postMessage(ready, origin)
    return () => {
      window.removeEventListener('message', receive)
      const unavailable: AppToExtensionMessage = {
        channel: 'sim-extension',
        version: 1,
        type: 'unavailable',
        sessionId,
      }
      for (const origin of origins) window.parent.postMessage(unavailable, origin)
    }
  }, [origins, scopeKey])

  const clearSnapshots = useCallback(() => dispatch({ type: 'clear' }), [])
  const removeSnapshot = useCallback((id: string) => dispatch({ type: 'remove', id }), [])

  return {
    snapshots: state.snapshots,
    captureError: state.error,
    clearSnapshots,
    removeSnapshot,
  }
}
