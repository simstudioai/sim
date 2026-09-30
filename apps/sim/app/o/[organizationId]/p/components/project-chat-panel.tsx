'use client'

import { type ReactNode, useCallback, useRef } from 'react'
import { cn } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { LiveChat } from '@/app/o/[organizationId]/p/components/live-chat'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { projectParsers } from '@/app/o/[organizationId]/p/search-params'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'

const NEW_CHAT = 'new'

interface ProjectChatPanelProps {
  project: Project
  children: ReactNode
}

/** Project page with the chat you opened in a side panel on the left; the page stays usable beside it. */
export function ProjectChatPanel({ project, children }: ProjectChatPanelProps) {
  const [{ chat: chatId, q }, setParams] = useQueryStates(projectParsers)
  /** The id a new chat resolved to; the panel keeps its key so the thread survives the URL change. */
  const createdFromNewRef = useRef<string | null>(null)
  const panelKey = chatId === NEW_CHAT || chatId === createdFromNewRef.current ? NEW_CHAT : chatId

  const onChatCreated = useCallback(
    (id: string) => {
      createdFromNewRef.current = id
      void setParams({ chat: id }, { history: 'replace' })
    },
    [setParams]
  )
  const onInitialMessageSent = useCallback(
    () => void setParams({ q: null }, { history: 'replace' }),
    [setParams]
  )

  return (
    <div className='flex h-full min-h-0'>
      <div
        className={cn(
          'shrink-0 overflow-hidden border-[var(--border)] transition-[width] duration-200 ease-out',
          chatId ? 'w-[440px] border-r' : 'w-0'
        )}
      >
        {chatId && (
          <SideChat
            key={panelKey}
            project={project}
            chatId={chatId}
            initialMessage={q || undefined}
            onChatCreated={onChatCreated}
            onInitialMessageSent={onInitialMessageSent}
            onClose={() => void setParams({ chat: null, q: null }, { history: 'replace' })}
          />
        )}
      </div>
      <div className='min-w-0 flex-1'>{children}</div>
    </div>
  )
}

interface SideChatProps {
  project: Project
  chatId: string
  initialMessage?: string
  onChatCreated: (chatId: string) => void
  onInitialMessageSent: () => void
  onClose: () => void
}

function SideChat({
  project,
  chatId,
  initialMessage,
  onChatCreated,
  onInitialMessageSent,
  onClose,
}: SideChatProps) {
  const { data: chats } = useMothershipChats(project.id)
  const chat = chats?.find((candidate) => candidate.id === chatId)
  const title = chat?.name ?? (chatId === NEW_CHAT ? `New chat in ${project.name}` : 'Chat')

  return (
    <div className='flex h-full w-[440px] flex-col bg-[var(--bg)]'>
      <header className='flex h-12 shrink-0 items-center gap-2 border-[var(--border)] border-b pr-2 pl-4'>
        {chat?.isActive && (
          <span className='size-[7px] shrink-0 rounded-full bg-[var(--caution)]' />
        )}
        <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>{title}</span>
        <button
          type='button'
          aria-label='Close chat'
          onClick={onClose}
          className='flex size-[26px] shrink-0 items-center justify-center rounded-lg hover-hover:bg-[var(--surface-hover)]'
        >
          <X className='size-[14px] text-[var(--text-icon)]' />
        </button>
      </header>
      <LiveChat
        owner={project.id}
        chatId={chatId === NEW_CHAT ? undefined : chatId}
        initialMessage={initialMessage}
        onInitialMessageSent={onInitialMessageSent}
        onChatCreated={onChatCreated}
        layout='copilot-view'
        className='min-h-0 flex-1'
      />
    </div>
  )
}
