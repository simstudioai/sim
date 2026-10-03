import { cn } from '@sim/emcn'
import {
  createIsoLineProps,
  ISO_PALETTE,
  ISO_TONE_CLASS,
  type IsoTone,
  withIsoFace,
} from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-illustration-style'
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
          <path
            d='M32.91 19.00 L157.09 90.70 Q190.00 109.70 157.09 128.70 L32.91 200.39 Q0.00 219.39 -32.91 200.39 L-157.09 128.70 Q-190.00 109.70 -157.09 90.70 L-32.91 19.00 Q0.00 -0.00 32.91 19.00 Z'
            {...lineProps}
          />
        </g>
        <g data-integrate-layer='middle-plane' pointerEvents='none'>
          <path
            d='M32.91 -90.70 L157.09 -19.00 Q190.00 -0.00 157.09 19.00 L32.91 90.70 Q0.00 109.70 -32.91 90.70 L-157.09 19.00 Q-190.00 -0.00 -157.09 -19.00 L-32.91 -90.70 Q0.00 -109.70 32.91 -90.70 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.low)}
          />
        </g>
        <g data-integrate-layer='middle-port' pointerEvents='none'>
          <path
            d='M111.45 -23.41 L135.55 -9.50 Q152.00 0.00 135.55 9.50 L120.95 17.92 Q104.50 27.42 88.05 17.92 L63.95 4.02 Q47.50 -5.48 63.95 -14.98 L78.55 -23.41 Q95.00 -32.91 111.45 -23.41 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.mid)}
          />
        </g>
        <g data-integrate-layer='bottom-port' pointerEvents='none'>
          <path
            d='M-34.01 129.57 L28.08 165.42 Q44.53 174.92 28.08 184.42 L19.42 189.41 Q2.97 198.91 -13.49 189.41 L-75.58 153.56 Q-92.03 144.06 -75.58 134.56 L-66.92 129.57 Q-50.47 120.07 -34.01 129.57 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.low)}
          />
        </g>
        <g data-integrate-layer='top-plane' pointerEvents='none'>
          <path
            d='M32.91 -200.39 L157.09 -128.70 Q190.00 -109.70 157.09 -90.70 L32.91 -19.00 Q0.00 -0.00 -32.91 -19.00 L-157.09 -90.70 Q-190.00 -109.70 -157.09 -128.70 L-32.91 -200.39 Q0.00 -219.39 32.91 -200.39 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.mid)}
          />
        </g>
        <g data-integrate-layer='top-socket' pointerEvents='none'>
          <path
            d='M37.70 -129.63 C16.71 -117.51 -17.31 -117.51 -38.30 -129.63 C-59.29 -141.74 -59.29 -161.39 -38.30 -173.50 C-17.31 -185.62 16.71 -185.62 37.70 -173.50 C58.69 -161.39 58.69 -141.74 37.70 -129.63 Z'
            {...withIsoFace(lineProps, ISO_PALETTE.high)}
          />
        </g>
      </g>
    </svg>
  )
}
