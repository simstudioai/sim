'use client'

import { useCallback, useRef, useState } from 'react'
import { isBrowserToolName } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { MOTHERSHIP_CHAT_API_PATH } from '@/lib/copilot/constants'
import { processSSEStream } from '@/lib/copilot/request/go/parser'
// Deep import (not the session barrel): the barrel re-exports the Redis-backed
// abort module, which cannot be bundled into a client component.
import { parsePersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import { executeBrowserToolOnClient } from '@/lib/copilot/tools/client/browser-tool-execution'
import { executeLocalFilesystemTool } from '@/lib/copilot/tools/client/local-filesystem'
import { isLocalFilesystemToolName } from '@/lib/copilot/tools/local-filesystem'

const logger = createLogger('LauncherChat')

export type LauncherChatStatus = 'idle' | 'streaming' | 'complete' | 'needs-app' | 'error'

export interface LauncherTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export interface LauncherChatState {
  status: LauncherChatStatus
  turns: LauncherTurn[]
  /** One-line activity label while the agent is doing non-text work. */
  working: string | null
  chatId: string | null
  error: string | null
}

const INITIAL_STATE: LauncherChatState = {
  status: 'idle',
  turns: [],
  working: null,
  chatId: null,
  error: null,
}

interface EnvelopeLike {
  type: string
  payload: Record<string, unknown>
  scope?: { lane?: string }
}

function workingLabelFor(event: EnvelopeLike): string | null {
  if (event.scope?.lane === 'subagent') {
    return 'Working…'
  }
  switch (event.type) {
    case 'span': {
      if (event.payload.kind === 'subagent' && event.payload.event === 'start') {
        const agent = typeof event.payload.agent === 'string' ? event.payload.agent : null
        return agent ? `Running ${agent} agent…` : 'Working…'
      }
      return null
    }
    case 'tool':
      return event.payload.phase === 'call' ? 'Working…' : null
    case 'text':
      return event.payload.channel === 'thinking' ? 'Thinking…' : null
    default:
      return null
  }
}

/**
 * Inline-lite chat for the desktop Quick Ask panel. Sends through the same
 * unified chat endpoint as the home surface and renders only the main-lane
 * assistant text from the stream; tool calls, subagents, and thinking
 * collapse into a one-line "working" label. It deliberately implements no
 * tool executor: a `checkpoint_pause` (a tool that must run client-side)
 * flips the state to `needs-app` so the UI can hand off to the full app.
 * Abandoning the stream (panel dismissed, page gone) is safe — execution is
 * detached server-side and the chat is persisted.
 */
export function useLauncherChat() {
  const [state, setState] = useState<LauncherChatState>(INITIAL_STATE)
  const chatIdRef = useRef<string | null>(null)
  const streamingRef = useRef(false)
  // Client-executed tool calls dispatched this session (exactly-once guard).
  const dispatchedToolIdsRef = useRef<Set<string>>(new Set())

  const reset = useCallback(() => {
    chatIdRef.current = null
    streamingRef.current = false
    dispatchedToolIdsRef.current.clear()
    setState(INITIAL_STATE)
  }, [])

  /**
   * Execute a client-routed tool call right here in the panel — the panel is
   * a live Sim client, so tools run in the background without the main window.
   * The executors report their result to `/api/copilot/confirm`, which wakes
   * the still-open chat stream so it continues. Returns true when the tool was
   * dispatched (browser / local filesystem), false for client tools this
   * surface can't run (e.g. workflow runs), which still need the full app.
   */
  const dispatchClientTool = useCallback(
    (
      toolCallId: string,
      toolName: string,
      args: Record<string, unknown>,
      workspaceId: string,
      eventTs?: string
    ): boolean => {
      if (dispatchedToolIdsRef.current.has(toolCallId)) return true
      if (isBrowserToolName(toolName)) {
        dispatchedToolIdsRef.current.add(toolCallId)
        executeBrowserToolOnClient(toolCallId, toolName, args, eventTs)
        return true
      }
      if (isLocalFilesystemToolName(toolName)) {
        dispatchedToolIdsRef.current.add(toolCallId)
        executeLocalFilesystemTool(toolCallId, toolName, args, {
          workspaceId,
          chatId: chatIdRef.current ?? undefined,
        })
        return true
      }
      return false
    },
    []
  )

  const send = useCallback(
    async (message: string, workspaceId: string) => {
      const trimmed = message.trim()
      if (!trimmed || streamingRef.current) {
        return
      }
      streamingRef.current = true

      const userTurn: LauncherTurn = { id: generateId(), role: 'user', text: trimmed }
      const assistantTurn: LauncherTurn = { id: generateId(), role: 'assistant', text: '' }
      setState((prev) => ({
        ...prev,
        status: 'streaming',
        turns: [...prev.turns, userTurn, assistantTurn],
        working: 'Thinking…',
        error: null,
      }))

      const appendAssistantText = (chunk: string) => {
        setState((prev) => ({
          ...prev,
          working: null,
          turns: prev.turns.map((turn) =>
            turn.id === assistantTurn.id ? { ...turn, text: turn.text + chunk } : turn
          ),
        }))
      }
      const setWorking = (label: string) => {
        setState((prev) => (prev.working === label ? prev : { ...prev, working: label }))
      }
      const finish = (patch: Partial<LauncherChatState>) => {
        streamingRef.current = false
        setState((prev) => ({ ...prev, working: null, ...patch }))
      }

      try {
        const response = await fetch(MOTHERSHIP_CHAT_API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            workspaceId,
            userMessageId: generateId(),
            createNewChat: !chatIdRef.current,
            ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
            // Advertise the local-filesystem capability so integration/file work
            // routes as client tools the panel can execute in the background
            // (the panel is a live desktop client). Browser automation is left
            // to the full app since it needs the visible resource panel.
            ...(typeof window !== 'undefined' && window.simDesktop?.localFilesystem
              ? { desktopCapabilities: { localFilesystem: true } }
              : {}),
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        })

        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}) as Record<string, unknown>)
          const detail =
            typeof body.error === 'string' ? body.error : `Request failed (${response.status})`
          finish({ status: 'error', error: detail })
          return
        }

        let sawTerminal = false
        await processSSEStream(
          response.body.getReader(),
          new TextDecoder(),
          undefined,
          (raw): boolean | undefined => {
            const parsed = parsePersistedStreamEventEnvelope(raw)
            if (!parsed.ok) {
              // Unknown or future events are non-fatal for this read-only view.
              logger.info('Skipping unrecognized stream event', { reason: parsed.reason })
              return undefined
            }
            const event = parsed.event as unknown as EnvelopeLike

            if (event.type === 'session' && event.payload.kind === 'chat') {
              const chatId = event.payload.chatId
              if (typeof chatId === 'string') {
                chatIdRef.current = chatId
                setState((prev) => ({ ...prev, chatId }))
              }
              return undefined
            }

            if (
              event.type === 'text' &&
              event.payload.channel === 'assistant' &&
              event.scope?.lane !== 'subagent'
            ) {
              const chunk = event.payload.text
              if (typeof chunk === 'string' && chunk) {
                appendAssistantText(chunk)
              }
              return undefined
            }

            // Client-routed tool call: run it here in the panel and let the
            // still-open stream continue. Only tools this surface can execute
            // are dispatched; anything else falls through to the checkpoint
            // handoff below.
            if (event.type === 'tool' && event.payload.phase === 'call') {
              const toolName = event.payload.toolName
              const toolCallId = event.payload.toolCallId
              if (typeof toolName === 'string' && typeof toolCallId === 'string') {
                const args = (event.payload.arguments as Record<string, unknown> | undefined) ?? {}
                const eventTs =
                  typeof (parsed.event as { ts?: unknown }).ts === 'string'
                    ? (parsed.event as { ts: string }).ts
                    : undefined
                if (dispatchClientTool(toolCallId, toolName, args, workspaceId, eventTs)) {
                  setWorking('Working…')
                }
              }
              return undefined
            }

            if (event.type === 'run' && event.payload.kind === 'checkpoint_pause') {
              // The server checkpointed a tool this surface couldn't run inline
              // (e.g. a workflow run) — that genuinely needs the full app.
              sawTerminal = true
              finish({ status: 'needs-app' })
              return true
            }

            if (event.type === 'error') {
              const message =
                typeof event.payload.message === 'string'
                  ? event.payload.message
                  : typeof event.payload.error === 'string'
                    ? event.payload.error
                    : 'Something went wrong'
              sawTerminal = true
              finish({ status: 'error', error: message })
              return true
            }

            if (event.type === 'complete') {
              sawTerminal = true
              finish({ status: 'complete' })
              return true
            }

            const working = workingLabelFor(event)
            if (working) {
              setWorking(working)
            }
            return undefined
          }
        )

        if (!sawTerminal) {
          // The body closed without a terminal event (network blip, proxy
          // timeout). The chat continues server-side; hand off to the app.
          finish({ status: 'needs-app' })
        }
      } catch (error) {
        logger.warn('Launcher chat stream failed', { error })
        finish({ status: 'error', error: getErrorMessage(error, 'Something went wrong') })
      }
    },
    [dispatchClientTool]
  )

  return { state, send, reset }
}
