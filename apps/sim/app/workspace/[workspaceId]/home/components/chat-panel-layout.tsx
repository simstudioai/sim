'use client'

import type {
  CSSProperties,
  FocusEventHandler,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  Ref,
} from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { ArrowLeft, Expand, Minimize, PanelLeft } from '@sim/emcn/icons'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

interface ChatPanelLayoutProps {
  ref?: Ref<HTMLDivElement>
  children: ReactNode
  panel: ReactNode
  collapsed: boolean
  chatHidden?: boolean
  /** Px the chat leaves for the panel while the panel overlays it (expanded or settling). */
  chatReserve?: number
  onToggleChat?: () => void
  label: string
  activityCount?: number
  onToggle: () => void
  onResize: PointerEventHandler<HTMLDivElement>
  onResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  /** Reports the panel's current width and bounds on the divider's `aria-value*`. */
  onResizeFocus: FocusEventHandler<HTMLDivElement>
}

/** Shared resize handle and collapse control for resources and Search results. */
export function ChatPanelLayout({
  ref,
  children,
  panel,
  collapsed,
  chatHidden = false,
  chatReserve,
  onToggleChat,
  label,
  activityCount = 0,
  onToggle,
  onResize,
  onResizeKeyDown,
  onResizeFocus,
}: ChatPanelLayoutProps) {
  const toggleLabel = `${collapsed ? 'Expand' : 'Collapse'} ${label}${
    collapsed && activityCount > 0
      ? `, ${activityCount} resource${activityCount === 1 ? '' : 's'} updated`
      : ''
  }`
  const canToggleChat = Boolean(onToggleChat) && !collapsed
  const overlaid = chatReserve !== undefined
  return (
    <div
      ref={ref}
      className={cn(
        'relative flex h-full min-h-0 min-w-0 bg-[var(--bg)]',
        RESOURCE_HEADER_CLASSES.layout,
        canToggleChat &&
          '[--resource-header-fixed-reserve:calc(var(--resource-header-end-inset)_+_2*var(--resource-header-toggle-hit-size)_+_2px)]',
        collapsed && '[--chat-header-end-reserve:var(--resource-header-fixed-reserve)]'
      )}
    >
      <div
        className={cn(
          'contents',
          overlaid && '[&>*]:mr-[var(--chat-panel-reserve)]',
          !collapsed && 'max-md:hidden'
        )}
        style={
          overlaid ? ({ '--chat-panel-reserve': `${chatReserve}px` } as CSSProperties) : undefined
        }
        inert={chatHidden}
      >
        {children}
      </div>
      {!collapsed && !overlaid && (
        <div className='relative z-20 w-0 flex-none max-md:hidden'>
          <div
            className='absolute inset-y-0 left-[-4px] w-[8px] cursor-ew-resize focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--selection)]'
            role='separator'
            tabIndex={0}
            aria-orientation='vertical'
            aria-label={`Resize ${label}`}
            onPointerDown={onResize}
            onKeyDown={onResizeKeyDown}
            onFocus={onResizeFocus}
          />
        </div>
      )}
      {panel}
      <div
        className={cn(
          'z-30 max-md:w-[var(--resource-header-toggle-hit-size)] max-md:justify-center',
          RESOURCE_HEADER_CLASSES.overlay,
          RESOURCE_HEADER_CLASSES.endPosition
        )}
      >
        <Button
          variant='ghost'
          size={null}
          type='button'
          onClick={onToggle}
          className="after:-translate-x-1/2 after:-translate-y-1/2 relative size-[var(--resource-header-toggle-size)] rounded-[8px] after:absolute after:top-1/2 after:left-1/2 after:size-[var(--resource-header-toggle-hit-size)] after:content-[''] hover-hover:bg-[var(--surface-active)]"
        >
          <span className={cn('sr-only', !collapsed && 'max-md:hidden')}>{toggleLabel}</span>
          {!collapsed && <span className='sr-only hidden max-md:block'>Back to chat</span>}
          <span className='relative'>
            {!collapsed && (
              <ArrowLeft className='hidden size-[16px] text-[var(--text-icon)] max-md:block' />
            )}
            <PanelLeft
              className={cn(
                '-scale-x-100 size-[16px] text-[var(--text-icon)]',
                !collapsed && 'max-md:hidden'
              )}
            />
            {collapsed && activityCount > 0 && (
              <span
                aria-hidden='true'
                className='-top-0.5 -right-0.5 absolute size-1.5 rounded-full bg-[var(--brand-blue)]'
              />
            )}
          </span>
        </Button>
      </div>
      {canToggleChat && (
        <div
          className={cn(
            'z-30',
            RESOURCE_HEADER_CLASSES.overlay,
            RESOURCE_HEADER_CLASSES.adjacentEndPosition
          )}
        >
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                size={null}
                type='button'
                onClick={onToggleChat}
                aria-label={chatHidden ? 'Restore split view' : 'Expand pane'}
                aria-pressed={chatHidden}
                className='size-[var(--resource-header-toggle-size)] rounded-lg hover-hover:bg-[var(--surface-active)]'
              >
                {chatHidden ? (
                  <Minimize className='size-[16px] text-[var(--text-icon)]' />
                ) : (
                  <Expand className='size-[16px] text-[var(--text-icon)]' />
                )}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='bottom'>
              {chatHidden ? 'Restore split view' : 'Expand pane'}
            </Tooltip.Content>
          </Tooltip.Root>
        </div>
      )}
    </div>
  )
}

interface ChatPanelContentProps {
  children: ReactNode
  ref?: Ref<HTMLDivElement>
  collapsed: boolean
  className?: string
  onInteraction?: () => void
}

/**
 * The width element measured by the shared divider and native resource surfaces. Its content keeps
 * the open width, so opening and closing slide it under the clipped edge instead of reflowing it.
 */
export function ChatPanelContent({
  children,
  ref,
  collapsed,
  className,
  onInteraction,
}: ChatPanelContentProps) {
  return (
    <div
      ref={ref}
      data-mothership-panel=''
      onPointerDownCapture={onInteraction}
      onKeyDownCapture={onInteraction}
      inert={collapsed}
      className={cn(
        'relative z-10 flex h-full flex-col overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-200 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none max-md:absolute max-md:inset-0 max-md:w-full! max-md:min-w-0! max-md:border-l-0 max-md:transition-none',
        collapsed ? 'w-0 min-w-0 border-l-0 max-md:hidden' : 'w-1/2 border-l',
        '[--workspace-content-title-bar-inset:0px]',
        '[&>*]:min-w-[var(--chat-panel-width)] max-md:[&>*]:min-w-0',
        className
      )}
    >
      {children}
    </div>
  )
}
