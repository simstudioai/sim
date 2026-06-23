import Image from 'next/image'
import { cn } from '@/lib/core/utils/cn'

/**
 * Shared customer-logo block — the single source of truth for the wordmarks
 * shown both in the landing hero (a grid of bordered logo cards on the left half)
 * and on every platform page (a single centered row of bare wordmarks). Neither
 * consumer redefines the data or the per-logo optical sizing; they only pass a
 * `layout` intent, so the logo set reads as one system everywhere.
 *
 * Optical sizing, not box-fitting. These wordmarks differ enormously in aspect
 * ratio (Rivian|VW ≈ 11:1, eXp ≈ 2:1, Mobile Health ≈ 8:1) and in how much of their own
 * viewBox the ink fills, so a single fixed slot makes them read at wildly
 * different sizes. Each logo carries its own optically-tuned {@link Logo.height}
 * — the single knob for balancing them by eye — and renders at its intrinsic
 * {@link Logo.aspect} (width = height × aspect, rounded). Width following the
 * aspect ratio means no distortion; explicit dimensions mean zero CLS.
 */

/** Horizontal gap between bare wordmarks in the `row` layout — the canonical 96px rhythm. */
const LOGO_GAP_X = 'gap-x-24'

/** A single customer wordmark with the dimensions that keep it optically balanced. */
interface Logo {
  /** Accessible company name, used as the image `alt`. */
  name: string
  /** Path to the SVG wordmark under `/public`. */
  src: string
  /** Intrinsic aspect ratio (width ÷ height from the SVG viewBox) — keeps scaling distortion-free. */
  aspect: number
  /** Optically-tuned display height in px — the single knob for balancing logos by eye. */
  height: number
}

/**
 * The canonical six customer wordmarks, in row-major reading order — the 3×2
 * hero grid places them as: Rivian|VW (top-left), eXp Realty (top-center),
 * Russell (top-right); Artie (bottom-left), thinkproject (bottom-center),
 * Mobile Health (bottom-right).
 */
const LOGOS: readonly Logo[] = [
  {
    name: 'Rivian | Volkswagen Group Technologies',
    src: '/landing/logos/rivian-vw.svg',
    aspect: 10.72,
    height: 17,
  },
  { name: 'eXp Realty', src: '/landing/logos/exp-realty.svg', aspect: 1.84, height: 28 },
  {
    name: 'Russell Investments',
    src: '/landing/logos/russell-investments.svg',
    aspect: 4.29,
    height: 21,
  },
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

interface LogosProps {
  /**
   * Layout intent.
   * - `grid` — the hero's logo wall: each wordmark sits in its own bordered
   *   `--surface-1` card (the platform card chrome — `rounded-lg`, `--border-1`,
   *   `h-20`) on a responsive 3-up grid (2-up on phones) at a `gap-3` rhythm.
   * - `row` — the platform page's single centered row of bare wordmarks.
   */
  layout: 'grid' | 'row'
}

/**
 * Renders the shared customer logos. In the `grid` layout each wordmark is boxed
 * in a bordered `--surface-1` card (the platform card chrome) on a 3-up grid; in
 * the `row` layout the bare wordmarks wrap in a centered row. Every logo keeps
 * its optical {@link Logo.height}, scaling down to fit its card when it would
 * otherwise overflow (`max-w-full h-auto`), so wide marks never break the box.
 */
export function Logos({ layout }: LogosProps) {
  const isGrid = layout === 'grid'
  return (
    <ul
      aria-label='Companies building AI agents with Sim'
      className={cn(
        isGrid
          ? 'grid grid-cols-3 gap-3 max-sm:grid-cols-2'
          : cn('flex flex-wrap items-center justify-center gap-y-12', LOGO_GAP_X)
      )}
    >
      {LOGOS.map((logo) => (
        <li
          key={logo.name}
          className={cn(
            isGrid &&
              'flex h-20 items-center justify-center rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] px-4'
          )}
        >
          <Image
            src={logo.src}
            alt={logo.name}
            height={logo.height}
            width={Math.round(logo.height * logo.aspect)}
            className={cn('grayscale', isGrid && 'h-auto max-w-full object-contain')}
          />
        </li>
      ))}
    </ul>
  )
}
