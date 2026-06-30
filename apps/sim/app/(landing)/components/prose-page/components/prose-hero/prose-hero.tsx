import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { PROSE_SPACING, PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'

/**
 * The shared prose hero - the only `<h1>` on a prose page. Renders the title,
 * an optional meta line (e.g. "Last updated: …"), an optional lead paragraph,
 * and an optional actions slot (e.g. the changelog's GitHub / Docs / RSS chips).
 *
 * Reused by Terms, Privacy, and the Changelog so the headline rhythm is
 * identical across all three. Spacing comes from `PROSE_SPACING.heroStack`; the
 * navbar-clearing top padding is owned by {@link ProseShell}. Server Component -
 * any interactive `actions` are passed as an already-rendered client island.
 */

interface ProseHeroProps {
  /** The page's single `<h1>` text. */
  title: string
  /** Optional muted meta line beneath the title (e.g. a "Last updated" date). */
  meta?: string
  /** Optional lead paragraph in the body color. */
  lead?: string
  /** Optional actions row (a client island of links/chips). */
  actions?: ReactNode
}

export function ProseHero({ title, meta, lead, actions }: ProseHeroProps) {
  return (
    <div className={cn('flex flex-col', PROSE_SPACING.heroStack)}>
      <h1 className={PROSE_TYPE.h1}>{title}</h1>
      {meta ? <p className={PROSE_TYPE.meta}>{meta}</p> : null}
      {lead ? <p className={PROSE_TYPE.lead}>{lead}</p> : null}
      {actions}
    </div>
  )
}
