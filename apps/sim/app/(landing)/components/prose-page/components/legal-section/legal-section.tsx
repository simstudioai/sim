import { cn } from '@/lib/core/utils/cn'
import { LegalBlockGroup } from '@/app/(landing)/components/prose-page/components/legal-block-group'
import { PROSE_SPACING, PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'
import type { LegalSection } from '@/app/(landing)/components/prose-page/types'

/**
 * Renders one {@link LegalSection} as a `<section>` landmark: an `<h2>` wired to
 * `aria-labelledby` followed by the section's ordered blocks. Spacing is owned
 * by `PROSE_SPACING` (heading → blocks, and block → block), so every section in
 * Terms and Privacy keeps the same rhythm. Server Component.
 */

interface LegalSectionViewProps {
  section: LegalSection
}

export function LegalSectionView({ section }: LegalSectionViewProps) {
  const headingId = `${section.id}-heading`

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={cn('flex flex-col', PROSE_SPACING.sectionStack)}
    >
      <h2 id={headingId} className={PROSE_TYPE.h2}>
        {section.heading}
      </h2>
      <LegalBlockGroup blocks={section.blocks} />
    </section>
  )
}
