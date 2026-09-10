'use client'

import { chipFilledFillTokens, chipHoverSurfaceClass, cn, OverflowText, Tooltip } from '@sim/emcn'
import { stripVersionSuffix } from '@sim/utils/string'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { blockTypeToIconMap } from '@/lib/integrations'
import {
  externalLinkHostname,
  handleExternalLinkClick,
  hideBrokenFavicon,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/external-link'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { BrandIcon, type StyleableIcon } from '@/blocks/brand-icon'

/**
 * Brand marks by base block type. A connector id names the same product as its
 * integration block (`confluence`, `google_drive`), so the block's mark serves
 * the chip — through the catalog icon map rather than the connector registry,
 * which would drag seventy connector modules into every surface that renders
 * chat. Versioned catalog types (`gmail_v2`) collapse onto their base name.
 */
export const BRAND_ICON_BY_BASE_TYPE: ReadonlyMap<string, StyleableIcon> = new Map(
  Object.entries(blockTypeToIconMap).map(([type, icon]) => [stripVersionSuffix(type), icon])
)

/** The source's site or provider, separate from its document title. */
export function sourceSiteName(source: SourceTagData): string {
  const siteName = source.siteName?.trim()
  if (siteName) return siteName
  return (externalLinkHostname(source.url) ?? source.url).replace(/^www\./, '')
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
  const hostname = externalLinkHostname(source.url)
  /** Slack's connector prefixes channel titles with `#channel: `; direct messages omit `#`. */
  const slackChannel =
    source.connectorType === 'slack' ? source.title?.match(/^(#[^:\s]+): /)?.[1] : undefined
  const ConnectorIcon = source.connectorType
    ? BRAND_ICON_BY_BASE_TYPE.get(source.connectorType)
    : undefined

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          onClick={(event) => handleExternalLinkClick(event, source.url)}
          className={cn(
            'not-prose inline-flex h-[20px] max-w-[220px] shrink-0 items-center gap-1 rounded-full px-1.5 align-middle text-[var(--text-body)] text-caption no-underline transition-colors',
            chipFilledFillTokens,
            chipHoverSurfaceClass
          )}
        >
          {ConnectorIcon ? (
            <BrandIcon icon={ConnectorIcon} className='size-[12px] shrink-0' />
          ) : hostname ? (
            <img
              src={faviconUrl(hostname, 32)}
              alt=''
              className='size-[12px] shrink-0 rounded-[3px]'
              onError={hideBrokenFavicon}
            />
          ) : null}
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
