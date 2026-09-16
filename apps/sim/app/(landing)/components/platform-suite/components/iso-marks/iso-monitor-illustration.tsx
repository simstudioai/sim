import { cn } from '@sim/emcn'
import {
  createIsoLineProps,
  ISO_PALETTE,
  ISO_TONE_CLASS,
  type IsoTone,
  withIsoFace,
} from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-illustration-style'
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
          <path
            d='M16.45 -34.38 L211.55 78.26 Q228.00 87.76 211.55 97.26 L16.45 209.89 Q0.00 219.39 -16.45 209.89 L-211.55 97.26 Q-228.00 87.76 -211.55 78.26 L-16.45 -34.38 Q0.00 -43.88 16.45 -34.38 Z'
            {...lineProps}
          />
        </g>
        <g data-monitor-layer='base-bar' pointerEvents='none'>
          <path
            d='M-186.71 89.66 L-3.29 195.55 Q0.00 197.45 0.00 193.65 L0.00 179.31 Q0.00 175.51 -3.29 173.61 L-186.71 67.72 Q-190.00 65.82 -190.00 69.62 L-190.00 83.96 Q-190.00 87.76 -186.71 89.66 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.low)}
          />
          <path
            d='M186.71 89.66 L3.29 195.55 Q0.00 197.45 0.00 193.65 L0.00 179.31 Q0.00 175.51 3.29 173.61 L186.71 67.72 Q190.00 65.82 190.00 69.62 L190.00 83.96 Q190.00 87.76 186.71 89.66 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.mid)}
          />
          <path
            d='M3.29 -41.98 L186.71 63.92 Q190.00 65.82 186.71 67.72 L3.29 173.61 Q0.00 175.51 -3.29 173.61 L-186.71 67.72 Q-190.00 65.82 -186.71 63.92 L-3.29 -41.98 Q0.00 -43.88 3.29 -41.98 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.high)}
          />
        </g>
        <g data-monitor-layer='right-panel' pointerEvents='none'>
          <path
            d='M32.91 -68.76 L128.59 -13.52 Q161.50 5.48 161.50 -32.52 L161.50 -88.15 Q161.50 -126.15 128.59 -145.15 L32.91 -200.39 Q0.00 -219.39 0.00 -181.39 L0.00 -125.76 Q0.00 -87.76 32.91 -68.76 Z'
            {...lineProps}
          />
        </g>
        <g data-monitor-layer='inner-low' pointerEvents='none'>
          <path
            d='M32.91 -2.94 L119.09 46.82 Q152.00 65.82 119.09 84.82 L32.91 134.58 Q0.00 153.58 -32.91 134.58 L-119.09 84.82 Q-152.00 65.82 -119.09 46.82 L-32.91 -2.94 Q0.00 -21.94 32.91 -2.94 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.low)}
          />
        </g>
        <g data-monitor-layer='inner-high' pointerEvents='none'>
          <path
            d='M32.91 -46.82 L119.09 2.94 Q152.00 21.94 119.09 40.94 L32.91 90.70 Q0.00 109.70 -32.91 90.70 L-119.09 40.94 Q-152.00 21.94 -119.09 2.94 L-32.91 -46.82 Q0.00 -65.82 32.91 -46.82 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.mid)}
          />
        </g>
        <g data-monitor-layer='left-panel' pointerEvents='none'>
          <path
            d='M-157.09 62.88 L-32.91 134.58 Q0.00 153.58 0.00 115.58 L0.00 38.00 Q0.00 0.00 -32.91 -19.00 L-157.09 -90.70 Q-190.00 -109.70 -190.00 -71.70 L-190.00 5.88 Q-190.00 43.88 -157.09 62.88 Z'
            {...lineProps}
          />
        </g>
        <g data-monitor-layer='top-lid' pointerEvents='none'>
          <path
            d='M32.91 -200.39 L81.09 -172.58 Q114.00 -153.58 81.09 -134.58 L-43.09 -62.88 Q-76.00 -43.88 -108.91 -62.88 L-157.09 -90.70 Q-190.00 -109.70 -157.09 -128.70 L-32.91 -200.39 Q0.00 -219.39 32.91 -200.39 Z'
            {...lineProps}
          />
        </g>
      </g>
    </svg>
  )
}
