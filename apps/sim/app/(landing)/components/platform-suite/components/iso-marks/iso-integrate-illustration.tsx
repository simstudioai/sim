import { cn } from '@sim/emcn'
import {
  createIsoLineProps,
  ISO_PALETTE,
  ISO_TONE_CLASS,
  type IsoTone,
  withIsoFace,
} from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-illustration-style'
import { ISO_INTEGRATE_PATHS } from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-mark-paths'
import styles from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-marks.module.css'

export interface IsoIntegrateIllustrationProps {
  size?: number
  /** The ground the mark sits on - the pair's lighter or darker tile, in either theme. */
  tone?: IsoTone
  /** Contours only, without face fills, for decorative previews. */
  variant?: 'filled' | 'outline'
  className?: string
}

/**
 * The Integrate mark from the main branch's iso-mark family - a three-tier
 * isometric stack (a socket node up top, a connector port on each of the lower
 * tiers). Ported for the platform suite without the family's idle float: it
 * rests still, and hovering the bloc that holds it (`data-iso-hover`) redraws
 * every contour from zero, bottom tier first. Paths render directly, keeping
 * their contours sharp at the small card size.
 */
export function IsoIntegrateIllustration({
  size = 172,
  tone = 'light',
  variant = 'filled',
  className,
}: IsoIntegrateIllustrationProps) {
  const lineProps = createIsoLineProps('iso-integrate-illustration-line', variant, size)
  return (
    <svg
      viewBox='-263.2717227504693 -263.2717227504693 526.5434455009386 526.5434455009386'
      fill='none'
      shapeRendering='geometricPrecision'
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      aria-hidden={true}
      focusable='false'
      className={cn(
        'iso-integrate-illustration block max-w-none shrink-0',
        variant === 'outline' ? styles.outline : ISO_TONE_CLASS[tone],
        className
      )}
    >
      {variant === 'filled' && (
        <style>
          {`
          .iso-integrate-illustration-line {
            stroke-dasharray: 1;
            stroke-dashoffset: 0;
          }

          [data-iso-hover]:hover .iso-integrate-illustration-line {
            animation: iso-integrate-illustration-line-draw 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
          }

          [data-iso-hover]:hover [data-integrate-layer='bottom-plane'] .iso-integrate-illustration-line,
          [data-iso-hover]:hover [data-integrate-layer='bottom-port'] .iso-integrate-illustration-line {
            animation-delay: 0ms;
          }

          [data-iso-hover]:hover [data-integrate-layer='middle-plane'] .iso-integrate-illustration-line,
          [data-iso-hover]:hover [data-integrate-layer='middle-port'] .iso-integrate-illustration-line {
            animation-delay: 75ms;
          }

          [data-iso-hover]:hover [data-integrate-layer='top-plane'] .iso-integrate-illustration-line,
          [data-iso-hover]:hover [data-integrate-layer='top-socket'] .iso-integrate-illustration-line {
            animation-delay: 150ms;
          }

          @keyframes iso-integrate-illustration-line-draw {
            from {
              stroke-dashoffset: 1;
            }

            to {
              stroke-dashoffset: 0;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            [data-iso-hover]:hover .iso-integrate-illustration-line {
              animation: none;
            }
          }
        `}
        </style>
      )}
      <g>
        <g data-integrate-layer='bottom-plane' pointerEvents='none'>
          <path d={ISO_INTEGRATE_PATHS[0]} {...lineProps} />
        </g>
        <g data-integrate-layer='middle-plane' pointerEvents='none'>
          <path d={ISO_INTEGRATE_PATHS[1]} {...withIsoFace(lineProps, ISO_PALETTE.low)} />
        </g>
        <g data-integrate-layer='middle-port' pointerEvents='none'>
          <path d={ISO_INTEGRATE_PATHS[2]} {...withIsoFace(lineProps, ISO_PALETTE.mid)} />
        </g>
        <g data-integrate-layer='bottom-port' pointerEvents='none'>
          <path d={ISO_INTEGRATE_PATHS[3]} {...withIsoFace(lineProps, ISO_PALETTE.low)} />
        </g>
        <g data-integrate-layer='top-plane' pointerEvents='none'>
          <path d={ISO_INTEGRATE_PATHS[4]} {...withIsoFace(lineProps, ISO_PALETTE.mid)} />
        </g>
        <g data-integrate-layer='top-socket' pointerEvents='none'>
          <path d={ISO_INTEGRATE_PATHS[5]} {...withIsoFace(lineProps, ISO_PALETTE.high)} />
        </g>
      </g>
    </svg>
  )
}
