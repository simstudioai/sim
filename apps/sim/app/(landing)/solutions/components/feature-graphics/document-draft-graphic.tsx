import { ChipTag, cn } from '@sim/emcn'
import { CircleCheck, File } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/solutions/components/feature-graphics/document-draft-graphic.module.css'

/**
 * Per-line draft-bar widths, varied so the greeked page reads as prose —
 * a short opening line, two full paragraph lines, then a second
 * paragraph that trails off mid-line.
 */
const DRAFT_BAR_WIDTHS = ['w-[62%]', 'w-full', 'w-[86%]', 'w-[94%]', 'w-[54%]'] as const

/** Per-index draw classes — the stagger order is baked into each class's delay. */
const DRAFT_BAR_CLASSES = [styles.bar0, styles.bar1, styles.bar2, styles.bar3, styles.bar4] as const

/**
 * A document being drafted by a Sim agent, told inside the lifecycle
 * tile's outlined window chrome: the window is a 1px `--border-1`
 * hairline outline with no fill (tile grey showing through), anchored to
 * the text column's left edge (`left-0`, `top-5`) and bleeding off the
 * right and bottom edges with a `rounded-tl-xl` top-left corner — the
 * same slot geometry as the build, lifecycle, and rollback windows. The
 * title bar pairs the document name (led by a `File` icon in the
 * lifecycle header's outlined `size-6` icon box) with a right-aligned
 * mono status tag on the grey-ground `--surface-6` pill fill, at the
 * family's `h-12` header height.
 *
 * Inside, the draft is greeked: quiet `--surface-6` prose bars of varied
 * measure draw in left-to-right one after another (from
 * `document-draft-graphic.module.css` — a one-shot stagger like the
 * audit tile's stamp-in, since the draft is written once, not re-typed),
 * and the closing delivery row is the tile's highlight — a white card in
 * the audit tile's exact chrome (`--white` fill, 1px `--border-1`
 * hairline, `rounded-xl`, `shadow-sm`) pairing a passing circle-check
 * and the delivery claim with a right-aligned timestamp. The header's
 * status tag carries the family's shared quiet 6s ring pulse. Both
 * motions are removed under `prefers-reduced-motion`.
 *
 * The window bleeds `2rem` past the tile's visible right edge (`1.5rem`
 * under `max-lg`), so the header and body carry matching extra right
 * padding (`pr-12 max-lg:pr-10`) to keep the status tag and the white
 * card fully inside the visible tile — the rollback window's
 * compensation.
 */
interface DocumentDraftGraphicProps {
  /** Document name in the title bar. */
  title?: string
  /** Mono status tag on the title bar's right side. */
  statusTag?: string
  /** Delivery claim on the closing white card. */
  footerLabel?: string
  /** Right-aligned timestamp on the closing white card. */
  footerDetail?: string
}

export function DocumentDraftGraphic({
  title = 'Draft',
  statusTag = 'Auto-drafted',
  footerLabel = 'Ready for review',
  footerDetail = 'Just now',
}: DocumentDraftGraphicProps = {}) {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute top-5 right-0 bottom-0 left-0 rounded-tl-xl border-[var(--border-1)] border-t border-l'
      >
        <div className='flex h-12 items-center gap-2 border-[var(--border-1)] border-b px-4 pr-12 max-lg:pr-10'>
          <span className='flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-1)]'>
            <File className='size-[14px] text-[var(--text-icon)]' />
          </span>
          <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-primary)] text-base'>
            {title}
          </span>
          <ChipTag
            variant='mono'
            className={cn('shrink-0 bg-[var(--surface-6)]', styles.statusPulse)}
          >
            {statusTag}
          </ChipTag>
        </div>

        <div className='flex flex-col gap-3 p-4 pr-12 max-lg:pr-10'>
          {DRAFT_BAR_WIDTHS.map((width, index) => (
            <span
              key={width}
              className={cn(
                'h-2 origin-left rounded-full bg-[var(--surface-6)]',
                width,
                DRAFT_BAR_CLASSES[index]
              )}
            />
          ))}

          <div className='mt-2 flex items-center gap-2 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm'>
            <CircleCheck className='size-[13px] shrink-0 text-[var(--text-icon)]' />
            <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-primary)] text-small'>
              {footerLabel}
            </span>
            <span className='shrink-0 text-[var(--text-muted)] text-caption'>{footerDetail}</span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
