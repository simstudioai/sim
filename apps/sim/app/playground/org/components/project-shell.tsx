'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { Chip, ChipLink, cn } from '@sim/emcn'
import { SquareArrowUpRight, X } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { AttachedResource } from '@/app/playground/org/components/attached-resource'
import { ChatThread } from '@/app/playground/org/components/chat-thread'
import { type PanelResource, resolvePanelResource } from '@/app/playground/org/lib/chat-resources'
import type { Workspace } from '@/app/playground/org/lib/mock-data'
import { PROTO_BASE } from '@/app/playground/org/lib/routes'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { useSidebarStore } from '@/stores/sidebar/store'

interface ProjectShellProps {
  workspace: Workspace
  children: ReactNode
}

/**
 * Any project page with a chat docked on its left. The org sidebar folds to its rail while the
 * chat is open, so the page keeps most of its width; `?open=` names what the chat starts with.
 */
export function ProjectShell({ workspace, children }: ProjectShellProps) {
  const [{ chat, open }, setParams] = useQueryStates(protoParsers)
  const docked = chat === 'new'
  const context = open ? resolvePanelResource(open) : undefined
  const isCollapsed = useSidebarStore((state) => state.isCollapsed)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const foldedRef = useRef(false)

  useEffect(() => {
    if (docked && !isCollapsed && !foldedRef.current) {
      foldedRef.current = true
      toggleCollapsed()
    }
    if (!docked && foldedRef.current) {
      foldedRef.current = false
      if (isCollapsed) toggleCollapsed()
    }
    // Only the dock edge matters; a user toggling the rail by hand is left alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked])

  return (
    <div className='flex h-full min-h-0'>
      <div
        className={cn(
          'shrink-0 overflow-hidden border-[var(--border)] transition-[width] duration-200 ease-out',
          docked ? 'w-[440px] border-r' : 'w-0'
        )}
      >
        {docked && (
          <DockedChat
            key={open}
            workspace={workspace}
            context={context}
            onClose={() => void setParams({ chat: null, open: null }, { history: 'replace' })}
          />
        )}
      </div>
      <div className='min-w-0 flex-1'>{children}</div>
    </div>
  )
}

interface DockedChatProps {
  workspace: Workspace
  context?: PanelResource
  onClose: () => void
}

/** The chat column: a fresh chat with what you were looking at attached; expands to the chat page. */
function DockedChat({ workspace, context, onClose }: DockedChatProps) {
  const expandHref = `${PROTO_BASE}/chat/new${context ? `?open=${context.kind}:${context.workspaceId}:${context.id}` : ''}`
  return (
    <div className='flex h-full w-[440px] flex-col bg-[var(--bg)]'>
      <header className='flex h-12 shrink-0 items-center gap-1 border-[var(--border)] border-b pr-2 pl-4'>
        <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>New chat</span>
        <ChipLink href={expandHref} leftIcon={SquareArrowUpRight} aria-label='Open as a page' />
        <Chip leftIcon={X} aria-label='Close chat' onClick={onClose} />
      </header>
      <ChatThread
        placeholder={`Ask Sim about ${context?.name ?? workspace.name}…`}
        seed={[]}
        attachments={context && <AttachedResource resource={context} />}
      />
    </div>
  )
}
