'use client'

import { createContext, useContext } from 'react'
import { Tooltip } from '@sim/emcn'
import type { LinkPreview } from '@/lib/api/contracts/link-preview'
import { openInBrowserPanel, shouldOpenInBrowserPanel } from '@/lib/browser-agent/open-in-panel'
import { faviconUrl } from '@/lib/core/utils/favicon'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useLinkPreview } from '@/hooks/queries/link-preview'

/** Hides a favicon img that failed to load so the link degrades to plain text. */
export function hideBrokenFavicon(e: React.SyntheticEvent<HTMLImageElement>): void {
  e.currentTarget.style.display = 'none'
}

/**
 * Hostname for an external http(s) link, used to fetch its favicon. Returns
 * null for relative, anchor, mailto, and unparsable hrefs so those keep the
 * plain text treatment.
 */
export function externalLinkHostname(href?: string): string | null {
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    return new URL(href).hostname
  } catch {
    return null
  }
}

/** The site a link belongs to: its known site name, else its hostname without `www.`. */
export function linkSiteName(url: string, siteName?: string | null): string {
  return siteName?.trim() || (externalLinkHostname(url) ?? url).replace(/^www\./, '')
}

/**
 * A prose link: no fill, a thin muted underline only on hover, and an outline
 * for keyboard focus.
 */
export const PROSE_LINK_CLASS =
  'not-prose text-[var(--text-primary)] no-underline decoration-1 decoration-[var(--text-muted)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)]'

/**
 * The turn's retrieved sources by URL. A link the model writes to a document it
 * retrieved takes that document's title, which private pages (Gmail, Slack,
 * Drive) never expose through a link preview.
 */
export const LinkSourcesContext = createContext<ReadonlyMap<string, SourceTagData>>(new Map())

export interface ExternalLinkTooltip {
  title: string
  /** The site, shown muted beneath the title when it adds information. */
  siteName?: string
  /** A description, only ever from the link preview. */
  description?: string
}

/**
 * What a link's tooltip says, never the raw URL: the cited source's title for
 * this exact URL, else the link preview's title, else the site name.
 */
export function getExternalLinkTooltip(
  href: string,
  source: SourceTagData | undefined,
  preview: LinkPreview | undefined
): ExternalLinkTooltip {
  const siteName = linkSiteName(href, source?.siteName ?? preview?.siteName)
  const title = source?.title?.trim() || preview?.title?.trim() || siteName
  return {
    title,
    ...(title !== siteName ? { siteName } : {}),
    ...(preview?.description?.trim() ? { description: preview.description.trim() } : {}),
  }
}

interface ExternalLinkProps {
  href: string
  hostname: string
  children?: React.ReactNode
}

/**
 * In the desktop app, a plain click diverts into the embedded Sim browser
 * panel; modified clicks (Cmd/Ctrl/Shift/middle) keep the default behavior,
 * which the shell routes to the system browser. In a web browser this is a
 * no-op and the link opens a new tab as usual.
 */
export function handleExternalLinkClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string
): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  if (!shouldOpenInBrowserPanel(href)) return
  event.preventDefault()
  openInBrowserPanel(href)
}

/**
 * Favicon + understated external link with a titled tooltip. The favicon is
 * `align-middle`, like citation chips, so it tracks any font size without an
 * offset while the link text still wraps. The preview query fires on render, so
 * metadata is normally cached before the first hover. Previews are https-only:
 * fetching a plain-http link server-side would reach the URL validator's
 * self-host loopback exception.
 */
export function ExternalLink({ href, hostname, children }: ExternalLinkProps) {
  const source = useContext(LinkSourcesContext).get(href)
  const { data } = useLinkPreview(href.startsWith('https://') ? href : undefined)
  const tooltip = getExternalLinkTooltip(href, source, data?.preview ?? undefined)

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <a
          href={href}
          className={PROSE_LINK_CLASS}
          target='_blank'
          rel='noopener noreferrer'
          onClick={(event) => handleExternalLinkClick(event, href)}
        >
          <img
            src={faviconUrl(hostname, 32)}
            alt=''
            className='mr-0.5 inline-block size-[12px] rounded-[3px] align-middle'
            onError={hideBrokenFavicon}
          />
          {children}
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className='flex flex-col gap-0.5'>
          <span>{tooltip.title}</span>
          {tooltip.description && (
            <span className='line-clamp-2 text-[var(--text-muted)]'>{tooltip.description}</span>
          )}
          {tooltip.siteName && <span className='text-[var(--text-muted)]'>{tooltip.siteName}</span>}
        </span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
