'use client'

import { type ReactNode, useId } from 'react'
import { ChevronDown, cn, Expandable, ExpandableContent, handleKeyboardActivation } from '@sim/emcn'
import { ActivityViewport } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-viewport'

export interface ActivityDisclosureProps {
  header: ReactNode
  children: ReactNode
  expanded: boolean
  onToggle: () => void
  isStreaming: boolean
  collapsible?: boolean
  unbounded?: boolean
}

/** Shared disclosure chrome; callers own expansion and blocking-interaction decisions. */
export function ActivityDisclosure({
  header,
  children,
  expanded,
  onToggle,
  isStreaming,
  unbounded = false,
  collapsible = true,
}: ActivityDisclosureProps) {
  const contentId = useId()
  const headerId = useId()

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <div
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? expanded : undefined}
        aria-controls={collapsible ? contentId : undefined}
        aria-labelledby={collapsible ? headerId : undefined}
        onClick={collapsible ? onToggle : undefined}
        onKeyDown={collapsible ? (event) => handleKeyboardActivation(event, onToggle) : undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 text-left',
          collapsible && 'group/agent cursor-pointer'
        )}
      >
        <span id={headerId} className='flex min-w-0'>
          {header}
        </span>
        {collapsible && (
          <ChevronDown
            aria-hidden
            className={cn(
              'size-[14px] shrink-0 text-[var(--text-icon)] transition-[transform,opacity] duration-150',
              !expanded &&
                '-rotate-90 opacity-0 group-hover/agent:opacity-100 group-focus-visible/agent:opacity-100'
            )}
          />
        )}
      </div>
      {collapsible && (
        <Expandable expanded={expanded}>
          <ExpandableContent id={contentId}>
            <ActivityViewport isStreaming={isStreaming} unbounded={unbounded}>
              {children}
            </ActivityViewport>
          </ExpandableContent>
        </Expandable>
      )}
    </div>
  )
}
