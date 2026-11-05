'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import { generateId } from '@sim/utils/id'
import type { ChatTurn } from '@/platform/app/(shell)/_components/composer/model'
import type { ShellItem } from '@/platform/app/(shell)/_components/model'

interface ChatEdits {
  title?: string
  removed?: boolean
  turns?: readonly ChatTurn[]
}

function useChanges() {
  const [edits, setEdits] = useState<Record<string, ChatEdits>>({})
  const [created, setCreated] = useState<ShellItem[]>([])
  function update(id: string, edit: ChatEdits) {
    setEdits((previous) => ({ ...previous, [id]: { ...previous[id], ...edit } }))
  }
  return {
    created,
    createChat(title: string, initialTurns?: readonly ChatTurn[]) {
      const id = generateId()
      if (initialTurns) update(id, { turns: initialTurns })
      setCreated((previous) => [{ id, title }, ...previous])
      return id
    },
    titleFor(id: string, fallback: string) {
      return edits[id]?.title ?? created.find((item) => item.id === id)?.title ?? fallback
    },
    turnsFor(id: string) {
      return edits[id]?.turns
    },
    setTurnsFor(id: string, turns: readonly ChatTurn[]) {
      update(id, { turns })
    },
    isRemoved(id: string) {
      return Boolean(edits[id]?.removed)
    },
    rename(id: string, title: string) {
      if (title.trim()) update(id, { title: title.trim() })
    },
    archive(id: string) {
      update(id, { removed: true })
    },
  }
}

const ChatContext = createContext<ReturnType<typeof useChanges> | null>(null)

interface ChatChangesProviderProps {
  children: ReactNode
}

export function ChatChangesProvider({ children }: ChatChangesProviderProps) {
  const changes = useChanges()
  return <ChatContext.Provider value={changes}>{children}</ChatContext.Provider>
}

export function useChatChanges() {
  const context = useContext(ChatContext)
  if (!context) throw new Error('Chat controls must be inside the product layout')
  return context
}
