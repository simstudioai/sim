'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  type AppToExtensionMessage,
  type ExtensionAction,
  extensionToAppMessageSchema,
  type PageSnapshot,
} from '@sim/browser-extension-protocol'
import { generateId } from '@sim/utils/id'
import { getPageContextBudgetError } from '@/lib/mothership/chat/page-context'

interface CaptureState {
  scopeKey: string
  snapshots: PageSnapshot[]
  error?: string
  connected?: boolean
}

type CaptureAction =
  | { type: 'connected'; scopeKey: string }
  | { type: 'receive'; snapshot: PageSnapshot; scopeKey: string }
  | { type: 'scope'; scopeKey: string }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

function reduceCaptures(state: CaptureState, action: CaptureAction): CaptureState {
  if (action.type === 'scope') return { scopeKey: action.scopeKey, snapshots: [] }
  if (action.type === 'clear')
    return { scopeKey: state.scopeKey, snapshots: [], connected: state.connected }
  if (action.type === 'remove')
    return {
      scopeKey: state.scopeKey,
      connected: state.connected,
      snapshots: state.snapshots.filter((snapshot) => snapshot.id !== action.id),
    }
  if (action.scopeKey !== state.scopeKey) return state
  if (action.type === 'connected') return { ...state, connected: true }
  if (state.snapshots.some((snapshot) => snapshot.id === action.snapshot.id)) return state
  const snapshots = [...state.snapshots, action.snapshot]
  const error = getPageContextBudgetError(
    snapshots.map((snapshot) => ({ kind: 'browser_page', snapshot }))
  )
  return error
    ? { ...state, error: `${error}. Remove one and capture again.` }
    : { scopeKey: state.scopeKey, snapshots, connected: state.connected }
}

/** Receives explicitly captured page snapshots only from the configured extension parent. */
export function usePageContext(origins: string[], scopeKey: string) {
  const bridgeRef = useRef<{ origin: string; sessionId: string } | null>(null)
  const [state, dispatch] = useReducer(reduceCaptures, { scopeKey, snapshots: [] })
  if (state.scopeKey !== scopeKey) dispatch({ type: 'scope', scopeKey })

  useEffect(() => {
    if (window.parent === window) return
    const sessionId = generateId()
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || !origins.includes(event.origin)) return
      const parsed = extensionToAppMessageSchema.safeParse(event.data)
      if (!parsed.success || parsed.data.sessionId !== sessionId) return
      if (parsed.data.type === 'connected') {
        bridgeRef.current = { origin: event.origin, sessionId }
        dispatch({ type: 'connected', scopeKey })
        return
      }
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
      bridgeRef.current = null
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

  const requestAction = useCallback((action: ExtensionAction) => {
    const bridge = bridgeRef.current
    if (!bridge) return
    const message: AppToExtensionMessage = {
      channel: 'sim-extension',
      version: 1,
      type: 'action',
      sessionId: bridge.sessionId,
      action,
    }
    window.parent.postMessage(message, bridge.origin)
  }, [])

  return {
    connected: Boolean(state.connected),
    requestAction,
    snapshots: state.snapshots,
    captureError: state.error,
    clearSnapshots,
    removeSnapshot,
  }
}
