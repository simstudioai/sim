import { useId } from 'react'
import { cn } from '@sim/emcn'
import { type GlyphShape, generateGlyph } from '@/lib/workspaces/glyph'

interface IdentityTileBaseProps {
  logoUrl?: string | null
  /** Accessible name for an uploaded mark; empty when the name is already beside it. */
  alt?: string
  /** Layout-only extras (visibility, positioning). Never chrome. */
  className?: string
  /** `data-slot` hook for tests and styling. */
  slot?: string
  /** `sm` is the 16px rail mark; `lg` is the 36px tile a row or card leads with. */
  size?: 'sm' | 'lg'
}

type IdentityTileProps = IdentityTileBaseProps &
  (
    | {
        /** Letter shown when there is no uploaded mark. */
        initial: string
        glyphSeed?: never
      }
    | {
        /** Seed (a workspace id) for the generated glyph shown when there is no uploaded mark. */
        glyphSeed: string
        initial?: never
      }
  )

const SIZE_CLASS = {
  sm: 'size-[16px] rounded-sm text-micro',
  lg: 'size-9 rounded-lg text-base',
} as const

const GLYPH_SIZE_CLASS = {
  sm: 'size-[16px]',
  lg: 'size-9',
} as const

/** The loader's goo: blur, then crush alpha so parts within the blur radius melt together. */
const GOO_ALPHA_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9'

function glyphShape(shape: GlyphShape, key: number) {
  switch (shape.kind) {
    case 'circle':
      return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} />
    case 'ring':
      return (
        <circle
          key={key}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill='none'
          strokeWidth={shape.w}
        />
      )
    case 'capsule': {
      const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1)
      const deg = (Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1) * 180) / Math.PI
      return (
        <rect
          key={key}
          x={shape.x1 - shape.w / 2}
          y={shape.y1 - shape.w / 2}
          width={length + shape.w}
          height={shape.w}
          rx={shape.w / 2}
          transform={`rotate(${deg} ${shape.x1} ${shape.y1})`}
        />
      )
    }
    case 'poly':
      return <polygon key={key} points={shape.points.map((p) => p.join(',')).join(' ')} />
  }
}

interface GlyphProps {
  seed: string
  className?: string
  slot?: string
  size: 'sm' | 'lg'
}

function Glyph({ seed, className, slot, size }: GlyphProps) {
  const filterId = `identity-glyph-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  return (
    <svg
      data-slot={slot}
      aria-hidden='true'
      viewBox='0 0 100 100'
      className={cn(
        'shrink-0 text-[var(--text-icon)] dark:text-[var(--text-secondary)]',
        GLYPH_SIZE_CLASS[size],
        className
      )}
    >
      <filter
        id={filterId}
        x='-30%'
        y='-30%'
        width='160%'
        height='160%'
        colorInterpolationFilters='sRGB'
      >
        <feGaussianBlur stdDeviation='5' />
        <feColorMatrix values={GOO_ALPHA_MATRIX} />
      </filter>
      <g filter={`url(#${filterId})`} fill='currentColor' stroke='currentColor'>
        {generateGlyph(seed).map(glyphShape)}
      </g>
    </svg>
  )
}

/**
 * The 16px mark for a workspace or organization: its uploaded logo, else a
 * glyph seeded by the workspace id (so each is recognizable without an
 * upload) or the organization's initial on a neutral tile.
 *
 * Chrome matches the chip family at tile scale: `rounded-sm` is the chip's
 * `rounded-lg` scaled to a 16px box, and the letter sits at the smallest type
 * token. The fill is `--surface-6`, one step past the chip hover and active
 * fills, so the tile still reads as a tile on a hovered or selected row instead
 * of dissolving into it. The letter and the unfilled glyph are the icon gray in
 * light mode and step up to the secondary text gray in dark mode, where the icon
 * gray sits too close to the tile fill. Plain `img`/`div`/`svg` rather than the emcn
 * `Avatar`, whose Radix root renders a `<span>` — and globals fade every `span`
 * in the collapsed rail to `opacity: 0`, which would blank the mark exactly
 * where it is the only thing left to see.
 */
export function IdentityTile({
  initial,
  glyphSeed,
  logoUrl,
  alt = '',
  className,
  slot,
  size = 'sm',
}: IdentityTileProps) {
  if (logoUrl) {
    return (
      <img
        data-slot={slot}
        src={logoUrl}
        alt={alt}
        referrerPolicy='no-referrer'
        className={cn('shrink-0 object-cover', SIZE_CLASS[size], className)}
      />
    )
  }
  if (glyphSeed !== undefined) {
    return <Glyph seed={glyphSeed} className={className} slot={slot} size={size} />
  }
  return (
    <div
      data-slot={slot}
      aria-hidden='true'
      className={cn(
        'flex shrink-0 items-center justify-center bg-[var(--surface-6)] text-[var(--text-icon)] leading-none dark:text-[var(--text-secondary)]',
        SIZE_CLASS[size],
        className
      )}
    >
      {initial}
    </div>
  )
}
