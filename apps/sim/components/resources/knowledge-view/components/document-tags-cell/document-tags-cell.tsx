'use client'

import { FloatingTooltip, isTextClipped, useFloatingTooltip } from '@sim/emcn'
import type { TagValue } from '@/components/resources/knowledge-view/utils/document-rows'

interface DocumentTagsCellProps {
  tags: TagValue[]
}

/**
 * Tags cell for the documents table. Shows the joined tag values inline and
 * reveals the full `name: value` breakdown only when the inline text is
 * actually clipped — an un-truncated cell already says everything the tooltip
 * would.
 */
export function DocumentTagsCell({ tags }: DocumentTagsCellProps) {
  const { state, handlers } = useFloatingTooltip(isTextClipped)

  return (
    <>
      <span
        role='presentation'
        className='block max-w-full truncate text-[var(--text-secondary)] text-caption'
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        {...handlers}
      >
        {tags.map((tag) => tag.value).join(', ')}
      </span>
      <FloatingTooltip state={state} className='max-w-[240px]'>
        <div className='flex flex-col gap-0.5'>
          {tags.map((tag) => (
            <div key={tag.slot} className='truncate text-xs'>
              <span className='text-[var(--text-muted)]'>{tag.displayName}:</span> {tag.value}
            </div>
          ))}
        </div>
      </FloatingTooltip>
    </>
  )
}
