'use client'

import { Tooltip } from '@/components/emcn'
import { X } from '@/components/emcn/icons'
import { ChatSwitcher } from '@/app/workspace/[workspaceId]/components/chat-switcher'
import { SidebarToggle } from '@/app/workspace/[workspaceId]/components/sidebar-toggle'

interface ChatTitleBarProps {
  /** The open chat's id — resolves the title and highlights the active row. */
  chatId?: string
  /**
   * Called with the picked chat id before navigation. The chat view uses this
   * to reopen a hidden chat pane (including re-picking the current chat).
   */
  onSelectChat?: (chatId: string) => void
  /** Renders a close (×) control at the bar's right edge that hides the chat pane. */
  onClose?: () => void
  /** The chat is generating a response — the switcher's recents icon becomes a spinner. */
  isWorking?: boolean
}

/**
 * A Codex-style title bar for an open Mothership chat. The title is a chip with
 * a chevron that opens the workspace's chat list inline, letting the user jump
 * straight between chats without returning to the new-chat view. Selecting a
 * chat navigates to it.
 */
export function ChatTitleBar({ chatId, onSelectChat, onClose, isWorking }: ChatTitleBarProps) {
  return (
    <div className='flex h-[44px] flex-shrink-0 items-center gap-1 border-[var(--border)] border-b px-4'>
      {/* Edge controls pull out by 9px so their 30px hover pills sit 7px from
          the panel edge — matching the pill's 7px top/bottom gap in the bar. */}
      <SidebarToggle className='-ml-[9px]' />
      {/* The title bar only renders on chat surfaces, so no chat id means the
          new-chat empty state — never fall back to the most recent chat. */}
      <ChatSwitcher
        chatId={chatId}
        isNewChat={!chatId}
        onSelectChat={onSelectChat}
        isWorking={isWorking}
      />
      {onClose && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type='button'
              onClick={onClose}
              aria-label='Close chat'
              className='-mr-[9px] ml-auto flex size-[30px] flex-shrink-0 items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]'
            >
              <X className='size-[14px] text-[var(--text-icon)]' />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>
            <p>Close chat</p>
          </Tooltip.Content>
        </Tooltip.Root>
      )}
    </div>
  )
}
