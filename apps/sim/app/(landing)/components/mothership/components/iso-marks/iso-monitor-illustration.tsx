import { cn } from '@/lib/core/utils/cn'
import {
  createIsoLineProps,
  ISO_ENDPOINT_STROKE_WIDTH,
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

const EDGE_LINE_PROPS = {
  ...LINE_PROPS,
  strokeMiterlimit: 4,
}

/**
 * Inline supplied illustration for the Monitor area.
 */
export function IsoMonitorIllustration({ size = 166, className }: IsoMonitorIllustrationProps) {
  return (
    <svg
      viewBox='-274.81872813426185 -274.81872813426185 549.6374562685237 549.6374562685237'
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
          .iso-monitor-illustration:hover [data-monitor-layer='top-lid'] .iso-monitor-line {
            animation-delay: 0ms;
          }

          .iso-monitor-illustration:hover [data-monitor-layer='base-plane'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='front-face'] .iso-monitor-line {
            animation-delay: 55ms;
          }

          .iso-monitor-illustration:hover [data-monitor-layer='base-join'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='left-edge'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='right-edge'] .iso-monitor-line {
            animation-delay: 110ms;
          }

          .iso-monitor-illustration:hover [data-monitor-layer='center-drop'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='left-drop'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='right-drop'] .iso-monitor-line {
            animation-delay: 165ms;
          }

          .iso-monitor-illustration:hover [data-monitor-layer='top-plane'] .iso-monitor-line,
          .iso-monitor-illustration:hover [data-monitor-layer='inner-plane'] .iso-monitor-line {
            animation-delay: 220ms;
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
            d='M29.44 -22.26 L208.56 81.15 Q238.00 98.15 208.56 115.15 L29.44 218.56 Q0.00 235.56 -29.44 218.56 L-208.56 115.15 Q-238.00 98.15 -208.56 81.15 L-29.44 -22.26 Q0.00 -39.26 29.44 -22.26 Z'
            {...LINE_PROPS}
          />
        </g>
        <g data-monitor-layer='base-plane' pointerEvents='none'>
          <path
            d='M29.44 -2.63 L123.56 51.70 Q153.00 68.70 123.56 85.70 L29.44 140.04 Q0.00 157.04 -29.44 140.04 L-123.56 85.70 Q-153.00 68.70 -123.56 51.70 L-29.44 -2.63 Q0.00 -19.63 29.44 -2.63 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_LOW}
          />
        </g>
        <g
          data-monitor-layer='top-plane'
          className='iso-monitor-separating-panel iso-monitor-panel-right'
          pointerEvents='none'
        >
          <path
            d='M29.44 -71.33 L140.56 -7.19 Q170.00 9.81 170.00 -24.19 L170.00 -103.41 Q170.00 -137.41 140.56 -154.41 L29.44 -218.56 Q0.00 -235.56 0.00 -201.56 L0.00 -122.33 Q0.00 -88.33 29.44 -71.33 Z'
            {...LINE_PROPS}
          />
        </g>
        <g data-monitor-layer='center-drop' pointerEvents='none'>
          <path d='M0.00 176.67 L0.00 225.74' {...EDGE_LINE_PROPS} />
        </g>
        <g data-monitor-layer='base-join' pointerEvents='none'>
          <path d='M-187.00 88.33 L0.00 196.30 L187.00 88.33' {...EDGE_LINE_PROPS} />
          <path
            d='M187.00 88.33h0.001'
            className='iso-monitor-line'
            fill='none'
            pathLength={1}
            stroke={STROKE_PAINT}
            strokeWidth={ISO_ENDPOINT_STROKE_WIDTH}
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </g>
        <g data-monitor-layer='right-edge' pointerEvents='none'>
          <path d='M0.00 176.67 L187.00 68.70 L187.00 88.33' {...EDGE_LINE_PROPS} />
          <path
            d='M187.00 88.33h0.001'
            className='iso-monitor-line'
            fill='none'
            pathLength={1}
            stroke={STROKE_PAINT}
            strokeWidth={ISO_ENDPOINT_STROKE_WIDTH}
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </g>
        <g data-monitor-layer='left-edge' pointerEvents='none'>
          <path d='M0.00 176.67 L-187.00 68.70 L-187.00 88.33' {...EDGE_LINE_PROPS} />
          <path
            d='M-187.00 88.33h0.001'
            className='iso-monitor-line'
            fill='none'
            pathLength={1}
            stroke={STROKE_PAINT}
            strokeWidth={ISO_ENDPOINT_STROKE_WIDTH}
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </g>
        <g data-monitor-layer='left-drop' pointerEvents='none'>
          <path d='M-187.00 88.33 L-187.00 127.59' {...EDGE_LINE_PROPS} />
        </g>
        <g data-monitor-layer='right-drop' pointerEvents='none'>
          <path d='M187.00 88.33 L187.00 127.59' {...EDGE_LINE_PROPS} />
        </g>
        <g data-monitor-layer='inner-plane' pointerEvents='none'>
          <path
            d='M20.94 -46.80 L115.06 7.54 Q144.50 24.54 115.06 41.54 L20.94 95.87 Q-8.50 112.87 -37.94 95.87 L-132.06 41.54 Q-161.50 24.54 -132.06 7.54 L-37.94 -46.80 Q-8.50 -63.80 20.94 -46.80 Z'
            {...LINE_PROPS}
            fill={ISO_FILL_MID}
          />
        </g>
        <g
          data-monitor-layer='front-face'
          className='iso-monitor-separating-panel iso-monitor-panel-left'
          pointerEvents='none'
        >
          <path
            d='M-174.56 56.26 L-29.44 140.04 Q0.00 157.04 0.00 123.04 L0.00 34.00 Q0.00 0.00 -29.44 -17.00 L-174.56 -100.78 Q-204.00 -117.78 -204.00 -83.78 L-204.00 5.26 Q-204.00 39.26 -174.56 56.26 Z'
            {...LINE_PROPS}
          />
        </g>
        <g
          data-monitor-layer='top-lid'
          className='iso-monitor-separating-panel iso-monitor-panel-top'
          pointerEvents='none'
        >
          <path
            d='M29.44 -218.56 L98.06 -178.95 Q127.50 -161.95 98.06 -144.95 L-47.06 -61.17 Q-76.50 -44.17 -105.94 -61.17 L-174.56 -100.78 Q-204.00 -117.78 -174.56 -134.78 L-29.44 -218.56 Q0.00 -235.56 29.44 -218.56 Z'
            {...LINE_PROPS}
          />
        </g>
      </g>
    </svg>
  )
}
