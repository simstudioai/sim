import { cn } from '@/lib/core/utils/cn'
import { LegalBlockView } from '@/app/(landing)/components/prose-page/components/legal-block-group/components'
import { PROSE_SPACING } from '@/app/(landing)/components/prose-page/constants'
import type { LegalBlock } from '@/app/(landing)/components/prose-page/types'

/**
 * Renders an ordered run of {@link LegalBlock}s as a vertically-stacked group at
 * the shared block rhythm (`PROSE_SPACING.blockStack`). This is the single source
 * of the block-group markup — consumed both by the page intro ({@link ProsePage})
 * and by every {@link LegalSectionView} — so the intro and the sections can never
 * drift in spacing. Server Component.
 */

interface LegalBlockGroupProps {
  blocks: LegalBlock[]
}

export function LegalBlockGroup({ blocks }: LegalBlockGroupProps) {
  return (
    <div className={cn('flex flex-col', PROSE_SPACING.blockStack)}>
      {blocks.map((block, index) => (
        <LegalBlockView key={index} block={block} />
      ))}
    </div>
  )
}
