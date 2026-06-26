import type { ReactNode } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { PROSE_SPACING } from '@/app/(landing)/components/prose-page/constants'

/**
 * The prose page frame — owns the `<main id='main-content'>` landmark, the one
 * horizontal gutter (matching the navbar and footer so content aligns with the
 * wordmark), the outer content cap, the navbar-clearing top padding, and the
 * vertical rhythm of the full-width left-aligned content column.
 *
 * Every prose page (Terms, Privacy, Changelog) renders inside this shell, so the
 * page frame is described once and can never drift. Consumers pass only the
 * content nodes; all spacing comes from `PROSE_SPACING`. Server Component.
 */

interface ProseShellProps {
  /** The content column — a {@link ProseHero} followed by sections. */
  children: ReactNode
}

export function ProseShell({ children }: ProseShellProps) {
  return (
    <main
      id='main-content'
      className={cn(PROSE_SPACING.outerCap, PROSE_SPACING.gutter, PROSE_SPACING.heroTopPadding)}
    >
      <div className={cn('flex flex-col', PROSE_SPACING.bodyRhythm)}>{children}</div>
    </main>
  )
}
