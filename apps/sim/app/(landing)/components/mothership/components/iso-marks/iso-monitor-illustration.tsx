import { cn } from '@sim/emcn'
import {
  createIsoLineProps,
  ISO_FILL_HIGH,
  ISO_FILL_LOW,
  ISO_FILL_MID,
  ISO_STROKE,
} from '@/app/(landing)/components/mothership/components/iso-marks/iso-illustration-style'

export interface IsoMonitorIllustrationProps {
  size?: number
  className?: string
}

const STROKE_PAINT = ISO_STROKE

const LINE_PROPS = createIsoLineProps('iso-monitor-line', STROKE_PAINT)

/**
 * Inline supplied illustration for the Monitor area - an isometric housing whose
 * lid and two side panels drift apart on a slow loop to reveal the stacked inner
 * plates (the "look inside every run" read). Hovering redraws every contour from
 * zero.
 */
export function IsoMonitorIllustration({ size = 176, className }: IsoMonitorIllustrationProps) {
  return (
    <svg
      viewBox='-263.2717227504693 -263.2717227504693 526.5434455009386 526.5434455009386'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      aria-hidden={true}
      focusable='false'
      className={cn('iso-monitor-illustration block max-w-none shrink-0', className)}
    >
      <style>
        {`
          .iso-monitor-line {
            stroke-dasharray: 1;
            stroke-dashoffset: 0;
          }

          .iso-monitor-separating-panel {
            transform-box: fill-box;
            transform-origin: center;
            will-change: transform;
          }

          @media (prefers-reduced-motion: no-preference) {
            .iso-monitor-panel-top {
              animation: iso-monitor-panel-top-separate 5600ms cubic-bezier(0.37, 0, 0.22, 1) infinite;
            }

            .iso-monitor-panel-right {
              animation: iso-monitor-panel-right-separate 5600ms cubic-bezier(0.37, 0, 0.22, 1) infinite;
              animation-delay: 120ms;
            }

            .iso-monitor-panel-left {
              animation: iso-monitor-panel-left-separate 5600ms cubic-bezier(0.37, 0, 0.22, 1) infinite;
              animation-delay: 240ms;
            }
          }

          .iso-monitor-illustration:hover .iso-monitor-line {
            animation: iso-monitor-line-draw 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
          }

          .iso-monitor-illustration:hover [data-monitor-layer='shadow-plane'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='base-bar'] .iso-monitor-line {
            animation-delay: 0ms;
          }

          .iso-monitor-illustration:hover [data-monitor-layer='inner-low'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='inner-high'] .iso-monitor-line {
            animation-delay: 70ms;
          }

          .iso-monitor-illustration:hover [data-monitor-layer='left-panel'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='right-panel'] .iso-monitor-line {
            animation-delay: 140ms;
          }

          .iso-monitor-illustration:hover [data-monitor-layer='top-lid'] .iso-monitor-line {
            animation-delay: 210ms;
          }

          @keyframes iso-monitor-line-draw {
            from {
              stroke-dashoffset: 1;
            }

            to {
              stroke-dashoffset: 0;
            }
          }

          @keyframes iso-monitor-panel-top-separate {
            0%,
            16%,
            100% {
              transform: translate(0, 0);
            }

            38%,
            64% {
              transform: translate(-9px, -18px);
            }
          }

          @keyframes iso-monitor-panel-right-separate {
            0%,
            16%,
            100% {
              transform: translate(0, 0);
            }

            38%,
            64% {
              transform: translate(18px, -8px);
            }
          }

          @keyframes iso-monitor-panel-left-separate {
            0%,
            16%,
            100% {
              transform: translate(0, 0);
            }

            38%,
            64% {
              transform: translate(-18px, 9px);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .iso-monitor-separating-panel,
            .iso-monitor-illustration:hover .iso-monitor-line {
              animation: none;
            }
          }
        `}
      </style>
      <defs>
        <filter id='iso-monitor-line-connection' x='-100%' y='-100%' width='300%' height='300%'>
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
      <g filter='url(#iso-monitor-line-connection)'>
        <g data-monitor-layer='shadow-plane' pointerEvents='none'>
          <path
            d='M16.45 -34.38 L211.55 78.26 Q228.00 87.76 211.55 97.26 L16.45 209.89 Q0.00 219.39 -16.45 209.89 L-211.55 97.26 Q-228.00 87.76 -211.55 78.26 L-16.45 -34.38 Q0.00 -43.88 16.45 -34.38 Z'
            {...LINE_PROPS}
          />
        </g>
        <g data-monitor-layer='base-bar' pointerEvents='none'>
          <path
            d='M-186.71 89.66 L-3.29 195.55 Q0.00 197.45 0.00 193.65 L0.00 179.31 Q0.00 175.51 -3.29 173.61 L-186.71 67.72 Q-190.00 65.82 -190.00 69.62 L-190.00 83.96 Q-190.00 87.76 -186.71 89.66 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_LOW}
          />
          <path
            d='M186.71 89.66 L3.29 195.55 Q0.00 197.45 0.00 193.65 L0.00 179.31 Q0.00 175.51 3.29 173.61 L186.71 67.72 Q190.00 65.82 190.00 69.62 L190.00 83.96 Q190.00 87.76 186.71 89.66 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_MID}
          />
          <path
            d='M3.29 -41.98 L186.71 63.92 Q190.00 65.82 186.71 67.72 L3.29 173.61 Q0.00 175.51 -3.29 173.61 L-186.71 67.72 Q-190.00 65.82 -186.71 63.92 L-3.29 -41.98 Q0.00 -43.88 3.29 -41.98 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_HIGH}
          />
        </g>
        <g
          data-monitor-layer='right-panel'
          className='iso-monitor-separating-panel iso-monitor-panel-right'
          pointerEvents='none'
        >
          <path
            d='M32.91 -68.76 L128.59 -13.52 Q161.50 5.48 161.50 -32.52 L161.50 -88.15 Q161.50 -126.15 128.59 -145.15 L32.91 -200.39 Q0.00 -219.39 0.00 -181.39 L0.00 -125.76 Q0.00 -87.76 32.91 -68.76 Z'
            {...LINE_PROPS}
          />
        </g>
        <g data-monitor-layer='inner-low' pointerEvents='none'>
          <path
            d='M32.91 -2.94 L119.09 46.82 Q152.00 65.82 119.09 84.82 L32.91 134.58 Q0.00 153.58 -32.91 134.58 L-119.09 84.82 Q-152.00 65.82 -119.09 46.82 L-32.91 -2.94 Q0.00 -21.94 32.91 -2.94 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_LOW}
          />
        </g>
        <g data-monitor-layer='inner-high' pointerEvents='none'>
          <path
            d='M32.91 -46.82 L119.09 2.94 Q152.00 21.94 119.09 40.94 L32.91 90.70 Q0.00 109.70 -32.91 90.70 L-119.09 40.94 Q-152.00 21.94 -119.09 2.94 L-32.91 -46.82 Q0.00 -65.82 32.91 -46.82 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_MID}
          />
        </g>
        <g
          data-monitor-layer='left-panel'
          className='iso-monitor-separating-panel iso-monitor-panel-left'
          pointerEvents='none'
        >
          <path
            d='M-157.09 62.88 L-32.91 134.58 Q0.00 153.58 0.00 115.58 L0.00 38.00 Q0.00 0.00 -32.91 -19.00 L-157.09 -90.70 Q-190.00 -109.70 -190.00 -71.70 L-190.00 5.88 Q-190.00 43.88 -157.09 62.88 Z'
            {...LINE_PROPS}
          />
        </g>
        <g
          data-monitor-layer='top-lid'
          className='iso-monitor-separating-panel iso-monitor-panel-top'
          pointerEvents='none'
        >
          <path
            d='M32.91 -200.39 L81.09 -172.58 Q114.00 -153.58 81.09 -134.58 L-43.09 -62.88 Q-76.00 -43.88 -108.91 -62.88 L-157.09 -90.70 Q-190.00 -109.70 -157.09 -128.70 L-32.91 -200.39 Q0.00 -219.39 32.91 -200.39 Z'
            {...LINE_PROPS}
          />
        </g>
      </g>
    </svg>
  )
}
