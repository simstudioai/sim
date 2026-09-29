'use client'

import type { ReactNode } from 'react'
import { Avatar, cn } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
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

/** Project page with the chat you opened in a side panel on the left; the page stays usable beside it. */
export function ProjectShell({ workspace, children }: ProjectShellProps) {
  const [{ chat: chatId }, setParams] = useQueryStates(protoParsers)
  const chat: Chat | undefined =
    chatId === 'new'
      ? { id: 'new', title: `New chat in ${workspace.name}`, workspaceId: workspace.id, age: 'now' }
      : chatId
        ? CHATS.find((c) => c.id === chatId && c.workspaceId === workspace.id)
        : undefined
  return (
    <div className='flex h-full min-h-0'>
      <div
        className={cn(
          'shrink-0 overflow-hidden border-[var(--border)] transition-[width] duration-200 ease-out',
          chat ? 'w-[440px] border-r' : 'w-0'
        )}
      >
        {chat && (
          <SideChat
            key={chat.id}
            chat={chat}
            workspace={workspace}
            onClose={() => void setParams({ chat: null }, { history: 'replace' })}
          />
        )}
      </div>
      <div className='min-w-0 flex-1'>{children}</div>
    </div>
  )
}

interface SideChatProps {
  chat: Chat
  workspace: Workspace
  onClose: () => void
}

function SideChat({ chat, workspace, onClose }: SideChatProps) {
  const runs =
    DRAFTS.find((draft) => draft.workspaceId === workspace.id)?.running.filter(
      (work) => work.chat.id === chat.id
    ) ?? []
  const running = runs.length > 0

  return (
    <div className='flex h-full w-[440px] flex-col bg-[var(--bg)]'>
      <header className='flex h-12 shrink-0 items-center gap-2 border-[var(--border)] border-b pr-2 pl-4'>
        {running && <RunningDot />}
        <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>
          {chat.title}
        </span>
        {chat.owner && <Avatar size='xs' name={chat.owner} />}
        <HeaderButton label='Close chat' onClick={onClose}>
          <X className='size-[14px] text-[var(--text-icon)]' />
        </HeaderButton>
      </header>
      {running ? (
        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-5'>
          <div className='flex flex-col gap-8'>
            {runs.map((work) => (
              <AgentRun key={work.issue} work={work} workspaceId={workspace.id} />
            ))}
          </div>
        </div>
      ) : chat.id === 'new' ? (
        <div className='flex min-h-0 flex-1 flex-col justify-end px-3 pb-3'>
          <MockComposer placeholder={`Ask Sim about ${workspace.name}…`} />
        </div>
      ) : (
        <ChatThread placeholder={`Ask Sim about ${workspace.name}…`} />
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
