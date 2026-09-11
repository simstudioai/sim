'use client'

import { type ReactNode, useId } from 'react'
import { ChevronDown, cn, Expandable, ExpandableContent } from '@sim/emcn'
import { ActivityViewport } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-viewport'

interface ActivityDisclosureProps {
  header: ReactNode
  children: ReactNode
  expanded: boolean
  onToggle: () => void
  isStreaming: boolean
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
}: ActivityDisclosureProps) {
  const contentId = useId()
  const headerId = useId()

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <button
        type='button'
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-labelledby={headerId}
        onClick={onToggle}
        className='group/agent flex w-full min-w-0 cursor-pointer items-center gap-2 text-left'
      >
        <span id={headerId} className='flex min-w-0'>
          {header}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-[14px] shrink-0 text-[var(--text-icon)] transition-[transform,opacity] duration-150',
            !expanded &&
              '-rotate-90 opacity-0 group-hover/agent:opacity-100 group-focus-visible/agent:opacity-100'
          )}
        />
      </button>
      <Expandable expanded={expanded}>
        <ExpandableContent id={contentId}>
          <ActivityViewport isStreaming={isStreaming} unbounded={unbounded}>
            {children}
          </ActivityViewport>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
