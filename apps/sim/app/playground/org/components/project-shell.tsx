'use client'

import { type ReactNode, useState } from 'react'
import { Avatar, cn } from '@sim/emcn'
import { ChevronDown, MessageSquareText, X } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { AgentRun } from '@/app/playground/org/components/agent-run'
import { ChatThread } from '@/app/playground/org/components/chat-thread'
import { RunningDot } from '@/app/playground/org/components/glyphs'
import { MockComposer } from '@/app/playground/org/components/mock-composer'
import { DRAFTS } from '@/app/playground/org/lib/changelog-data'
import { CHATS, type Chat, type Workspace } from '@/app/playground/org/lib/mock-data'
import { protoParsers } from '@/app/playground/org/lib/search-params'

interface ProjectShellProps {
  workspace: Workspace
  children: ReactNode
}

/** Project page with the chat you opened floating at the bottom; the page stays usable under it. */
export function ProjectShell({ workspace, children }: ProjectShellProps) {
  const [{ chat: chatId }, setParams] = useQueryStates(protoParsers)
  const chat: Chat | undefined =
    chatId === 'new'
      ? { id: 'new', title: `New chat in ${workspace.name}`, workspaceId: workspace.id, age: 'now' }
      : chatId
        ? CHATS.find((c) => c.id === chatId && c.workspaceId === workspace.id)
        : undefined
  return (
    <div className='relative h-full min-h-0'>
      {children}
      {chat && (
        <FloatingChat
          key={chat.id}
          chat={chat}
          workspace={workspace}
          onClose={() => void setParams({ chat: null }, { history: 'replace' })}
        />
      )}
    </div>
  )
}

interface FloatingChatProps {
  chat: Chat
  workspace: Workspace
  onClose: () => void
}

function FloatingChat({ chat, workspace, onClose }: FloatingChatProps) {
  const [minimized, setMinimized] = useState(false)
  const runs =
    DRAFTS.find((draft) => draft.workspaceId === workspace.id)?.running.filter(
      (work) => work.chat.id === chat.id
    ) ?? []
  const running = runs.length > 0

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-6'>
      {minimized ? (
        <button
          type='button'
          onClick={() => setMinimized(false)}
          className='pointer-events-auto flex max-w-[420px] items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-small shadow-[var(--shadow-overlay)] hover-hover:bg-[var(--surface-hover)]'
        >
          {running ? (
            <RunningDot />
          ) : (
            <MessageSquareText className='size-[14px] shrink-0 text-[var(--text-icon)]' />
          )}
          <span className='truncate text-[var(--text-body)]'>{chat.title}</span>
        </button>
      ) : (
        <div className='pointer-events-auto flex max-h-[min(560px,70vh)] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-[var(--shadow-overlay)]'>
          <header className='flex shrink-0 items-center gap-2 border-[var(--border)] border-b py-1.5 pr-1.5 pl-4'>
            {running && <RunningDot />}
            <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>
              {chat.title}
            </span>
            {chat.owner && (
              <span className='flex shrink-0 items-center gap-1.5 text-[var(--text-muted)] text-small'>
                <Avatar size='xs' name={chat.owner} />
                {chat.owner.split(' ')[0]}
              </span>
            )}
            <HeaderButton label='Minimize' onClick={() => setMinimized(true)}>
              <ChevronDown className='size-[14px] text-[var(--text-icon)]' />
            </HeaderButton>
            <HeaderButton label='Close chat' onClick={onClose}>
              <X className='size-[14px] text-[var(--text-icon)]' />
            </HeaderButton>
          </header>
          {running ? (
            <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>
              <div className='flex flex-col gap-8'>
                {runs.map((work) => (
                  <AgentRun key={work.issue} work={work} workspaceId={workspace.id} />
                ))}
              </div>
            </div>
          ) : chat.id === 'new' ? (
            <div className='px-3 py-3'>
              <MockComposer placeholder={`Ask Sim about ${workspace.name}…`} />
            </div>
          ) : (
            <ChatThread
              placeholder={`Ask Sim about ${workspace.name}…`}
              className={cn('h-[420px]')}
            />
          )}
        </div>
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
