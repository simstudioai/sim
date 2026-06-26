import type { ReactNode } from 'react'
import Link from 'next/link'
import { PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'

/**
 * The one inline link used inside legal prose — a single source of truth for
 * link chrome (`PROSE_TYPE.link`) so every mailto/internal/external link in the
 * configs reads identically. Configs pass only `href` + children; never a
 * className.
 *
 * Routing/safety is derived from the href: an absolute `http(s)://` URL renders
 * as a hardened external anchor (`target='_blank' rel='noopener noreferrer'`), a
 * `mailto:` href as a plain anchor, and anything else as a crawlable Next
 * `<Link>`. Server Component.
 */

interface ProseLinkProps {
  /** Destination — `http(s)://`, `mailto:`, or an internal path. */
  href: string
  children: ReactNode
}

function isHttp(href: string): boolean {
  return /^https?:\/\//.test(href)
}

export function ProseLink({ href, children }: ProseLinkProps) {
  if (isHttp(href)) {
    return (
      <a href={href} target='_blank' rel='noopener noreferrer' className={PROSE_TYPE.link}>
        {children}
      </a>
    )
  }

  if (href.startsWith('mailto:')) {
    return (
      <a href={href} className={PROSE_TYPE.link}>
        {children}
      </a>
    )
  }

  return (
    <Link href={href} className={PROSE_TYPE.link}>
      {children}
    </Link>
  )
}
