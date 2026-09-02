'use client'

import { type ReactNode, useState } from 'react'
import { Button, chipIconSlotClass, cn, OverflowText, Tooltip } from '@sim/emcn'
import { Check, Link as LinkIcon } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { findTermMatches, queryTerms } from '@/lib/knowledge/search/snippet'
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

const logger = createLogger('SourceCard')

/** How long the copied state shows on the copy-link action. */
const COPIED_FEEDBACK_MS = 1_500

/**
 * The row every source card and its linkless sibling share: the chat surface's
 * row rhythm, a hairline between adjacent rows, and the surface fill on hover
 * or focus, so a list of results reads like the lists around the composer.
 */
export const SOURCE_ROW_CLASSES =
  'group/source not-prose flex items-start gap-2 border-[var(--border)] px-2 py-2 transition-colors focus-within:bg-[var(--surface-5)] hover-hover:bg-[var(--surface-5)] [&+&]:border-t'

/** The 16px mark slot, nudged to centre on the title's first line. */
export const SOURCE_ROW_MARK_CLASSES = cn(chipIconSlotClass, 'mt-[3px]')

/**
 * The snippet with every query term in bold, so the reader sees why the
 * document matched. Terms are matched as whole words in any script,
 * case-insensitively, by the same rule the snippet was centred with.
 */
export function highlightTerms(text: string, query: string | undefined): ReactNode {
  const matches = findTermMatches(text, queryTerms(query))
  if (matches.length === 0) return text
  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index))
    parts.push(
      <strong key={match.index} className='font-medium text-[var(--text-primary)]'>
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

interface CopyLinkActionProps {
  url: string
}

/**
 * Copies the document's link; confirms with a check for a moment. The check
 * only shows once the clipboard accepted the write: a page denied clipboard
 * access is left at "Copy link" rather than claiming a copy that never landed.
 */
function CopyLinkAction({ url }: CopyLinkActionProps) {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Copy link'
          onClick={() => {
            navigator.clipboard.writeText(url).then(
              () => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
              },
              (error: unknown) => {
                logger.warn('Copying the document link failed', {
                  error: getErrorMessage(error),
                })
              }
            )
          }}
        >
          {copied ? <Check className='size-[14px]' /> : <LinkIcon className='size-[14px]' />}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{copied ? 'Copied' : 'Copy link'}</Tooltip.Content>
    </Tooltip.Root>
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

/**
 * One document a search found, laid out to be scanned: the source's brand
 * mark or favicon, the title as a link back to the document, where it lives,
 * who it is from, and when it last changed, and the passage that matched with
 * the query terms in bold. Actions stay out of the way until the row is
 * hovered or its title focused. The same row serves the composer's search
 * results and, in its dense form, the footer of a reply that cited sources.
 */
export function SourceCard({ source, query, onSummarize, dense = false }: SourceCardProps) {
  const hostname = externalLinkHostname(source.url)
  const ConnectorIcon = source.connectorType
    ? BRAND_ICON_BY_BASE_TYPE.get(source.connectorType)
    : undefined
  const updatedAt = parseUpdatedAt(source.updatedAt)
  const meta = [
    sourceLabel(source),
    source.author?.trim() || null,
    updatedAt ? formatDate(updatedAt) : null,
  ].filter((part): part is string => Boolean(part))

  const mark = ConnectorIcon ? (
    <BrandIcon icon={ConnectorIcon} className='size-[16px]' />
  ) : hostname ? (
    <img
      src={faviconUrl(hostname, 32)}
      alt=''
      className='size-[16px] rounded-[3px]'
      onError={hideBrokenFavicon}
    />
  ) : null

  if (dense) {
    return (
      <div className={cn(SOURCE_ROW_CLASSES, 'items-center py-1')}>
        <span className={chipIconSlotClass}>{mark}</span>
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          data-source-link=''
          onClick={(event) => handleExternalLinkClick(event, source.url)}
          className='min-w-0 flex-1 text-[var(--text-primary)] text-sm no-underline underline-offset-2 hover:underline'
        >
          <OverflowText
            label={source.title?.trim() || sourceLabel(source)}
            focusTarget='nearest-interactive'
          />
        </a>
        <OverflowText
          label={meta.join(' · ')}
          className='max-w-[40%] shrink-0 text-[var(--text-muted)] text-caption'
        />
        <div className='flex flex-shrink-0 items-center opacity-0 transition-opacity group-focus-within/source:opacity-100 group-hover/source:opacity-100 [@media(hover:none)]:opacity-100'>
          <CopyLinkAction url={source.url} />
        </div>
      </div>
    )
  }

  return (
    <div className={SOURCE_ROW_CLASSES}>
      <span className={SOURCE_ROW_MARK_CLASSES}>{mark}</span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          data-source-link=''
          onClick={(event) => handleExternalLinkClick(event, source.url)}
          className='block min-w-0 text-[var(--text-primary)] text-sm no-underline underline-offset-2 hover:underline'
        >
          <OverflowText
            label={source.title?.trim() || sourceLabel(source)}
            focusTarget='nearest-interactive'
          />
        </a>
        <OverflowText label={meta.join(' · ')} className='text-[var(--text-muted)] text-caption' />
        {source.snippet && (
          <p className='line-clamp-2 text-[var(--text-body)] text-small leading-snug'>
            {highlightTerms(source.snippet, query)}
          </p>
        )}
      </div>
      <div className='flex flex-shrink-0 items-center gap-1 self-start opacity-0 transition-opacity group-focus-within/source:opacity-100 group-hover/source:opacity-100 [@media(hover:none)]:opacity-100'>
        <CopyLinkAction url={source.url} />
        {onSummarize && (
          <Button variant='ghost' size='sm' onClick={() => onSummarize(source)}>
            Summarize
          </Button>
        )}
      </div>
    </div>
  )
}
