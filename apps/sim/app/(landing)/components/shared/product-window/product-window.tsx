import { cn } from '@sim/emcn'
import {
  LANDING_STAGE_WINDOW_RADIUS,
  LANDING_WINDOW_SHADOW,
} from '@/app/(landing)/components/landing-layout'
import {
  ProductPreview,
  type ProductPreviewKind,
} from '@/app/(landing)/components/shared/product-preview'

interface ProductWindowProps {
  /** Which Sim product's live loop fills the window. */
  kind: ProductPreviewKind
  /**
   * Placement inside the host frame - `top-*` / `left-*` insets and a width,
   * typically wider than the frame so the window bleeds off its right and
   * bottom edges. Never chrome.
   */
  className?: string
}

/**
 * The homepage's elevated product window: the hero window's exact chrome
 * (8px radius, `--surface-1` fill, the hairline-ring + layered soft shadow)
 * locked to the live loops' 1280x735 design aspect, holding one product's
 * {@link ProductPreview}.
 *
 * It is always placed INSIDE a grayscale placement frame, offset from the
 * frame's top-left corner and oversized so its right and bottom edges run
 * past the frame's clip - the enterprise sites this page is modeled on
 * present product UI as a zoomed-in peek at part of the product, not as a
 * complete miniature. The aspect lock means the loop's responsive stage
 * always fills the window edge to edge at one uniform scale.
 *
 * Decorative: the window is inert and `aria-hidden` so the copy beside it
 * stays the only accessible content and preview controls cannot take focus.
 */
export function ProductWindow({ kind, className }: ProductWindowProps) {
  return (
    <div
      aria-hidden='true'
      inert
      className={cn(
        'absolute aspect-[1280/735] overflow-hidden bg-[var(--surface-1)]',
        LANDING_STAGE_WINDOW_RADIUS,
        LANDING_WINDOW_SHADOW,
        className
      )}
    >
      <ProductPreview kind={kind} />
    </div>
  )
}
