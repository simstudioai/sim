/**
 * LineGlyph — a static line-geometry glyph family for the Sim section's area
 * columns. Separate from the animated {@link ThinkingLoader} (the cycle loaders
 * stay as they are); this is the "harmonograph / Lissajous" line register the
 * brand is moving toward for abstract feature marks.
 *
 * Each variant is a deterministic curve in the shared 100×100 box, stroked with
 * the brand's radial greyscale gradient (`#2C2C2C` center → `#5F5F5F` edge — the
 * same ramp as the wordmark and cycle loaders; a fixed brand value, hence the
 * hardcoded hex, and the landing is always light). The paths are precomputed at
 * module scope — the component ships as zero-JS, server-rendered SVG.
 *
 * A "goo" filter (blur → alpha threshold, the metaball technique the loaders use)
 * fuses the strokes where they cross or touch, so intersections read as smooth
 * rounded necks rather than hard Xs.
 *
 * - `spirograph` — an epicyclic flower (petals reaching outward) → Integrate
 * - `flower` — overlapping circles, a seed-of-life lattice → Ingest context
 * - `lissajous-3-2` — a clean woven figure → Build
 * - `lissajous-5-4` — a denser woven figure → Monitor
 */
export type LineGlyphVariant = 'spirograph' | 'flower' | 'lissajous-3-2' | 'lissajous-5-4'

const TAU = Math.PI * 2

function curve(fn: (t: number) => [number, number], steps: number): string {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const [x, y] = fn((i / steps) * TAU)
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `
  }
  return `${d}Z`
}

/**
 * Every glyph is normalized to the same ~40 max reach (an ~80×80 footprint in
 * the 100 box) so the four read as a consistently sized set — the curves fill
 * the box differently, so the amplitudes are tuned to match, not left at their
 * natural extents.
 */
const REACH = 40

const CURVE_PATHS: Record<Exclude<LineGlyphVariant, 'flower'>, string> = {
  'lissajous-3-2': curve((t) => [50 + REACH * Math.sin(3 * t + Math.PI / 2), 50 + REACH * Math.sin(2 * t)], 420),
  'lissajous-5-4': curve((t) => [50 + REACH * Math.sin(5 * t + Math.PI / 2), 50 + REACH * Math.sin(4 * t)], 460),
  spirograph: curve(
    (t) => [50 + 25 * Math.cos(t) + 15 * Math.cos(5 * t), 50 + 25 * Math.sin(t) - 15 * Math.sin(5 * t)],
    540
  ),
}

const FLOWER_G = REACH / 2
const FLOWER_CIRCLES: Array<{ cx: number; cy: number }> = [
  { cx: 50, cy: 50 },
  ...Array.from({ length: 6 }, (_, k) => {
    const a = (k * TAU) / 6
    return { cx: 50 + FLOWER_G * Math.cos(a), cy: 50 + FLOWER_G * Math.sin(a) }
  }),
]

interface LineGlyphProps {
  variant: LineGlyphVariant
  /** Rendered px size (square). Defaults to 44 to match the column rhythm. */
  size?: number
  className?: string
}

export function LineGlyph({ variant, size = 44, className }: LineGlyphProps) {
  const gradientId = `line-glyph-grad-${variant}`
  const gooId = `line-glyph-goo-${variant}`
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 100 100'
      fill='none'
      stroke={`url(#${gradientId})`}
      strokeWidth={3}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      className={className}
    >
      <defs>
        <radialGradient id={gradientId} gradientUnits='userSpaceOnUse' cx='50' cy='50' r='44'>
          <stop stopColor='#2C2C2C' />
          <stop offset='1' stopColor='#5F5F5F' />
        </radialGradient>
        <filter id={gooId} x='-20%' y='-20%' width='140%' height='140%'>
          <feGaussianBlur in='SourceGraphic' stdDeviation='2' result='blur' />
          <feColorMatrix in='blur' type='matrix' values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7' />
        </filter>
      </defs>
      <g filter={`url(#${gooId})`}>
        {variant === 'flower' ? (
          FLOWER_CIRCLES.map(({ cx, cy }) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={FLOWER_G} />)
        ) : (
          <path d={CURVE_PATHS[variant]} />
        )}
      </g>
    </svg>
  )
}
