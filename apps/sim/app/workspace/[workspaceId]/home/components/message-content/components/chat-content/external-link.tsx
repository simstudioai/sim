'use client'

import { Tooltip } from '@sim/emcn'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { useLinkPreview } from '@/hooks/queries/link-preview'

/** Hides a favicon img that failed to load so the link degrades to plain text. */
function hideBrokenFavicon(e: React.SyntheticEvent<HTMLImageElement>): void {
  e.currentTarget.style.display = 'none'
}

/**
 * Hostname for an external http(s) link, used to fetch its favicon. Returns
 * null for relative, anchor, mailto, and unparsable hrefs so those keep the
 * plain underlined treatment.
 */
export function externalLinkHostname(href?: string): string | null {
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    return new URL(href).hostname
  } catch {
    return null
  }
}

interface ExternalLinkProps {
  href: string
  hostname: string
  children?: React.ReactNode
}

/**
 * Favicon + quiet-underline external link with an OG-preview tooltip. The
 * preview query fires when the link renders, so metadata is normally cached
 * (client and server side) before the first hover; the tooltip shows the
 * destination URL until metadata arrives or when the site has none.
 */
export function ExternalLink({ href, hostname, children }: ExternalLinkProps) {
  const { data } = useLinkPreview(href)
  const preview = data?.preview

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <a
          href={href}
          className='not-prose group text-[var(--text-primary)] no-underline'
          target='_blank'
          rel='noopener noreferrer'
        >
          <img
            src={faviconUrl(hostname, 32)}
            alt=''
            className='relative top-[0.5px] mr-[2px] inline size-[12px] rounded-[3px]'
            onError={hideBrokenFavicon}
          />
          <span className='underline decoration-[color:var(--text-muted)] underline-offset-4 transition-colors group-hover:decoration-[color:var(--text-primary)]'>
            {children}
          </span>
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {preview ? (
          <span className='flex flex-col gap-0.5'>
            {preview.title && <span className='font-medium'>{preview.title}</span>}
            {preview.description && (
              <span className='line-clamp-2 text-[var(--text-muted)]'>{preview.description}</span>
            )}
            <span className='text-[var(--text-muted)]'>{preview.siteName ?? hostname}</span>
          </span>
        ) : (
          <span className='break-all'>{href}</span>
        )}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
