'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { draftTitle, userTurn } from '@/app/(product)/_components/composer/user-turn'
import type { ChatRuntime, PlatformPart, PlatformTurn } from '@/platform/lib/data/models/chat'
import type { ChatTurn, ComposerDraft } from '@/platform/lib/data/models/composer'
import type { ShellChat } from '@/platform/lib/data/models/shell'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { usePlatformHref } from '@/platform/lib/platform-href'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface ChatEdits {
  title?: string
  removed?: boolean
  turns?: readonly ChatTurn[]
}

function useChanges() {
  const [edits, setEdits] = useState<Record<string, ChatEdits>>({})
  const [created, setCreated] = useState<ShellChat[]>([])
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

function fixtureParts(response: NonNullable<ChatTurn['response']>, turnId: string): PlatformPart[] {
  const { state, duration, paragraphs, steps, thinking, progress } = response
  const label = {
    complete: `Worked for ${duration}`,
    running: duration ? `Working for ${duration}` : 'Working',
    failed: `Stopped after ${duration}`,
    stopped: 'Stopped',
  }[state]
  return [
    {
      kind: 'activity',
      id: `${turnId}:activity:${state}`,
      label,
      initiallyOpen: state === 'running' || state === 'failed',
      thinking,
      progress,
      tools: steps.map((step) => ({
        id: step.id,
        name: step.name,
        title: step.name,
        status: 'success',
        time: step.time,
        input: step.input,
        output: step.output,
      })),
    },
    { kind: 'prose', id: `${turnId}:prose`, paragraphs },
  ]
}

function fixtureTurns(turns: readonly ChatTurn[]): PlatformTurn[] {
  return turns.flatMap<PlatformTurn>((turn) => {
    const user: PlatformTurn = {
      role: 'user',
      id: turn.id,
      prompt: turn.prompt,
      sentAt: turn.sentAt,
      timeZone: turn.timeZone,
    }
    if (!turn.response) return [user]
    const { paragraphs, state, sentAt, failure } = turn.response
    return [
      user,
      {
        role: 'assistant',
        id: `${turn.id}:response`,
        state,
        parts: fixtureParts(turn.response, turn.id),
        copyText: paragraphs
          .map(({ lead, text }) => (lead ? `${lead} ${text}` : text))
          .join('\n\n'),
        sentAt,
        failure,
      },
    ]
  })
}

interface FixtureThread {
  id: string
  title: string
  turns: ChatTurn[]
}

/** The fixture session's answer to `ChatRuntime`: every action edits this tab's memory. */
export function useFixtureChatRuntime(
  threads: readonly FixtureThread[] | undefined,
  chatId: string | undefined
): ChatRuntime {
  const changes = useChatChanges()
  const router = useRouter()
  const hrefFor = usePlatformHref()
  const scope = useSurfaceScope()
  const thread = threads?.find((item) => item.id === chatId)
  const id = chatId ?? ''
  const removed = changes.isRemoved(id)
  const turns = removed ? [] : (changes.turnsFor(id) ?? thread?.turns ?? [])
  const running = turns.find((turn) => turn.response?.state === 'running')
  function transition(turn: ChatTurn, state: 'running' | 'stopped') {
    if (!turn.response) return
    const response =
      state === 'running'
        ? {
            ...turn.response,
            state,
            duration: '',
            steps: [],
            thinking: undefined,
            failure: undefined,
          }
        : { ...turn.response, state }
    changes.setTurnsFor(
      id,
      turns.map((item) => (item.id === turn.id ? { ...item, response } : item))
    )
  }
  function send(draft: ComposerDraft): undefined {
    const next = userTurn(draft)
    if (id && !removed) {
      changes.setTurnsFor(id, [...turns, next])
      return
    }
    const newId = changes.createChat(draftTitle(draft), [next])
    router.replace(hrefFor(surfaceHref(scope, `/chat/${newId}`)))
  }
  return {
    chatId,
    title: changes.titleFor(id, thread?.title ?? 'New chat'),
    status: running ? 'sending' : 'idle',
    turns: fixtureTurns(turns),
    send,
    sendText: (text) => send({ text, attachments: [] }),
    stop: () => {
      if (running) transition(running, 'stopped')
    },
    retry: (turnId) => {
      const turn = turns.find((item) => `${item.id}:response` === turnId)
      if (turn) transition(turn, 'running')
    },
    approvals: { outstanding: [], submitted: [] },
    registerApproval: () => () => {},
    decideTools: async () => 'ok',
  }
}
