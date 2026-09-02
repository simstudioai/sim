'use client'

import { type ReactNode, useState } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { Check, Link as LinkIcon } from '@sim/emcn/icons'
import { formatDate } from '@sim/utils/formatting'
import { faviconUrl } from '@/lib/core/utils/favicon'
import {
  externalLinkHostname,
  handleExternalLinkClick,
  hideBrokenFavicon,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/external-link'
import {
  BRAND_ICON_BY_BASE_TYPE,
  sourceLabel,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { BrandIcon } from '@/blocks/brand-icon'

/** Query terms shorter than this are too common to bold. */
const MIN_HIGHLIGHT_TERM_LENGTH = 3
/** How long the copied state shows on the copy-link action. */
const COPIED_FEEDBACK_MS = 1_500

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The snippet with every query term in bold, so the reader sees why the
 * document matched. Terms are matched as whole words, case-insensitively.
 */
export function highlightTerms(text: string, query: string | undefined): ReactNode {
  const terms = [
    ...new Set(
      (query ?? '')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= MIN_HIGHLIGHT_TERM_LENGTH)
    ),
  ]
  if (terms.length === 0) return text
  const pattern = new RegExp(`\\b(${terms.map(escapeRegExp).join('|')})\\b`, 'gi')
  const parts = text.split(pattern)
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className='font-semibold text-[var(--text-primary)]'>
        {part}
      </strong>
    ) : (
      part
    )
  )
}

function parseUpdatedAt(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

interface CopyLinkActionProps {
  url: string
}

/** Copies the document's link; confirms with a check for a moment. */
function CopyLinkAction({ url }: CopyLinkActionProps) {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='ghost'
          size='sm'
          aria-label='Copy link'
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
            })
          }}
        >
          {copied ? (
            <Check className='size-[14px] text-[var(--text-icon)]' />
          ) : (
            <LinkIcon className='size-[14px] text-[var(--text-icon)]' />
          )}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{copied ? 'Copied' : 'Copy link'}</Tooltip.Content>
    </Tooltip.Root>
  )
}

interface SourceCardProps {
  source: SourceTagData
  /** The query the document was found for; its terms are bolded in the snippet. */
  query?: string
  /** Offers a Summarize action that asks the agent about this document. */
  onSummarize?: (source: SourceTagData) => void
}

/**
 * One document a search found, laid out to be scanned: the source's brand
 * mark or favicon, the title as a link back to the document, where it lives
 * and when it last changed, and the passage that matched with the query terms
 * in bold. Actions stay out of the way until the row is hovered or focused.
 * The same row serves the composer's search results and the footer of a reply
 * that cited its sources with a snippet.
 */
export function SourceCard({ source, query, onSummarize }: SourceCardProps) {
  const hostname = externalLinkHostname(source.url)
  const ConnectorIcon = source.connectorType
    ? BRAND_ICON_BY_BASE_TYPE.get(source.connectorType)
    : undefined
  const updatedAt = parseUpdatedAt(source.updatedAt)
  const meta = [sourceLabel(source), updatedAt ? `Updated ${formatDate(updatedAt)}` : null].filter(
    (part): part is string => Boolean(part)
  )

  return (
    <div className='group/source not-prose flex items-start gap-3 rounded-md px-2 py-2 transition-colors focus-within:bg-[var(--surface-5)] hover-hover:bg-[var(--surface-5)]'>
      <span className='mt-[3px] flex size-[16px] flex-shrink-0 items-center justify-center'>
        {ConnectorIcon ? (
          <BrandIcon icon={ConnectorIcon} className='size-[16px]' />
        ) : hostname ? (
          <img
            src={faviconUrl(hostname, 32)}
            alt=''
            className='size-[16px] rounded-[3px]'
            onError={hideBrokenFavicon}
          />
        ) : null}
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          data-source-link=''
          onClick={(event) => handleExternalLinkClick(event, source.url)}
          className={cn(
            'truncate text-[var(--text-primary)] text-sm no-underline hover:underline',
            'underline-offset-2'
          )}
        >
          {source.title?.trim() || sourceLabel(source)}
        </a>
        <p className='truncate text-[var(--text-muted)] text-caption'>{meta.join(' · ')}</p>
        {source.snippet && (
          <p className='line-clamp-2 text-[var(--text-body)] text-small leading-snug'>
            {highlightTerms(source.snippet, query)}
          </p>
        )}
      </div>
      <div
        className={cn(
          'flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity',
          'focus-within:opacity-100 group-hover/source:opacity-100'
        )}
      >
        <CopyLinkAction url={source.url} />
        {onSummarize && (
          <Button variant='default' size='sm' onClick={() => onSummarize(source)}>
            Summarize
          </Button>
        )}
      </div>
    </div>
  )
}
