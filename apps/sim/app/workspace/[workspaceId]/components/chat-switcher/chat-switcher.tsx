'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  POPOVER_ANIMATION_CLASSES,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/emcn'
import { ChevronDown, MessageCircle } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { useSidebarToggleHidden } from '@/app/workspace/[workspaceId]/components/sidebar-toggle'
import { ChatHistoryList } from '@/app/workspace/[workspaceId]/home/components/chat-history/chat-history-list'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'

const FALLBACK_TITLE = 'New chat'

interface ChatSwitcherProps {
  /**
   * The chat shown in the breadcrumb and highlighted in the list. Omitted on
   * non-chat pages, where the most recently updated chat is shown instead.
   */
  chatId?: string
  /**
   * Marks the new-chat empty state (home with no chat open): the chip reads
   * "New chat" instead of falling back to the most recently updated chat.
   */
  isNewChat?: boolean
  /**
   * Called with the picked chat id before navigation. The chat view uses this
   * to reopen a hidden chat pane (including re-picking the current chat).
   */
  onSelectChat?: (chatId: string) => void
}

/**
 * The chat-switcher chip — a "Chats / {title}" breadcrumb that lives at the
 * top-left of every page's title bar. Clicking it opens the workspace's chat
 * list inline; selecting a chat navigates to it from anywhere.
 */
export function ChatSwitcher({ chatId, isNewChat = false, onSelectChat }: ChatSwitcherProps) {
  const isHidden = useSidebarToggleHidden()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const router = useRouter()
  const { data: tasks = [] } = useMothershipChats(workspaceId)
  const [open, setOpen] = useState(false)

  const mostRecent = useMemo(
    () =>
      tasks.reduce<(typeof tasks)[number] | null>(
        (latest, task) => (!latest || task.updatedAt > latest.updatedAt ? task : latest),
        null
      ),
    [tasks]
  )

  if (isHidden || !workspaceId) return null

  const title = chatId
    ? (tasks.find((task) => task.id === chatId)?.name ?? FALLBACK_TITLE)
    : isNewChat
      ? FALLBACK_TITLE
      : (mostRecent?.name ?? FALLBACK_TITLE)

  const handleSelect = (selectedChatId: string) => {
    setOpen(false)
    onSelectChat?.(selectedChatId)
    if (selectedChatId === chatId) return
    router.push(`/workspace/${workspaceId}/chat/${selectedChatId}`)
  }

  return (
    <Popover size='md' open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type='button'
          aria-label='Switch chat'
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            'flex h-[30px] min-w-0 items-center gap-1.5 rounded-lg px-2 transition-colors',
            'hover-hover:bg-[var(--surface-active)]',
            open && 'bg-[var(--surface-active)]'
          )}
        >
          <MessageCircle className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
          <span className='flex-shrink-0 text-[14px] text-[var(--text-muted)]'>Chats</span>
          <span
            aria-hidden='true'
            className='flex-shrink-0 select-none text-[14px] text-[var(--text-icon)]'
          >
            /
          </span>
          <span className='min-w-0 truncate font-medium text-[14px] text-[var(--text-primary)]'>
            {title}
          </span>
          <ChevronDown className='ml-0.5 h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)]' />
        </button>
      </PopoverAnchor>
      {/* Mirrors the sidebar flyout's anchor rhythm: the chip sits at y 7..37 in
          the 44px bar, so offset 13 lands the panel 6px below the bar, and the
          -33 align offset walks back from the chip to 8px off the panel edge. */}
      <PopoverContent
        side='bottom'
        align='start'
        sideOffset={13}
        alignOffset={-33}
        minWidth={280}
        maxWidth={360}
        border
        className={cn(POPOVER_ANIMATION_CLASSES, 'bg-[var(--bg)] p-0 dark:bg-[var(--bg)]')}
      >
        <ChatHistoryList onSelect={handleSelect} activeChatId={chatId} autoFocus={open} />
      </PopoverContent>
    </Popover>
  )
}
