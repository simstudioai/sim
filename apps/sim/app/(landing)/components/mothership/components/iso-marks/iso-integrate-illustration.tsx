import { cn } from '@/lib/core/utils/cn'
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
 * Inline supplied illustration for the Integrate area.
 */
export function IsoIntegrateIllustration({ size = 156, className }: IsoIntegrateIllustrationProps) {
  return (
    <svg
      viewBox='-180 -155 360 390'
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
            d='M29.44 38.00 L132.56 97.54 Q162.00 114.54 132.56 131.54 L29.44 191.07 Q0.00 208.07 -29.44 191.07 L-132.56 131.54 Q-162.00 114.54 -132.56 97.54 L-29.44 38.00 Q0.00 21.00 29.44 38.00 Z'
            {...LINE_PROPS}
          />
        </g>
        <g data-integrate-layer='bottom-port' pointerEvents='none'>
          <path
            d='M-25.50 117.54 L21.25 144.53 Q34.00 151.89 21.25 159.25 L12.75 164.16 Q0.00 171.52 -12.75 164.16 L-59.50 137.17 Q-72.25 129.81 -59.50 122.45 L-51.00 117.54 Q-38.25 110.18 -25.50 117.54 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_LOW}
          />
        </g>
        <g data-integrate-layer='middle-plane' pointerEvents='none'>
          <path
            d='M29.44 -40.52 L132.56 19.02 Q162.00 36.02 132.56 53.02 L29.44 112.55 Q0.00 129.55 -29.44 112.55 L-132.56 53.02 Q-162.00 36.02 -132.56 19.02 L-29.44 -40.52 Q0.00 -57.52 29.44 -40.52 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_LOW}
          />
        </g>
        <g data-integrate-layer='middle-port' pointerEvents='none'>
          <path
            d='M82.88 7.15 L105.22 20.04 Q119.00 28.00 105.22 35.96 L82.88 48.85 Q69.10 56.81 55.32 48.85 L32.98 35.96 Q19.20 28.00 32.98 20.04 L55.32 7.15 Q69.10 -0.81 82.88 7.15 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_MID}
          />
        </g>
        <g data-integrate-layer='top-plane' pointerEvents='none'>
          <path
            d='M29.44 -119.04 L132.56 -59.50 Q162.00 -42.50 132.56 -25.50 L29.44 34.03 Q0.00 51.03 -29.44 34.03 L-132.56 -25.50 Q-162.00 -42.50 -132.56 -59.50 L-29.44 -119.04 Q0.00 -136.04 29.44 -119.04 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_MID}
          />
        </g>
        <g data-integrate-layer='top-socket' pointerEvents='none'>
          <path
            d='M42.50 -44.56 C19.03 -31.01 -19.03 -31.01 -42.50 -44.56 C-65.97 -58.11 -65.97 -80.09 -42.50 -93.64 C-19.03 -107.19 19.03 -107.19 42.50 -93.64 C65.97 -80.09 65.97 -58.11 42.50 -44.56 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_HIGH}
          />
        </g>
      </g>
    </svg>
  )
}
