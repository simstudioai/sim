import { cn } from '@sim/emcn'
import Image from 'next/image'

/**
 * Shared customer-logo block - the single source of truth for the wordmarks
 * shown both in the landing hero (a grid of bordered logo cards on the left half)
 * and on every platform page (a single centered row of bare wordmarks). Neither
 * consumer redefines the data or the per-logo optical sizing; they only pass a
 * `layout` intent, so the logo set reads as one system everywhere.
 *
 * Optical sizing, not box-fitting. These wordmarks differ enormously in aspect
 * ratio (Rivian|VW ≈ 11:1, eXp ≈ 2:1, Mobile Health ≈ 8:1) and in how much of their own
 * viewBox the ink fills, so a single fixed slot makes them read at wildly
 * different sizes. Each logo carries its own optically-tuned {@link Logo.height}
 * - the single knob for balancing them by eye - and renders at its intrinsic
 * {@link Logo.aspect} (width = height × aspect, rounded). Width following the
 * aspect ratio means no distortion; explicit dimensions mean zero CLS.
 */

/** In the hero card grid the wordmarks render smaller than their optical row size. */
const GRID_ICON_SCALE = 0.85

/** Homepage proof row - slightly larger so customer marks carry more visual authority. */
const PROOF_ICON_SCALE = 1.6

/**
 * Muted proof marks: flatten to a single ink, then drop opacity so they read
 * as light-to-medium gray against `--bg` without hex recoloring. On the dark
 * ground the flattened ink inverts to white first, so the same opacity reads
 * as medium gray there too. Grid cards and other row consumers stay
 * full-contrast.
 */
export const MUTED_MARK = 'brightness-0 opacity-40 dark:invert'

/**
 * Full-contrast marks keep their own ink on the light ground; on the dark
 * ground that ink would vanish into the surface, so they flatten to white.
 */
const FULL_MARK = 'dark:brightness-0 dark:invert'

/** A single customer wordmark with the dimensions that keep it optically balanced. */
export interface Logo {
  /** Accessible company name, used as the image `alt`. */
  name: string
  /** Path to the SVG wordmark under `/public`. */
  src: string
  /** Intrinsic aspect ratio (width ÷ height from the SVG viewBox) - keeps scaling distortion-free. */
  aspect: number
  /** Optically-tuned display height in px - the single knob for balancing logos by eye. */
  height: number
}

/**
 * The canonical five customer wordmarks, in reading order - the card grid places
 * them 3-up (Rivian|VW, eXp Realty, Artie) with the remaining two
 * (thinkproject, Mobile Health) centered beneath.
 */
export const LOGOS: readonly Logo[] = [
  {
    name: 'Rivian | Volkswagen Group Technologies',
    src: '/landing/logos/rivian-vw.svg',
    aspect: 10.72,
    height: 17,
  },
  { name: 'eXp Realty', src: '/landing/logos/exp-realty.svg', aspect: 1.84, height: 28 },
  { name: 'Artie', src: '/landing/logos/artie.svg', aspect: 3.65, height: 24 },
  {
    name: 'thinkproject',
    src: '/landing/logos/thinkproject.svg',
    aspect: 6.01,
    height: 18,
  },
  {
    name: 'Mobile Health Consumer',
    src: '/landing/logos/mobile-health.svg',
    aspect: 7.92,
    height: 16,
  },
] as const

type LogosSize = 'default' | 'display' | 'proof'
type LogosTone = 'default' | 'muted'

interface LogosProps {
  /**
   * Layout intent.
   * - `grid` - the logo wall: each wordmark sits in its own bordered
   *   `--surface-1` card (the platform card chrome - `rounded-lg`, `--border-1`,
   *   `h-24`) wrapping 3-up on a `gap-3` row. Because the set is an odd five, the
   *   wall is a centered flex wrap rather than a grid, so the trailing row of two
   *   sits centered under the row of three instead of leaving a hole. On desktop
   *   (`xl+`) the wall is pinned to `w-[564px]` - exactly three `w-[180px]` cards
   *   plus their two 12px `gap-3` gutters - so it always breaks after the third
   *   card; below `xl` (where the hero/demo split collapses to a stacked
   *   column) it stretches full-width and the cards take an even share of the row,
   *   dropping to 2-up on phones (`max-sm`) so the wall never wraps early.
   *   Wordmarks render at {@link GRID_ICON_SCALE} of their optical row size.
   * - `row` - the platform page's single centered row of bare wordmarks.
   */
  layout: 'grid' | 'row'
  /**
   * Optical scale for the `row` layout. `display` is a large proof wall.
   * The proof size is slightly larger than the default row, with a wider
   * distribution so five marks read as established customer proof.
   */
  size?: LogosSize
  /**
   * Color treatment for `row` layouts. `muted` lightens wordmarks toward a
   * Harvey-style gray; `grid` ignores this so platform cards stay full-contrast.
   */
  tone?: LogosTone
}

function rowHeight(size: LogosSize, opticalHeight: number): number {
  if (size === 'display') {
    return Math.round(opticalHeight * 1.75)
  }
  if (size === 'proof') {
    return Math.round(opticalHeight * PROOF_ICON_SCALE)
  }
  return opticalHeight
}

function rowClassName(size: LogosSize): string {
  if (size === 'display') {
    return 'flex flex-wrap items-center justify-center gap-x-16 gap-y-10 max-sm:gap-x-10'
  }
  if (size === 'proof') {
    return 'flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-10 max-sm:gap-x-8 max-sm:gap-y-8 max-xl:justify-center max-xl:gap-x-12'
  }
  return 'flex flex-wrap items-center justify-center gap-x-24 gap-y-12'
}

/**
 * Renders the shared customer logos. In the `grid` layout each wordmark is boxed
 * in a bordered `--surface-1` card (the platform card chrome) on a centered 3-up
 * wrap and renders at {@link GRID_ICON_SCALE} of its optical size; in the `row`
 * layout the bare wordmarks wrap at full optical size in a centered row. Either
 * way a logo scales down to fit when it would otherwise overflow
 * (`max-w-full h-auto`), so wide marks never break the box.
 */
export function Logos({ layout, size = 'default', tone = 'default' }: LogosProps) {
  const isGrid = layout === 'grid'
  const isMuted = !isGrid && tone === 'muted'
  const isProof = !isGrid && size === 'proof'
  return (
    <ul
      aria-label='Companies building and governing AI agents with Sim'
      className={
        isGrid ? 'flex w-[564px] flex-wrap justify-center gap-3 max-xl:w-full' : rowClassName(size)
      }
    >
      {LOGOS.map((logo) => {
        const height = isGrid
          ? Math.round(logo.height * GRID_ICON_SCALE)
          : rowHeight(size, logo.height)
        return (
          <li
            key={logo.name}
            className={
              isGrid
                ? 'flex h-24 w-[180px] items-center justify-center rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] px-3 max-sm:w-[calc(50%-0.375rem)] max-xl:w-[calc(33.333%-0.5rem)]'
                : isProof
                  ? 'max-sm:flex max-sm:basis-[calc(50%-1rem)] max-sm:items-center max-sm:justify-center max-sm:first:basis-full'
                  : undefined
            }
          >
            <Image
              src={logo.src}
              alt={logo.name}
              height={height}
              width={Math.round(height * logo.aspect)}
              className={cn(
                (isGrid || isProof) && 'h-auto max-w-full object-contain',
                isMuted ? MUTED_MARK : FULL_MARK
              )}
            />
          </li>
        )
      })}
    </ul>
  )
}
