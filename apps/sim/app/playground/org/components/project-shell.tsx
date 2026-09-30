'use client'

import { type ReactNode, useCallback, useRef } from 'react'
import { Avatar, cn } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { AgentRun } from '@/app/playground/org/components/agent-run'
import { ChatThread } from '@/app/playground/org/components/chat-thread'
import { RunningDot } from '@/app/playground/org/components/glyphs'
import { LiveChat } from '@/app/playground/org/components/live-chat'
import { MockComposer } from '@/app/playground/org/components/mock-composer'
import { DRAFTS } from '@/app/playground/org/lib/changelog-data'
import { CHATS, type Chat } from '@/app/playground/org/lib/mock-data'
import type { Project } from '@/app/playground/org/lib/project'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'

const NEW_CHAT = 'new'

interface ProjectShellProps {
  project: Project
  children: ReactNode
}

/** Project page with the chat you opened in a side panel on the left; the page stays usable beside it. */
export function ProjectShell({ project, children }: ProjectShellProps) {
  const [{ chat: chatId, q }, setParams] = useQueryStates(protoParsers)
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
  const { data: chats } = useMothershipChats(project.isMock ? undefined : project.id)
  const realChat = chats?.find((chat) => chat.id === chatId)
  /** Chats from the overlay pack (changelog and issue stories) keep their canned threads. */
  const mockChat: Chat | undefined = CHATS.find(
    (chat) => chat.id === chatId && chat.workspaceId === project.mock.id
  )
  const runs = mockChat
    ? (DRAFTS.find((draft) => draft.workspaceId === project.mock.id)?.running.filter(
        (work) => work.chat.id === mockChat.id
      ) ?? [])
    : []
  const running = runs.length > 0 || Boolean(realChat?.isActive)
  const title =
    chatId === NEW_CHAT && !realChat
      ? `New chat in ${project.name}`
      : (realChat?.name ?? mockChat?.title ?? 'Chat')

  return (
    <div className='flex h-full w-[440px] flex-col bg-[var(--bg)]'>
      <header className='flex h-12 shrink-0 items-center gap-2 border-[var(--border)] border-b pr-2 pl-4'>
        {running && <RunningDot />}
        <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>{title}</span>
        {mockChat?.owner && <Avatar size='xs' name={mockChat.owner} />}
        <HeaderButton label='Close chat' onClick={onClose}>
          <X className='size-[14px] text-[var(--text-icon)]' />
        </HeaderButton>
      </header>
      {runs.length > 0 ? (
        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-5'>
          <div className='flex flex-col gap-8'>
            {runs.map((work) => (
              <AgentRun key={work.issue} work={work} workspaceId={project.id} />
            ))}
          </div>
        </div>
      ) : mockChat ? (
        <ChatThread placeholder={`Ask Sim about ${project.name}…`} />
      ) : project.isMock ? (
        <div className='flex min-h-0 flex-1 flex-col justify-end px-3 pb-3'>
          <MockComposer placeholder={`Ask Sim about ${project.name}…`} />
        </div>
      ) : (
        <LiveChat
          owner={project.id}
          chatId={chatId === NEW_CHAT ? undefined : chatId}
          initialMessage={initialMessage}
          onInitialMessageSent={onInitialMessageSent}
          onChatCreated={onChatCreated}
          layout='copilot-view'
          className='min-h-0 flex-1'
        />
      )}
    </div>
  )
}

interface HeaderButtonProps {
  label: string
  onClick: () => void
  children: ReactNode
}

function HeaderButton({ label, onClick, children }: HeaderButtonProps) {
  return (
    <button
      type='button'
      aria-label={label}
      onClick={onClick}
      className='flex size-[26px] shrink-0 items-center justify-center rounded-lg hover-hover:bg-[var(--surface-hover)]'
    >
      {children}
    </button>
  )
}
