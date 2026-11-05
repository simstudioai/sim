'use client'

import { useCallback, useContext, useEffect, useReducer, useRef } from 'react'
import {
  type AppToExtensionMessage,
  type ExtensionAction,
  extensionToAppMessageSchema,
  PAGE_REFERENCE_TIMEOUT_MS,
  type PageSnapshot,
} from '@sim/browser-extension-protocol'
import { generateId } from '@sim/utils/id'
import { getPageContextBudgetError } from '@/lib/mothership/chat/page-context'
import { ChatInputFocusContext } from '@/hooks/use-chat-input-focus'

interface CaptureState {
  scopeKey: string
  snapshots: PageSnapshot[]
  error?: string
  connected?: boolean
  referenceEnabled?: boolean
}

type CaptureAction =
  | { type: 'connected'; scopeKey: string }
  | { type: 'preference'; enabled: boolean; scopeKey: string }
  | { type: 'receive'; snapshot: PageSnapshot; scopeKey: string }
  | { type: 'scope'; scopeKey: string }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

function reduceCaptures(state: CaptureState, action: CaptureAction): CaptureState {
  if (action.type === 'scope') return { scopeKey: action.scopeKey, snapshots: [] }
  if (action.type === 'clear') return { ...state, snapshots: [], error: undefined }
  if (action.type === 'remove')
    return {
      ...state,
      error: undefined,
      snapshots: state.snapshots.filter((snapshot) => snapshot.id !== action.id),
    }
  if (action.scopeKey !== state.scopeKey) return state
  if (action.type === 'preference') return { ...state, referenceEnabled: action.enabled }
  if (action.type === 'connected') return { ...state, connected: true }
  if (state.snapshots.some((snapshot) => snapshot.id === action.snapshot.id)) return state
  const snapshots = [...state.snapshots, action.snapshot]
  const error = getPageContextBudgetError(
    snapshots.map((snapshot) => ({ kind: 'browser_page', snapshot }))
  )
  return error
    ? { ...state, error: `${error}. Remove a page and try again.` }
    : { ...state, snapshots, error: undefined }
}

interface PendingCapture {
  requestId: string
  sessionId: string
  resolve: (snapshot: PageSnapshot | null) => void
  reject: (error: Error) => void
  timer: number
}

/** Receives explicitly captured page snapshots only from the configured extension parent. */
export function usePageContext(origins: string[], scopeKey: string) {
  const composerFocus = useContext(ChatInputFocusContext)
  const bridgeRef = useRef<{ origin: string; sessionId: string } | null>(null)
  const pending = useRef<PendingCapture | null>(null)
  const [state, dispatch] = useReducer(reduceCaptures, { scopeKey, snapshots: [] })
  if (state.scopeKey !== scopeKey) dispatch({ type: 'scope', scopeKey })

  useEffect(() => {
    if (window.parent === window) return
    const sessionId = generateId()
    let disposed = false
    let focusRequested = false
    const confirmFocus = () => {
      const bridge = bridgeRef.current
      if (
        !focusRequested ||
        bridge?.sessionId !== sessionId ||
        !document.hasFocus() ||
        !composerFocus?.current?.isFocused()
      ) {
        return
      }
      focusRequested = false
      const message: AppToExtensionMessage = {
        channel: 'sim-extension',
        version: 1,
        type: 'composer-focused',
        sessionId,
      }
      window.parent.postMessage(message, bridge.origin)
    }
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || !origins.includes(event.origin)) return
      const parsed = extensionToAppMessageSchema.safeParse(event.data)
      if (!parsed.success || parsed.data.sessionId !== sessionId) return
      if (parsed.data.type === 'connected') {
        bridgeRef.current = { origin: event.origin, sessionId }
        dispatch({ type: 'connected', scopeKey })
        return
      }
      if (parsed.data.type === 'focus-composer') {
        if (bridgeRef.current?.sessionId === sessionId) {
          focusRequested = true
          composerFocus?.current?.focus()
          confirmFocus()
        }
        return
      }
      if (parsed.data.type === 'reference-preference') {
        dispatch({ type: 'preference', enabled: parsed.data.enabled, scopeKey })
        if (!parsed.data.enabled && pending.current?.sessionId === sessionId) {
          window.clearTimeout(pending.current.timer)
          pending.current.resolve(null)
          pending.current = null
        }
        return
      }
      if (parsed.data.type === 'send-context' || parsed.data.type === 'send-context-error') {
        const current = pending.current
        if (
          !current ||
          current.sessionId !== sessionId ||
          current.requestId !== parsed.data.requestId
        )
          return
        pending.current = null
        window.clearTimeout(current.timer)
        if (parsed.data.type === 'send-context') current.resolve(parsed.data.snapshot)
        else if (parsed.data.reason) current.resolve(null)
        else current.reject(new Error(parsed.data.message))
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
    window.addEventListener('focus', confirmFocus, true)
    window.addEventListener('keydown', confirmFocus, true)
    window.addEventListener('message', receive)
    const ready: AppToExtensionMessage = {
      channel: 'sim-extension',
      version: 1,
      type: 'ready',
      sessionId,
    }
    // A discarded effect setup must not claim a waiting capture.
    queueMicrotask(() => {
      if (!disposed) for (const origin of origins) window.parent.postMessage(ready, origin)
    })
    return () => {
      disposed = true
      bridgeRef.current = null
      if (pending.current?.sessionId === sessionId) {
        window.clearTimeout(pending.current.timer)
        pending.current.resolve(null)
        pending.current = null
      }
      window.removeEventListener('focus', confirmFocus, true)
      window.removeEventListener('keydown', confirmFocus, true)
      window.removeEventListener('message', receive)
      const unavailable: AppToExtensionMessage = {
        channel: 'sim-extension',
        version: 1,
        type: 'unavailable',
        sessionId,
      }
      for (const origin of origins) window.parent.postMessage(unavailable, origin)
    }
  }, [composerFocus, origins, scopeKey])

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

  const setReferenceEnabled = useCallback((enabled: boolean) => {
    const bridge = bridgeRef.current
    if (!bridge) return
    const message: AppToExtensionMessage = {
      channel: 'sim-extension',
      version: 1,
      type: 'set-reference-preference',
      sessionId: bridge.sessionId,
      enabled,
    }
    window.parent.postMessage(message, bridge.origin)
  }, [])

  const captureForSend = useCallback((): Promise<PageSnapshot | null> => {
    const bridge = bridgeRef.current
    if (!bridge) return Promise.resolve(null)
    if (pending.current)
      return Promise.reject(
        new Error('The previous page is still being read. Try again in a moment.')
      )
    const requestId = generateId()
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (pending.current?.requestId !== requestId) return
        pending.current = null
        reject(
          new Error(
            'The current page did not respond. Try again or turn off Reference current page.'
          )
        )
      }, PAGE_REFERENCE_TIMEOUT_MS)
      pending.current = { requestId, sessionId: bridge.sessionId, resolve, reject, timer }
      const message: AppToExtensionMessage = {
        channel: 'sim-extension',
        version: 1,
        type: 'capture-for-send',
        sessionId: bridge.sessionId,
        requestId,
      }
      window.parent.postMessage(message, bridge.origin)
    })
  }, [])

  return {
    referenceEnabled: state.referenceEnabled,
    setReferenceEnabled,
    captureForSend,
    connected: Boolean(state.connected),
    requestAction,
    snapshots: state.snapshots,
    captureError: state.error,
    clearSnapshots,
    removeSnapshot,
  }
}
