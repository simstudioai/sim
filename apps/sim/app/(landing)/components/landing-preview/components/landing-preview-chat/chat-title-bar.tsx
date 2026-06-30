import { BubbleChatDelay, ChevronDown, PanelLeft, X } from '@sim/emcn'

interface LandingPreviewChatTitleBarProps {
  /** Chat name shown in the switcher chip. */
  chatName: string
  /** Renders the close (×) control at the right edge (shown when a resource is staged). */
  showClose?: boolean
}

/**
 * The chat pane's title bar - a faithful copy of the workspace `ChatTitleBar`:
 * the sidebar toggle, the chat-switcher split pill (chat icon + name | chevron),
 * and an optional close control. Shared by the docked chat pane and the home
 * empty state so the two read identically.
 */
export function LandingPreviewChatTitleBar({
  chatName,
  showClose = false,
}: LandingPreviewChatTitleBarProps) {
  return (
    <div className='flex h-[44px] flex-shrink-0 items-center gap-1 border-[var(--border)] border-b px-4'>
      <span className='-ml-[9px] flex size-[30px] flex-shrink-0 items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]'>
        <PanelLeft className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
      </span>
      {/* Chat-switcher split pill: icon+name segment and a chevron segment
          sliced by a 1px panel-colored divider. */}
      <span className='flex h-[30px] min-w-0 flex-shrink items-stretch'>
        <span className='flex min-w-0 items-center gap-1.5 rounded-l-lg pr-1 pl-2 transition-colors hover-hover:bg-[var(--surface-active)]'>
          <BubbleChatDelay className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
          <span className='min-w-0 truncate text-[var(--text-primary)] text-sm'>{chatName}</span>
        </span>
        <span aria-hidden='true' className='w-px self-stretch bg-[var(--surface-2)]' />
        <span className='flex items-center rounded-r-lg px-1 transition-colors hover-hover:bg-[var(--surface-active)]'>
          <ChevronDown className='h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)]' />
        </span>
      </span>
      {showClose && (
        <span className='-mr-[9px] ml-auto flex size-[30px] flex-shrink-0 items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]'>
          <X className='size-[14px] text-[var(--text-icon)]' />
        </span>
      )}
    </div>
  )
}
