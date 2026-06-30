import { cn } from '@/lib/core/utils/cn'
import { PROSE_SPACING, PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'
import type { LegalBlock } from '@/app/(landing)/components/prose-page/types'

/**
 * Renders a single {@link LegalBlock} into its canonical chrome. The block's
 * `kind` discriminant selects the element (paragraph / subheading `<h3>` /
 * bulleted list / callout box); all sizing and color come from `PROSE_TYPE`, so
 * Terms and Privacy share one visual treatment for every block type. Content
 * only - no layout knob. Server Component.
 */

interface LegalBlockViewProps {
  block: LegalBlock
}

export function LegalBlockView({ block }: LegalBlockViewProps) {
  switch (block.kind) {
    case 'paragraph':
      return <p className={PROSE_TYPE.body}>{block.content}</p>
    case 'subheading':
      return <h3 className={PROSE_TYPE.h3}>{block.text}</h3>
    case 'list':
      return (
        <ul className={cn('list-disc', PROSE_SPACING.listIndent, PROSE_SPACING.listStack)}>
          {block.items.map((item, index) => (
            <li key={index} className={PROSE_TYPE.list}>
              {item}
            </li>
          ))}
        </ul>
      )
    case 'callout':
      return <div className={PROSE_TYPE.callout}>{block.content}</div>
    default:
      return null
  }
}
