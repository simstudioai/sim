'use client'

import { useMemo, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import {
  POPOVER_ANIMATION_CLASSES,
  Popover,
  PopoverAnchor,
  PopoverContent,
  ThinkingLoader,
  Tooltip,
} from '@/components/emcn'
import { BubbleChatDelay, ChevronDown } from '@/components/emcn/icons'
import {
  isMothershipPageId,
  MOTHERSHIP_PAGES,
  type MothershipResource,
} from '@/lib/copilot/resources/types'
import { cn } from '@/lib/core/utils/cn'
import { useSidebarToggleHidden } from '@/app/workspace/[workspaceId]/components/sidebar-toggle'
import { ChatHistoryList } from '@/app/workspace/[workspaceId]/home/components/chat-history/chat-history-list'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useMothershipTabsStore } from '@/stores/mothership-tabs/store'

const FALLBACK_TITLE = 'New chat'

/**
 * Resolves the resource the current page represents, so opening a chat keeps
 * that page on screen as the focused panel tab instead of teleporting away.
 * Titles are placeholders — the tab strip resolves live names from queries.
 */
function derivePageResource(pathname: string, workspaceId: string): MothershipResource | null {
  const prefix = `/workspace/${workspaceId}/`
  if (!pathname.startsWith(prefix)) return null
  const [segment, detail] = pathname.slice(prefix.length).split('/')
  if (segment === 'tables' && detail) return { type: 'table', id: detail, title: 'Table' }
  if (segment === 'knowledge' && detail) {
    return { type: 'knowledgebase', id: detail, title: 'Knowledge Base' }
  }
  if (isMothershipPageId(segment)) {
    return { type: 'page', id: segment, title: MOTHERSHIP_PAGES[segment] }
  }
  return null
}

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
   * Compact icon-only chip for non-chat pages, where the page title owns the
   * bar — a chat name beside it would read as a breadcrumb segment.
   */
  iconOnly?: boolean
  /**
   * Called with the picked chat id before navigation. The chat view uses this
   * to reopen a hidden chat pane (including re-picking the current chat).
   */
  onSelectChat?: (chatId: string) => void
  /**
   * When false, selecting a chat only fires {@link onSelectChat} — the host
   * owns what happens next. The workflow editor uses this to dock the chat
   * beside the canvas instead of leaving the page.
   */
  navigateOnSelect?: boolean
  /**
   * The chat is generating a response — the recents icon becomes a spinner so
   * the title bar signals work in progress even when the messages are off
   * screen (collapsed pane, scrolled away).
   */
  isWorking?: boolean
}

/**
 * The chat-switcher chip — a chat icon + title that lives at the
 * top-left of every page's title bar. Clicking it opens the workspace's chat
 * list inline; selecting a chat navigates to it from anywhere.
 */
export function ChatSwitcher({
  chatId,
  isNewChat = false,
  iconOnly = false,
  onSelectChat,
  navigateOnSelect = true,
  isWorking = false,
}: ChatSwitcherProps) {
  const isHidden = useSidebarToggleHidden()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const router = useRouter()
  const pathname = usePathname()
  const openTabs = useMothershipTabsStore((state) => state.openTabs)
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
    if (!navigateOnSelect) return
    if (selectedChatId === chatId) return
    // Opening a chat never takes away what you're looking at: the current
    // page becomes the focused panel tab, and the chat slides in beside it.
    const pageResource = derivePageResource(pathname, workspaceId)
    if (pageResource) {
      openTabs(workspaceId, [pageResource], { focusId: pageResource.id })
      router.push(`/workspace/${workspaceId}/chat/${selectedChatId}?resource=${pageResource.id}`)
      return
    }
    router.push(`/workspace/${workspaceId}/chat/${selectedChatId}`)
  }

  /** The split chip's primary action: jump straight into the latest chat. */
  const handleOpenMostRecent = () => {
    if (!mostRecent) {
      setOpen(true)
      return
    }
    handleSelect(mostRecent.id)
  }

  const chipIcon = isWorking ? (
    <ThinkingLoader size={18} className='flex-shrink-0' />
  ) : (
    <BubbleChatDelay className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
  )

  const trigger = iconOnly ? (
    /* Split chip: the icon opens the most recent chat outright; the chevron
       opens the Recents list. The 1px bg-colored divider only reads when a
       segment carries its fill, slicing the pill into two buttons. */
    <span className='flex h-[30px] flex-shrink-0 items-stretch'>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type='button'
            aria-label='Open most recent chat'
            onClick={handleOpenMostRecent}
            className='flex items-center rounded-l-lg px-1.5 transition-colors hover-hover:bg-[var(--surface-active)]'
          >
            {chipIcon}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Open chat</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <span aria-hidden='true' className='w-px self-stretch bg-[var(--bg)]' />
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type='button'
            aria-label='Recents'
            onClick={() => setOpen((prev) => !prev)}
            className={cn(
              'flex items-center rounded-r-lg px-1 transition-colors',
              'hover-hover:bg-[var(--surface-active)]',
              open && 'bg-[var(--surface-active)]'
            )}
          >
            <ChevronDown className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Recents</p>
        </Tooltip.Content>
      </Tooltip.Root>
    </span>
  ) : (
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
      {chipIcon}
      <span className='min-w-0 truncate font-medium text-[14px] text-[var(--text-primary)]'>
        {title}
      </span>
      <ChevronDown className='ml-0.5 size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
    </button>
  )

  return (
    <Popover size='md' open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>{trigger}</PopoverAnchor>
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
