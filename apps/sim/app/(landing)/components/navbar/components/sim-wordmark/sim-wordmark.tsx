import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@/lib/branding/wordmark'

const WORDMARK_FILLS = {
  body: 'var(--text-body)',
  'brand-muted': 'var(--text-tertiary)',
  inherit: 'currentColor',
  'muted-inverse': 'var(--text-muted-inverse)',
} as const

interface SimWordmarkProps {
  /** Navbar mark or compact mark sized for a 20px ChipTag. */
  size?: 'nav' | 'tag'
  /** Body ink, inherited foreground, muted brand ink, or light ink for inverse surfaces. */
  tone?: keyof typeof WORDMARK_FILLS
}

/**
 * Inline "sim" brand logotype (wordmark, no separate icon mark) - the paths
 * from the v1.0 brand guide's `simLogotype--dark.svg`, inlined so the logo
 * ships as zero-request server-rendered HTML. They live in
 * `@/lib/branding/wordmark` because the email header rasterizes the same
 * outlines.
 *
 * Filled with the navbar's `var(--text-body)` by default. Compact marks can
 * inherit the surrounding foreground or use the platform's muted inverse ink,
 * without duplicating surface chrome here.
 *
 * The navbar mark is 18px tall and nudged up 1.5px because the glyph mass sits
 * below the i-dot's headroom. The tag mark is 10px tall and remains centered in
 * the 20px tag.
 */
export function SimWordmark({ size = 'nav', tone = 'body' }: SimWordmarkProps) {
  const compact = size === 'tag'
  const width = compact ? 21 : 37
  const height = compact ? 10 : 18
  const fill = WORDMARK_FILLS[tone]

  return (
    <svg
      viewBox={`0 0 ${WORDMARK_VIEW_BOX.width} ${WORDMARK_VIEW_BOX.height}`}
      width={width}
      height={height}
      fill='none'
      aria-hidden='true'
      className={compact ? 'h-[10px] w-auto' : '-translate-y-[1.5px] h-[18px] w-auto'}
    >
      <g fill={fill}>
        {WORDMARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}
