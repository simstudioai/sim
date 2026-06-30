import { cn } from '@sim/emcn'
import {
  createIsoLineProps,
  ISO_FILL_HIGH,
  ISO_FILL_LOW,
  ISO_FILL_MID,
  ISO_STROKE,
} from '@/app/(landing)/components/mothership/components/iso-marks/iso-illustration-style'

export interface IsoIntegrateIllustrationProps {
  size?: number
  className?: string
}

const STROKE_PAINT = ISO_STROKE

const LINE_PROPS = createIsoLineProps('iso-integrate-line', STROKE_PAINT)

/**
 * Inline supplied illustration for the Integrate area - a three-tier isometric
 * stack (a socket node up top, a connector port on each of the lower tiers).
 * The top and bottom tiers breathe toward the middle on a slow loop; hovering
 * redraws every contour from zero.
 */
export function IsoIntegrateIllustration({ size = 172, className }: IsoIntegrateIllustrationProps) {
  return (
    <svg
      viewBox='-263.2717227504693 -263.2717227504693 526.5434455009386 526.5434455009386'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      aria-hidden={true}
      focusable='false'
      className={cn('iso-integrate-illustration block max-w-none shrink-0', className)}
    >
      <style>
        {`
          .iso-integrate-line {
            stroke-dasharray: 1;
            stroke-dashoffset: 0;
          }

          [data-integrate-layer='top-plane'],
          [data-integrate-layer='top-socket'],
          [data-integrate-layer='bottom-plane'],
          [data-integrate-layer='bottom-port'] {
            transform-box: fill-box;
            transform-origin: center;
            will-change: transform;
          }

          @media (prefers-reduced-motion: no-preference) {
            [data-integrate-layer='top-plane'],
            [data-integrate-layer='top-socket'] {
              animation: iso-integrate-top-float 5200ms cubic-bezier(0.37, 0, 0.22, 1) infinite;
            }

            [data-integrate-layer='bottom-plane'],
            [data-integrate-layer='bottom-port'] {
              animation: iso-integrate-bottom-float 5200ms cubic-bezier(0.37, 0, 0.22, 1) infinite;
            }
          }

          .iso-integrate-illustration:hover .iso-integrate-line {
            animation: iso-integrate-line-draw 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
          }

          .iso-integrate-illustration:hover [data-integrate-layer='bottom-plane'] .iso-integrate-line,
          .iso-integrate-illustration:hover [data-integrate-layer='bottom-port'] .iso-integrate-line {
            animation-delay: 0ms;
          }

          .iso-integrate-illustration:hover [data-integrate-layer='middle-plane'] .iso-integrate-line,
          .iso-integrate-illustration:hover [data-integrate-layer='middle-port'] .iso-integrate-line {
            animation-delay: 75ms;
          }

          .iso-integrate-illustration:hover [data-integrate-layer='top-plane'] .iso-integrate-line,
          .iso-integrate-illustration:hover [data-integrate-layer='top-socket'] .iso-integrate-line {
            animation-delay: 150ms;
          }

          @keyframes iso-integrate-top-float {
            0%,
            16%,
            100% {
              transform: translateY(0);
            }

            44%,
            64% {
              transform: translateY(20px);
            }
          }

          @keyframes iso-integrate-bottom-float {
            0%,
            16%,
            100% {
              transform: translateY(0);
            }

            44%,
            64% {
              transform: translateY(-20px);
            }
          }

          @keyframes iso-integrate-line-draw {
            from {
              stroke-dashoffset: 1;
            }

            to {
              stroke-dashoffset: 0;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            [data-integrate-layer='top-plane'],
            [data-integrate-layer='top-socket'],
            [data-integrate-layer='bottom-plane'],
            [data-integrate-layer='bottom-port'],
            .iso-integrate-illustration:hover .iso-integrate-line {
              animation: none;
            }
          }
        `}
      </style>
      <defs>
        <filter id='iso-integrate-line-connection' x='-100%' y='-100%' width='300%' height='300%'>
          <feGaussianBlur in='SourceGraphic' stdDeviation='1' result='b' />
          <feColorMatrix
            in='b'
            type='matrix'
            values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -7.2'
            result='goo'
          />
          <feComposite in='SourceGraphic' in2='goo' operator='over' />
        </filter>
      </defs>
      <g filter='url(#iso-integrate-line-connection)'>
        <g data-integrate-layer='bottom-plane' pointerEvents='none'>
          <path
            d='M32.91 19.00 L157.09 90.70 Q190.00 109.70 157.09 128.70 L32.91 200.39 Q0.00 219.39 -32.91 200.39 L-157.09 128.70 Q-190.00 109.70 -157.09 90.70 L-32.91 19.00 Q0.00 -0.00 32.91 19.00 Z'
            {...LINE_PROPS}
          />
        </g>
        <g data-integrate-layer='middle-plane' pointerEvents='none'>
          <path
            d='M32.91 -90.70 L157.09 -19.00 Q190.00 -0.00 157.09 19.00 L32.91 90.70 Q0.00 109.70 -32.91 90.70 L-157.09 19.00 Q-190.00 -0.00 -157.09 -19.00 L-32.91 -90.70 Q0.00 -109.70 32.91 -90.70 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_LOW}
          />
        </g>
        <g data-integrate-layer='middle-port' pointerEvents='none'>
          <path
            d='M111.45 -23.41 L135.55 -9.50 Q152.00 0.00 135.55 9.50 L120.95 17.92 Q104.50 27.42 88.05 17.92 L63.95 4.02 Q47.50 -5.48 63.95 -14.98 L78.55 -23.41 Q95.00 -32.91 111.45 -23.41 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_MID}
          />
        </g>
        <g data-integrate-layer='bottom-port' pointerEvents='none'>
          <path
            d='M-34.01 129.57 L28.08 165.42 Q44.53 174.92 28.08 184.42 L19.42 189.41 Q2.97 198.91 -13.49 189.41 L-75.58 153.56 Q-92.03 144.06 -75.58 134.56 L-66.92 129.57 Q-50.47 120.07 -34.01 129.57 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_LOW}
          />
        </g>
        <g data-integrate-layer='top-plane' pointerEvents='none'>
          <path
            d='M32.91 -200.39 L157.09 -128.70 Q190.00 -109.70 157.09 -90.70 L32.91 -19.00 Q0.00 -0.00 -32.91 -19.00 L-157.09 -90.70 Q-190.00 -109.70 -157.09 -128.70 L-32.91 -200.39 Q0.00 -219.39 32.91 -200.39 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_MID}
          />
        </g>
        <g data-integrate-layer='top-socket' pointerEvents='none'>
          <path
            d='M37.70 -129.63 C16.71 -117.51 -17.31 -117.51 -38.30 -129.63 C-59.29 -141.74 -59.29 -161.39 -38.30 -173.50 C-17.31 -185.62 16.71 -185.62 37.70 -173.50 C58.69 -161.39 58.69 -141.74 37.70 -129.63 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_HIGH}
          />
        </g>
      </g>
    </svg>
  )
}
