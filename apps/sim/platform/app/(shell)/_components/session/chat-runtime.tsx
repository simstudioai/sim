'use client'

import { createContext, type ReactNode, useContext, useMemo, useRef } from 'react'
import type { ChatRuntime } from '@/platform/app/(shell)/_components/chat/model'

type ChatHandlers = Pick<
  ChatRuntime,
  | 'sendText'
  | 'retry'
  | 'registerApproval'
  | 'decideTools'
  | 'rate'
  | 'fork'
  | 'openResource'
  | 'finishTerminalHandoff'
>
type ChatInteractions = Pick<ChatRuntime, 'approvals' | 'review'>

const HandlersContext = createContext<ChatHandlers | null>(null)
const InteractionsContext = createContext<ChatInteractions | null>(null)

/**
 * A runtime is rebuilt on every stream chunk, while a settled turn reads only handlers and what is
 * awaiting a decision. Handlers keep one identity and call the latest runtime, so a chunk reaches
 * the turn it changed rather than the whole transcript.
 */
export function ChatRuntimeProvider({
  runtime,
  children,
}: {
  runtime: ChatRuntime
  children: ReactNode
}) {
  const latest = useRef(runtime)
  latest.current = runtime
  const canRetry = Boolean(runtime.retry)
  const canRate = Boolean(runtime.rate)
  const canFork = Boolean(runtime.fork)
  const canOpenResource = Boolean(runtime.openResource)
  const canFinishHandoff = Boolean(runtime.finishTerminalHandoff)
  const handlers = useMemo<ChatHandlers>(
    () => ({
      sendText: (text) => latest.current.sendText(text),
      registerApproval: (toolCallId) => latest.current.registerApproval(toolCallId),
      decideTools: (ids, decision) => latest.current.decideTools(ids, decision),
      retry: canRetry ? (turnId) => latest.current.retry?.(turnId) : undefined,
      rate: canRate ? async (input) => latest.current.rate?.(input) : undefined,
      fork: canFork ? async (turnId) => latest.current.fork?.(turnId) : undefined,
      openResource: canOpenResource ? (ref) => latest.current.openResource?.(ref) : undefined,
      finishTerminalHandoff: canFinishHandoff
        ? (terminalId) => latest.current.finishTerminalHandoff?.(terminalId)
        : undefined,
    }),
    [canRetry, canRate, canFork, canOpenResource, canFinishHandoff]
  )
  const { approvals, review } = runtime
  const interactions = useMemo(() => ({ approvals, review }), [approvals, review])
  return (
    <HandlersContext.Provider value={handlers}>
      <InteractionsContext.Provider value={interactions}>{children}</InteractionsContext.Provider>
    </HandlersContext.Provider>
  )
}

/** What a transcript under this provider can do. Stable across stream chunks. */
export function useChatHandlers(): ChatHandlers {
  const handlers = useContext(HandlersContext)
  if (!handlers) throw new Error('A chat message needs a chat runtime')
  return handlers
}

/** What is awaiting a decision in the chat under this provider. */
export function useChatInteractions(): ChatInteractions {
  const interactions = useContext(InteractionsContext)
  if (!interactions) throw new Error('A chat message needs a chat runtime')
  return interactions
}
