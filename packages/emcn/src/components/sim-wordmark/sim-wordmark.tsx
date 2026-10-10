import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@sim/emcn'

const WORDMARK_FILLS = {
  body: 'var(--text-body)',
  'brand-muted': 'var(--text-tertiary)',
  inherit: 'currentColor',
  'muted-inverse': 'var(--text-muted-inverse)',
} as const

const WORDMARK_SIZES = {
  nav: { width: 37, height: 18, className: '-translate-y-[1.5px] h-[18px] w-auto' },
  tag: { width: 21, height: 10, className: 'h-[10px] w-auto' },
  loading: { width: 67, height: 32, className: 'h-8 w-auto' },
} as const

export interface SimWordmarkProps {
  /** Navbar, compact 20px ChipTag, or centered application loading mark. */
  size?: keyof typeof WORDMARK_SIZES
  /** Body ink, inherited foreground, muted brand ink, or light ink for inverse surfaces. */
  tone?: keyof typeof WORDMARK_FILLS
}

/** Canonical Sim logotype, shared by browser and bundled desktop pages. */
export function SimWordmark({ size = 'nav', tone = 'body' }: SimWordmarkProps) {
  const { width, height, className } = WORDMARK_SIZES[size]
  const fill = WORDMARK_FILLS[tone]

  return (
    <svg
      viewBox={`0 0 ${WORDMARK_VIEW_BOX.width} ${WORDMARK_VIEW_BOX.height}`}
      width={width}
      height={height}
      fill='none'
      aria-hidden='true'
      className={className}
    >
      <g fill={fill}>
        {WORDMARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}
