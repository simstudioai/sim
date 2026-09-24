import { useRef } from 'react'
import {
  chipHoverSurfaceClass,
  chipIconSlotClass,
  chipRadiusClass,
  cn,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import {
  externalLinkHostname,
  handleExternalLinkClick,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/external-link'
import {
  SourceIcon,
  sourceLabel,
  sourceSiteName,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

interface SearchActivityResultsProps {
  sources: SourceTagData[]
  query: string
}

/**
 * Bounded results keep every match available without growing the activity
 * transcript. The list shows four and a half 32px rows, so a clipped row signals
 * that it scrolls.
 */
export function SearchActivityResults({ sources, query }: SearchActivityResultsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef)

  return (
    <div className={cn('overflow-hidden border border-[var(--border)]', chipRadiusClass)}>
      <div
        ref={scrollRef}
        role='region'
        aria-label={`Results for ${query}`}
        className={cn('max-h-[152px] overflow-y-auto overscroll-contain p-1', scrollFadeClass)}
        {...scrollFadeAttributes(edges)}
      >
        <ul className='m-0 list-none p-0'>
          {sources.map((source) => {
            const hostname = externalLinkHostname(source.url)
            return (
              <li key={source.url}>
                <a
                  href={source.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  onClick={(event) => handleExternalLinkClick(event, source.url)}
                  className={cn(
                    'not-prose flex h-8 min-w-0 items-center gap-2 px-2 text-[var(--text-body)] text-small no-underline transition-colors focus-visible:bg-[var(--surface-hover)] focus-visible:outline-none',
                    chipHoverSurfaceClass,
                    chipRadiusClass
                  )}
                >
                  <span className={chipIconSlotClass}>
                    <SourceIcon source={source} />
                  </span>
                  <OverflowText
                    label={sourceLabel(source)}
                    focusTarget='nearest-interactive'
                    className='flex-1'
                  />
                  <OverflowText
                    label={hostname?.replace(/^www\./, '') ?? sourceSiteName(source)}
                    className='max-w-[35%] text-[var(--text-muted)] text-caption'
                  />
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
