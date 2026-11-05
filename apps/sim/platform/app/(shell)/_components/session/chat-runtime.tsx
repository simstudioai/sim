'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { ChatRuntime } from '@/platform/app/(shell)/_components/chat/model'

const RuntimeContext = createContext<ChatRuntime | null>(null)

export function ChatRuntimeProvider({
  runtime,
  children,
}: {
  runtime: ChatRuntime
  children: ReactNode
}) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
}

/** The chat the transcript under this provider belongs to. */
export function useChatRuntime(): ChatRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('A chat message needs a chat runtime')
  return runtime
}
