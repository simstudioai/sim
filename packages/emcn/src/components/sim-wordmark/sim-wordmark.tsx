import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@sim/emcn'

const WORDMARK_FILLS = {
  body: 'var(--text-body)',
  'brand-muted': 'var(--text-tertiary)',
  inherit: 'currentColor',
  'muted-inverse': 'var(--text-muted-inverse)',
} as const

export interface SimWordmarkProps {
  /** Navbar mark or compact mark sized for a 20px ChipTag. */
  size?: 'nav' | 'tag'
  /** Body ink, inherited foreground, muted brand ink, or light ink for inverse surfaces. */
  tone?: keyof typeof WORDMARK_FILLS
}

/** Canonical Sim logotype, shared by browser and bundled desktop pages. */
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
