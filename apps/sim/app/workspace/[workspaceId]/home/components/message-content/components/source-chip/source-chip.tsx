'use client'

import { chipFilledFillTokens, chipHoverSurfaceClass, cn, OverflowText, Tooltip } from '@sim/emcn'
import {
  handleExternalLinkClick,
  linkSiteName,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/external-link'
import { SourceIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip/source-icon'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

/** The source's site or provider, separate from its document title. */
export function sourceSiteName(source: SourceTagData): string {
  return linkSiteName(source.url, source.siteName)
}

/** Citations identify the document; source metadata is the fallback when its title is unavailable. */
export function sourceLabel(source: SourceTagData): string {
  return source.title?.trim() || sourceSiteName(source)
}

interface SourceChipProps {
  source: SourceTagData
}

/**
 * A cited document as a small round pill — the connector's brand mark or the
 * site favicon, then the document title — used inline at the citation point and
 * again in the footer strip. Built on the chip fill and hover tokens at a 20px
 * height so it sits inside a line of prose; the 30px `Chip` is the wrong scale
 * for a citation. Opens the document like any external link in the reply.
 */
export function SourceChip({ source }: SourceChipProps) {
  /** Slack's connector prefixes channel titles with `#channel: `; direct messages omit `#`. */
  const slackChannel =
    source.connectorType === 'slack' ? source.title?.match(/^(#[^:\s]+): /)?.[1] : undefined

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          onClick={(event) => handleExternalLinkClick(event, source.url)}
          className={cn(
            'not-prose inline-flex h-[20px] max-w-[160px] shrink-0 items-center gap-1 rounded-full px-1.5 align-middle text-[var(--text-body)] text-caption no-underline transition-colors',
            chipFilledFillTokens,
            chipHoverSurfaceClass
          )}
        >
          <SourceIcon source={source} size='inline' />
          <OverflowText label={slackChannel ?? sourceLabel(source)} tooltipEnabled={false} />
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content className='whitespace-normal [overflow-wrap:anywhere]'>
        {source.title ? (
          <span className='flex min-w-0 flex-col gap-0.5'>
            <span>{source.title}</span>
            <span className='text-[var(--text-muted)]'>{source.url}</span>
          </span>
        ) : (
          <span>{source.url}</span>
        )}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
