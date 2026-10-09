'use client'

import type {
  FocusEventHandler,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  Ref,
} from 'react'
import { Button, cn } from '@sim/emcn'
import { ArrowLeft, PanelLeft } from '@sim/emcn/icons'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

interface ChatPanelLayoutProps {
  ref?: Ref<HTMLDivElement>
  children: ReactNode
  panel: ReactNode
  collapsed: boolean
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
  return (
    <div
      ref={ref}
      className={cn(
        '@container/chat-panel relative flex h-full min-h-0 min-w-0 bg-[var(--bg)]',
        RESOURCE_HEADER_CLASSES.layout
      )}
    >
      <div className={cn('contents', !collapsed && '@max-[960px]/chat-panel:hidden')}>
        {children}
      </div>
      {!collapsed && (
        <div className='relative z-20 @max-[960px]/chat-panel:hidden w-0 flex-none'>
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
        className={cn('z-30', RESOURCE_HEADER_CLASSES.overlay, RESOURCE_HEADER_CLASSES.endPosition)}
      >
        <Button
          variant='ghost'
          size={null}
          type='button'
          onClick={onToggle}
          className="after:-translate-x-1/2 after:-translate-y-1/2 relative size-[var(--resource-header-toggle-size)] rounded-[8px] after:absolute after:top-1/2 after:left-1/2 after:size-[var(--resource-header-toggle-hit-size)] after:content-[''] hover-hover:bg-[var(--surface-active)]"
        >
          <span className={cn('sr-only', !collapsed && '@max-[960px]/chat-panel:hidden')}>
            {toggleLabel}
          </span>
          {!collapsed && (
            <span className='sr-only @max-[960px]/chat-panel:block hidden'>Back to chat</span>
          )}
          <span className='relative'>
            {!collapsed && (
              <ArrowLeft className='@max-[960px]/chat-panel:block hidden size-[16px] text-[var(--text-icon)]' />
            )}
            <PanelLeft
              className={cn(
                '-scale-x-100 size-[16px] text-[var(--text-icon)]',
                !collapsed && '@max-[960px]/chat-panel:hidden'
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

/** The width element measured by the shared divider and native resource surfaces. */
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
        '@max-[960px]/chat-panel:absolute relative @max-[960px]/chat-panel:inset-0 z-10 flex h-full @max-[960px]/chat-panel:w-full! @max-[960px]/chat-panel:min-w-0! flex-col overflow-hidden border-[var(--border)] @max-[960px]/chat-panel:border-l-0 bg-[var(--bg)] @max-[960px]/chat-panel:transition-none transition-[width,min-width,border-width] duration-200 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none',
        collapsed ? '@max-[960px]/chat-panel:hidden w-0 min-w-0 border-l-0' : 'w-1/2 border-l',
        '[--workspace-content-title-bar-inset:0px]',
        className
      )}
    >
      {children}
    </div>
  )
}
