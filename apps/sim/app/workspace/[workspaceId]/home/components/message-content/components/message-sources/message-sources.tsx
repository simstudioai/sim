'use client'

import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@sim/emcn'
import { BookOpen } from '@sim/emcn/icons'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

/** The action-row button, matching the copy and vote buttons beside it with room for a count. */
const BUTTON_CLASSES =
  'flex h-[26px] items-center gap-1 rounded-[6px] px-1.5 text-[var(--text-icon)] text-caption transition-colors hover-hover:bg-[var(--surface-hover)] focus-visible:outline-none data-[state=open]:bg-[var(--surface-active)] data-[state=open]:hover-hover:bg-[var(--surface-active)]'

interface MessageSourcesProps {
  sources: readonly SourceTagData[]
}

/**
 * The documents a reply cited, once each, behind one button in the reply's
 * action row: the prose already cites each claim inline, so the full list is
 * there for whoever wants it without a second block under the answer. Opens a
 * popover of one dense row per document.
 */
export function MessageSources({ sources }: MessageSourcesProps) {
  if (sources.length === 0) return null
  const label = `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`

  return (
    <Popover>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <PopoverTrigger asChild>
            <button type='button' aria-label={label} className={BUTTON_CLASSES}>
              <BookOpen className='size-[14px]' />
              <span>{sources.length}</span>
            </button>
          </PopoverTrigger>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>{label}</Tooltip.Content>
      </Tooltip.Root>
      <PopoverContent align='start' side='top' sideOffset={4} className='w-[420px] p-0'>
        <div className='flex flex-col py-1'>
          {sources.map((source) => (
            <SourceCard key={source.url} source={source} dense />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
