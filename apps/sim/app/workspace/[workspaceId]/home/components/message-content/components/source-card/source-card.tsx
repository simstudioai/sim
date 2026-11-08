'use client'

import type { ReactNode } from 'react'
import {
  Chip,
  chipGeometryClass,
  chipHoverSurfaceClass,
  chipIconSlotClass,
  chipRadiusClass,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OverflowText,
  toast,
  useCopyToClipboard,
} from '@sim/emcn-legacy'
import { Check, Link as LinkIcon, MoreHorizontal, Sparkles } from '@sim/emcn-legacy/icons'
import { formatDate } from '@sim/utils/formatting'
import {
  useOpenSimLinkForm,
  useSimLinkOrganizationId,
} from '@/components/sim-links/sim-link-organization-provider'
import { SimLinkMenuItem } from '@/components/sim-links/sim-link-shortcut'
import { findTermMatches, queryTerms } from '@/lib/knowledge/search/snippet'
import { useChatChrome } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import {
  SourceIcon,
  sourceLabel,
  sourceSiteName,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useSourceNavigation } from '@/hooks/sim-search/source-history'

const SOURCE_ROW_CLASSES = cn(
  'not-prose flex items-start gap-2 px-2 py-2 transition-colors focus-within:bg-[var(--surface-hover)]',
  chipHoverSurfaceClass,
  chipRadiusClass
)
const SOURCE_ROW_MARK_CLASSES = cn(chipIconSlotClass, 'mt-0.5')

/**
 * The snippet with every query term in bold, so the reader sees why the
 * document matched. Terms are matched as whole words in any script,
 * case-insensitively, by the same rule the snippet was centred with.
 */
export function highlightTerms(
  text: string,
  query: string | undefined,
  termClassName = 'font-medium text-[var(--text-primary)]'
): ReactNode {
  const matches = findTermMatches(text, queryTerms(query))
  if (matches.length === 0) return text
  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index))
    parts.push(
      <strong key={match.index} className={termClassName}>
        {text.slice(match.index, match.index + match.length)}
      </strong>
    )
    cursor = match.index + match.length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function parseUpdatedAt(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Where a source lives, who wrote it and when it changed, in the order a result row reads them. */
export function sourceMeta(source: SourceTagData): string {
  const updatedAt = parseUpdatedAt(source.updatedAt)
  return [
    sourceSiteName(source),
    source.author?.trim() || null,
    updatedAt ? formatDate(updatedAt) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

interface SourceActionsProps {
  source: SourceTagData
  onSummarize?: (source: SourceTagData) => void
}

function SourceActions({ source, onSummarize }: SourceActionsProps) {
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })
  const simLinkOrganizationId = useSimLinkOrganizationId()
  const openSimLinkForm = useOpenSimLinkForm()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip
          leftIcon={copied ? Check : MoreHorizontal}
          aria-label={copied ? 'Link copied' : `Actions for ${sourceLabel(source)}`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {onSummarize && (
          <DropdownMenuItem onSelect={() => onSummarize(source)}>
            <Sparkles className='size-[14px]' />
            Summarize
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={async () => {
            if (!(await copy(source.url))) toast.error('Unable to copy link')
          }}
        >
          <LinkIcon className='size-[14px]' />
          Copy link
        </DropdownMenuItem>
        {simLinkOrganizationId && (
          <SimLinkMenuItem
            organizationId={simLinkOrganizationId}
            url={source.url}
            onCreate={() => openSimLinkForm(source.url, sourceLabel(source))}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SourceCardProps {
  source: SourceTagData
  /** The query the document was found for; its terms are bolded in the snippet. */
  query?: string
  /** Offers a Summarize action that asks the agent about this document. */
  onSummarize?: (source: SourceTagData) => void
  /**
   * One line per document: the mark, the title, and where it lives, with no
   * snippet. For a list under a reply whose prose already cites each claim.
   */
  dense?: boolean
}

/** Source results share the same document identity and actions across search and cited evidence. */
export function SourceCard({ source, query, onSummarize, dense = false }: SourceCardProps) {
  const { fontClassName } = useChatChrome()
  const navigate = useSourceNavigation(source)
  const meta = sourceMeta(source)

  if (dense) {
    return (
      <div className='not-prose py-1'>
        <div
          className={cn(
            chipGeometryClass,
            chipHoverSurfaceClass,
            'flex transition-colors focus-within:bg-[var(--surface-hover)]',
            fontClassName
          )}
        >
          <span className={chipIconSlotClass}>
            <SourceIcon source={source} />
          </span>
          <a
            href={source.url}
            target='_blank'
            rel='noopener noreferrer'
            data-source-link=''
            onClick={navigate}
            onAuxClick={navigate}
            className='min-w-0 flex-1 text-[var(--text-body)] text-sm no-underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-[var(--text-icon)]'
          >
            <OverflowText
              label={source.title?.trim() || sourceLabel(source)}
              focusTarget='nearest-interactive'
            />
          </a>
          <OverflowText
            label={meta}
            className='max-w-[40%] shrink-0 text-[var(--text-tertiary)] text-caption'
          />
          <SourceActions source={source} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn(SOURCE_ROW_CLASSES, fontClassName)}>
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div className='relative flex items-start gap-2 pr-8'>
          <span className={SOURCE_ROW_MARK_CLASSES}>
            <SourceIcon source={source} />
          </span>
          <a
            href={source.url}
            target='_blank'
            rel='noopener noreferrer'
            data-source-link=''
            onClick={navigate}
            onAuxClick={navigate}
            className='min-w-0 flex-1 text-[var(--text-body)] text-small no-underline [overflow-wrap:anywhere] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-[var(--text-icon)]'
          >
            {sourceLabel(source)}
          </a>
          <div className='-top-1.5 absolute right-0'>
            <SourceActions source={source} onSummarize={onSummarize} />
          </div>
        </div>
        <div className='flex min-w-0 flex-col gap-1 pl-6'>
          <OverflowText label={meta} className='text-[var(--text-tertiary)] text-caption' />
          {source.snippet && (
            <p className='line-clamp-3 text-[var(--text-body)] text-small [overflow-wrap:anywhere]'>
              {highlightTerms(source.snippet, query)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
