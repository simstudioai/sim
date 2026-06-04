'use client'

import { useParams } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Link, MoreHorizontal, SquareArrowUpRight } from '@/components/emcn/icons'
import { useTasks } from '@/hooks/queries/tasks'

const FALLBACK_TITLE = 'New chat'

interface ChatTitleBarProps {
  /** The open chat's id. Resolves the title from the task list and powers the actions. */
  chatId?: string
}

/**
 * A Codex-style title bar pinned to the top of an open Mothership chat: the
 * chat title on the left, an action menu (kebab) on the right. The action set
 * is intentionally minimal for now — non-destructive, no-backend affordances —
 * and is the natural home for future per-chat actions (rename, pin, delete).
 */
export function ChatTitleBar({ chatId }: ChatTitleBarProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: tasks = [] } = useTasks(workspaceId)

  const title = tasks.find((task) => task.id === chatId)?.name ?? FALLBACK_TITLE
  const taskPath = chatId ? `/workspace/${workspaceId}/task/${chatId}` : null

  const handleOpenInNewTab = () => {
    if (taskPath) window.open(taskPath, '_blank', 'noopener,noreferrer')
  }

  const handleCopyLink = () => {
    if (taskPath) void navigator.clipboard?.writeText(`${window.location.origin}${taskPath}`)
  }

  return (
    <div className='flex h-[44px] flex-shrink-0 items-center gap-1 border-[var(--border)] border-b px-[24px]'>
      <span className='min-w-0 truncate font-medium text-[14px] text-[var(--text-primary)]'>
        {title}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size={null}
            type='button'
            aria-label='Chat actions'
            className='size-[28px] flex-shrink-0 rounded-[8px] hover-hover:bg-[var(--surface-active)]'
          >
            <MoreHorizontal className='size-[16px] text-[var(--text-icon)]' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' side='bottom' sideOffset={4}>
          <DropdownMenuItem disabled={!taskPath} onSelect={handleOpenInNewTab}>
            <SquareArrowUpRight />
            Open in new tab
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!taskPath} onSelect={handleCopyLink}>
            <Link />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
