import type { ReactNode } from 'react'

export interface SecurityMarkProps {
  className?: string
}

const FEATURE_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.55,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const CERT_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  pathLength: 1,
} as const

/**
 * A feature mark's viewBox, shifted so the drawing starts at the box's left
 * edge.
 *
 * The marks are drawn centred on the 64-unit grid, which leaves ~14 units of
 * air before the first stroke. Stacked above its label in a flex column that
 * reads as the icon being indented from the text, and the air differs per mark
 * (a circle's leftmost point sits further in than a rect's edge), so the six
 * do not even indent alike. Moving the viewBox origin to the mark's own stroke
 * edge slides the drawing flush left at the same scale, without redrawing
 * geometry or cropping it — the box keeps its 64-unit width, so the freed
 * space falls on the right where nothing is anchored.
 *
 * `geometryLeft` is the mark's leftmost path coordinate; half the stroke sits
 * outside it, and that outer edge is what has to land on the text's left edge.
 */
function flushLeftBox(geometryLeft: number): string {
  return `${geometryLeft - FEATURE_STROKE.strokeWidth / 2} 0 64 64`
}

interface MarkSvgProps {
  className?: string
  viewBox: string
  children: ReactNode
}

function MarkSvg({ className, viewBox, children }: MarkSvgProps) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      fill='none'
      overflow='visible'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
    >
      {children}
    </svg>
  )
}

export function SsoMark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(14)}>
      <rect x='14' y='18' width='36' height='28' rx='4' {...FEATURE_STROKE} />
      <circle cx='26' cy='32' r='5' {...FEATURE_STROKE} />
      <path d='M21 41c1.4-3.2 3.6-4.8 5-4.8s3.6 1.6 5 4.8' {...FEATURE_STROKE} />
      <circle cx='42' cy='30' r='3.2' {...FEATURE_STROKE} />
      <path d='M42 33.2v5.3l1.8 1.2' {...FEATURE_STROKE} />
    </MarkSvg>
  )
}

export function PermissionGroupsMark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(26 - 11)}>
      <circle cx='26' cy='28' r='11' {...FEATURE_STROKE} />
      <circle cx='38' cy='28' r='11' {...FEATURE_STROKE} />
      <circle cx='32' cy='40' r='11' {...FEATURE_STROKE} />
    </MarkSvg>
  )
}

export function SpendControlsMark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(32 - 18)}>
      <circle cx='32' cy='32' r='18' {...FEATURE_STROKE} />
      <path d='M32 18v4M32 42v4M18 32h4M42 32h4' {...FEATURE_STROKE} />
      <path d='M32 32 42 24' {...FEATURE_STROKE} />
      <circle cx='32' cy='32' r='2.2' {...FEATURE_STROKE} />
    </MarkSvg>
  )
}

export function AuditRecordsMark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(18 - 2.2)}>
      <path d='M18 16v32' {...FEATURE_STROKE} />
      <circle cx='18' cy='22' r='2.2' {...FEATURE_STROKE} />
      <circle cx='18' cy='32' r='2.2' {...FEATURE_STROKE} />
      <circle cx='18' cy='42' r='2.2' {...FEATURE_STROKE} />
      <path d='M24 22h22M24 32h16M24 42h20' {...FEATURE_STROKE} />
    </MarkSvg>
  )
}

export function DataRetentionMark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(32 - 16)}>
      <circle cx='32' cy='34' r='16' {...FEATURE_STROKE} />
      <path d='M32 22v12l8 5' {...FEATURE_STROKE} />
      <path d='M28 12h8M32 12v6' {...FEATURE_STROKE} />
      <path d='M44.5 23.5a16 16 0 0 1 3.5 10.5' {...FEATURE_STROKE} />
    </MarkSvg>
  )
}

export function SelfHostingMark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(14)}>
      <rect x='14' y='16' width='36' height='14' rx='3' {...FEATURE_STROKE} />
      <rect x='14' y='34' width='36' height='14' rx='3' {...FEATURE_STROKE} />
      <circle cx='20' cy='23' r='1.5' {...FEATURE_STROKE} />
      <circle cx='20' cy='41' r='1.5' {...FEATURE_STROKE} />
      <path d='M28 23h16M28 41h16' {...FEATURE_STROKE} />
    </MarkSvg>
  )
}

/** A softly shouldered shield and a centered check, drawn on the shared 96-unit grid. */
export function Soc2TypeIiMark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox='0 0 96 96'>
      <path
        d='M48 16 73 25q4 1.5 4 6v18c0 14-11 24-29 31-18-7-29-17-29-31V31q0-4.5 4-6Z'
        {...CERT_STROKE}
      />
      <g data-cert-detail=''>
        <path d='m35 48 9 9 17-18' {...CERT_STROKE} />
      </g>
    </MarkSvg>
  )
}

/** An airy globe with a single elliptical meridian and three balanced latitude lines. */
export function Iso27001Mark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox='0 0 96 96'>
      <circle cx='48' cy='48' r='31' {...CERT_STROKE} />
      <g data-cert-detail=''>
        <ellipse cx='48' cy='48' rx='13' ry='31' {...CERT_STROKE} />
        <path d='M17 48h62' {...CERT_STROKE} />
        <path d='M21.45 32h53.1M21.45 64h53.1' {...CERT_STROKE} />
      </g>
    </MarkSvg>
  )
}

const GDPR_STAR_CENTERS = [
  [48, 24],
  [60, 27.2],
  [68.8, 36],
  [72, 48],
  [68.8, 60],
  [60, 68.8],
  [48, 72],
  [36, 68.8],
  [27.2, 60],
  [24, 48],
  [27.2, 36],
  [36, 27.2],
] as const

/** A compact privacy lock surrounded by twelve fine stars inside the circular boundary. */
export function GdprMark({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox='0 0 96 96'>
      <circle cx='48' cy='48' r='31' {...CERT_STROKE} />
      <g data-cert-detail=''>
        <g data-cert-stars=''>
          {GDPR_STAR_CENTERS.map(([x, y]) => (
            <path
              key={`${x}-${y}`}
              transform={`translate(${x} ${y})`}
              d='M0-2.5 .65-.89 2.38-.77 1.05.34 1.47 2.02 0 1.1-1.47 2.02-1.05.34-2.38-.77-.65-.89Z'
              {...CERT_STROKE}
              strokeWidth={0.65}
            />
          ))}
        </g>
        <path d='M41 44v-6a7 7 0 0 1 14 0v6' {...CERT_STROKE} />
        <rect x='36' y='44' width='24' height='20' rx='4' {...CERT_STROKE} />
        <circle cx='48' cy='53' r='1.8' {...CERT_STROKE} />
        <path d='M48 54.8v3.7' {...CERT_STROKE} />
      </g>
    </MarkSvg>
  )
}

export function DetailsArrow({ className }: SecurityMarkProps) {
  return (
    <MarkSvg className={className} viewBox='0 0 12 12'>
      <path
        d='M3.2 8.8 8.8 3.2M4.2 3.2h4.6V7.8'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </MarkSvg>
  )
}
