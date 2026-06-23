import Image from 'next/image'

/**
 * Hero customer-logo grid — a bare 3×2 block of logos on the hero's left side.
 * Server Component (no interactivity).
 *
 * No cards or chrome: each logo sits directly on the canvas, desaturated to one
 * tone (`grayscale`). The three columns are `max-content` (each only as wide as
 * its logos), so the block packs flush against the hero's left padding rather
 * than spreading across the half — no centering whitespace. Columns are spaced
 * `gap-x-24` (96px); rows `gap-y-12` (48px).
 *
 * Optical sizing, not box-fitting. These wordmarks differ enormously in aspect
 * ratio (Volvo ≈ 7:1, Rivian|VW ≈ 11:1, eXp ≈ 2:1) and in how much of their
 * own viewBox the ink fills, so a single fixed slot makes them read at wildly
 * different sizes. Instead each logo carries its own {@link Logo.height} — the
 * single knob for balancing them by eye — and renders at its intrinsic
 * {@link Logo.aspect} (width = height × aspect, rounded). Width following the
 * aspect ratio means no distortion; explicit dimensions mean zero CLS.
 *
 * Reading order is row-major: Volvo / eXp / Rivian|VW on top, Artie / Russell
 * Investments / Mobile Health beneath.
 */

interface Logo {
  name: string
  src: string
  /** Intrinsic aspect ratio (width ÷ height from the SVG viewBox) — keeps scaling distortion-free. */
  aspect: number
  /** Optically-tuned display height in px — the single knob for balancing logos by eye. */
  height: number
}

const LOGOS: Logo[] = [
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
]

export function HeroLogos() {
  return (
    <ul
      aria-label='Companies building AI agents with Sim'
      className='grid grid-cols-[repeat(3,max-content)] items-center gap-x-24 gap-y-12 max-sm:gap-x-10 max-sm:gap-y-8 max-lg:gap-x-16'
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
