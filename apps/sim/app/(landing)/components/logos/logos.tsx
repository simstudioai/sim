import Image from 'next/image'
import { cn } from '@/lib/core/utils/cn'

/**
 * Shared customer-logo block — the single source of truth for the wordmarks
 * shown both in the landing hero (a packed grid on the left half) and on every
 * platform page (a single centered row). Neither consumer redefines the data or
 * the chrome; they only pass a `layout` intent. This keeps the logo set, the
 * optical sizing, and the `gap-x-24` horizontal rhythm identical everywhere.
 *
 * Optical sizing, not box-fitting. These wordmarks differ enormously in aspect
 * ratio (Volvo ≈ 7:1, Rivian|VW ≈ 11:1, eXp ≈ 2:1) and in how much of their own
 * viewBox the ink fills, so a single fixed slot makes them read at wildly
 * different sizes. Each logo carries its own optically-tuned {@link Logo.height}
 * — the single knob for balancing them by eye — and renders at its intrinsic
 * {@link Logo.aspect} (width = height × aspect, rounded). Width following the
 * aspect ratio means no distortion; explicit dimensions mean zero CLS.
 */

/** Horizontal gap between logos — the canonical 96px rhythm shared by both layouts. */
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

/** The canonical six customer wordmarks, in row-major reading order. */
const LOGOS: readonly Logo[] = [
  { name: 'Volvo', src: '/landing/logos/volvo.svg', aspect: 7.27, height: 14 },
  { name: 'eXp Realty', src: '/landing/logos/exp-realty.svg', aspect: 1.84, height: 28 },
  {
    name: 'Rivian | Volkswagen Group Technologies',
    src: '/landing/logos/rivian-vw.svg',
    aspect: 10.72,
    height: 15,
  },
  { name: 'Artie', src: '/landing/logos/artie.svg', aspect: 3.65, height: 24 },
  {
    name: 'Russell Investments',
    src: '/landing/logos/russell-investments.svg',
    aspect: 4.29,
    height: 21,
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
   * - `grid` — the hero's packed 3×2 block (`max-content` columns, `gap-y-12`),
   *   flush-left against the canvas.
   * - `row` — the platform page's single centered row.
   */
  layout: 'grid' | 'row'
}

/**
 * Renders the shared customer logos. The two layouts diverge only in the list's
 * own flex/grid container — every individual logo (size, grayscale tone, gap) is
 * identical across consumers, so the two read as one logo system.
 */
export function Logos({ layout }: LogosProps) {
  return (
    <ul
      aria-label='Companies building AI agents with Sim'
      className={cn(
        'items-center',
        LOGO_GAP_X,
        layout === 'grid'
          ? 'grid grid-cols-[repeat(3,max-content)] gap-y-12'
          : 'flex flex-wrap justify-center gap-y-12'
      )}
    >
      {LOGOS.map((logo) => (
        <li key={logo.name}>
          <Image
            src={logo.src}
            alt={logo.name}
            height={logo.height}
            width={Math.round(logo.height * logo.aspect)}
            className='grayscale'
          />
        </li>
      ))}
    </ul>
  )
}
