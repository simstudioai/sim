import { cn } from '@sim/emcn'
import {
  createIsoLineProps,
  ISO_PALETTE,
  ISO_TONE_CLASS,
  type IsoTone,
  withIsoFace,
} from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-illustration-style'
import { ISO_MONITOR_PATHS } from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-mark-paths'
import styles from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-marks.module.css'

export interface IsoMonitorIllustrationProps {
  size?: number
  /** The ground the mark sits on - the pair's lighter or darker tile, in either theme. */
  tone?: IsoTone
  /** Contours only, without face fills, for decorative previews. */
  variant?: 'filled' | 'outline'
  className?: string
}

/**
 * The Monitor mark from the main branch's iso-mark family - an isometric
 * housing whose lid and side panels stand open around the stacked inner
 * plates (the "look inside every run" read). Ported for the platform suite
 * without the family's idle drift: it rests still, and hovering the bloc that
 * holds it (`data-iso-hover`) redraws every contour from zero, base first. Paths
 * render directly, keeping their contours sharp at the small card size.
 */
export function IsoMonitorIllustration({
  size = 176,
  tone = 'light',
  variant = 'filled',
  className,
}: IsoMonitorIllustrationProps) {
  const lineProps = createIsoLineProps('iso-monitor-illustration-line', variant, size)
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
        'iso-monitor-illustration block max-w-none shrink-0',
        variant === 'outline' ? styles.outline : ISO_TONE_CLASS[tone],
        className
      )}
    >
      {variant === 'filled' && (
        <style>
          {`
          .iso-monitor-illustration-line {
            stroke-dasharray: 1;
            stroke-dashoffset: 0;
          }

          [data-iso-hover]:hover .iso-monitor-illustration-line {
            animation: iso-monitor-illustration-line-draw 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
          }

          [data-iso-hover]:hover [data-monitor-layer='shadow-plane'] .iso-monitor-illustration-line,
          [data-iso-hover]:hover [data-monitor-layer='base-bar'] .iso-monitor-illustration-line {
            animation-delay: 0ms;
          }

          [data-iso-hover]:hover [data-monitor-layer='inner-low'] .iso-monitor-illustration-line,
          [data-iso-hover]:hover [data-monitor-layer='inner-high'] .iso-monitor-illustration-line {
            animation-delay: 70ms;
          }

          [data-iso-hover]:hover [data-monitor-layer='left-panel'] .iso-monitor-illustration-line,
          [data-iso-hover]:hover [data-monitor-layer='right-panel'] .iso-monitor-illustration-line {
            animation-delay: 140ms;
          }

          [data-iso-hover]:hover [data-monitor-layer='top-lid'] .iso-monitor-illustration-line {
            animation-delay: 210ms;
          }

          @keyframes iso-monitor-illustration-line-draw {
            from {
              stroke-dashoffset: 1;
            }

            to {
              stroke-dashoffset: 0;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            [data-iso-hover]:hover .iso-monitor-illustration-line {
              animation: none;
            }
          }
        `}
        </style>
      )}
      <g>
        <g data-monitor-layer='shadow-plane' pointerEvents='none'>
          <path d={ISO_MONITOR_PATHS[0]} {...lineProps} />
        </g>
        <g data-monitor-layer='base-bar' pointerEvents='none'>
          <path d={ISO_MONITOR_PATHS[1]} {...withIsoFace(lineProps, ISO_PALETTE.low)} />
          <path d={ISO_MONITOR_PATHS[2]} {...withIsoFace(lineProps, ISO_PALETTE.mid)} />
          <path d={ISO_MONITOR_PATHS[3]} {...withIsoFace(lineProps, ISO_PALETTE.high)} />
        </g>
        <g data-monitor-layer='right-panel' pointerEvents='none'>
          <path d={ISO_MONITOR_PATHS[4]} {...lineProps} />
        </g>
        <g data-monitor-layer='inner-low' pointerEvents='none'>
          <path d={ISO_MONITOR_PATHS[5]} {...withIsoFace(lineProps, ISO_PALETTE.low)} />
        </g>
        <g data-monitor-layer='inner-high' pointerEvents='none'>
          <path d={ISO_MONITOR_PATHS[6]} {...withIsoFace(lineProps, ISO_PALETTE.mid)} />
        </g>
        <g data-monitor-layer='left-panel' pointerEvents='none'>
          <path d={ISO_MONITOR_PATHS[7]} {...lineProps} />
        </g>
        <g data-monitor-layer='top-lid' pointerEvents='none'>
          <path d={ISO_MONITOR_PATHS[8]} {...lineProps} />
        </g>
      </g>
    </svg>
  )
}
