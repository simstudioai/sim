import { cn } from '@/lib/core/utils/cn'
import {
  createIsoLineProps,
  ISO_FILL_PROPS as FILL_PROPS,
  ISO_FILL_HIGH,
  ISO_FILL_LOW,
  ISO_FILL_MID,
  ISO_FILL_PULSE_HIGH,
  ISO_FILL_PULSE_LOW,
  ISO_FILL_PULSE_MID,
  ISO_STROKE,
} from '@/app/(landing)/components/mothership/components/iso-marks/iso-illustration-style'

export interface IsoIngestIllustrationProps {
  size?: number
  className?: string
}

const STROKE_PAINT = ISO_STROKE

const LINE_PROPS = createIsoLineProps('iso-ingest-line', STROKE_PAINT)

/**
 * Inline supplied illustration for the Ingest context area.
 */
export function IsoIngestIllustration({ size = 156, className }: IsoIngestIllustrationProps) {
  return (
    <svg
      viewBox='-180 -155 360 390'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      aria-hidden={true}
      focusable='false'
      className={cn('iso-ingest-illustration block max-w-none shrink-0', className)}
    >
      <style>
        {`
          .iso-ingest-line {
            stroke-dasharray: 1;
            stroke-dashoffset: 0;
          }

          .iso-ingest-back-panel,
          .iso-ingest-left-context,
          .iso-ingest-right-context,
          .iso-ingest-center-face {
            transform-box: fill-box;
            transform-origin: center;
          }

          .iso-ingest-center-face {
            will-change: fill;
          }

          @media (prefers-reduced-motion: no-preference) {
            .iso-ingest-back-panel,
            .iso-ingest-left-context,
            .iso-ingest-right-context {
              transition: transform 760ms cubic-bezier(0.16, 1, 0.3, 1);
              will-change: transform;
            }

            .iso-ingest-illustration:hover .iso-ingest-back-panel {
              transform: translate(-12px, 9px);
            }

            .iso-ingest-illustration:hover .iso-ingest-left-context {
              transform: translate(28px, -16px);
            }

            .iso-ingest-illustration:hover .iso-ingest-right-context {
              transform: translate(-28px, -16px);
            }

            .iso-ingest-center-face-top {
              animation: iso-ingest-center-top-load 2300ms steps(1, end) infinite;
            }

            .iso-ingest-center-face-left {
              animation: iso-ingest-center-left-load 1900ms steps(1, end) infinite;
            }

            .iso-ingest-center-face-right {
              animation: iso-ingest-center-right-load 2700ms steps(1, end) infinite;
            }
          }

          .iso-ingest-illustration:hover .iso-ingest-line {
            animation: iso-ingest-line-draw 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
          }

          .iso-ingest-illustration:hover [data-ingest-layer='storage-fills'] .iso-ingest-line {
            animation-delay: 0ms;
          }

          .iso-ingest-illustration:hover [data-ingest-layer='storage-edges'] .iso-ingest-line {
            animation-delay: 70ms;
          }

          .iso-ingest-illustration:hover [data-ingest-layer='storage-details'] .iso-ingest-line {
            animation-delay: 160ms;
          }

          @keyframes iso-ingest-line-draw {
            from {
              stroke-dashoffset: 1;
            }

            to {
              stroke-dashoffset: 0;
            }
          }

          @keyframes iso-ingest-center-top-load {
            0%,
            18% {
              fill: ${ISO_FILL_HIGH};
            }

            19%,
            43% {
              fill: ${ISO_FILL_PULSE_MID};
            }

            44%,
            68% {
              fill: ${ISO_FILL_PULSE_LOW};
            }

            69%,
            100% {
              fill: ${ISO_FILL_HIGH};
            }
          }

          @keyframes iso-ingest-center-left-load {
            0%,
            27% {
              fill: ${ISO_FILL_LOW};
            }

            28%,
            52% {
              fill: ${ISO_FILL_PULSE_LOW};
            }

            53%,
            79% {
              fill: ${ISO_FILL_PULSE_HIGH};
            }

            80%,
            100% {
              fill: ${ISO_FILL_MID};
            }
          }

          @keyframes iso-ingest-center-right-load {
            0%,
            22% {
              fill: ${ISO_FILL_MID};
            }

            23%,
            48% {
              fill: ${ISO_FILL_PULSE_HIGH};
            }

            49%,
            72% {
              fill: ${ISO_FILL_PULSE_LOW};
            }

            73%,
            100% {
              fill: ${ISO_FILL_MID};
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .iso-ingest-back-panel,
            .iso-ingest-left-context,
            .iso-ingest-right-context,
            .iso-ingest-center-face,
            .iso-ingest-illustration:hover .iso-ingest-line {
              animation: none;
              transition: none;
            }
          }
        `}
      </style>
      <defs>
        <filter id='iso-ingest-line-connection' x='-100%' y='-100%' width='300%' height='300%'>
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
      <g filter='url(#iso-ingest-line-connection)' transform='translate(0 30)'>
        <g data-ingest-layer='storage-fills' pointerEvents='none'>
          <path
            d='M36.94 -17.93 L133.06 37.56 Q136.00 39.26 136.00 35.86 L136.00 -75.12 Q136.00 -78.52 133.06 -80.22 L36.94 -135.71 Q34.00 -137.41 34.00 -134.01 L34.00 -23.03 Q34.00 -19.63 36.94 -17.93 Z'
            {...FILL_PROPS}
            className='iso-ingest-back-panel'
            fill={ISO_FILL_LOW}
          />
          <path
            d='M150.06 31.14 L138.94 37.56 Q136.00 39.26 136.00 35.86 L136.00 -75.12 Q136.00 -78.52 138.94 -80.22 L150.06 -86.63 Q153.00 -88.33 153.00 -84.93 L153.00 26.04 Q153.00 29.44 150.06 31.14 Z'
            {...FILL_PROPS}
            className='iso-ingest-back-panel'
            fill={ISO_FILL_MID}
          />
          <path
            d='M53.94 -145.52 L150.06 -90.03 Q153.00 -88.33 150.06 -86.63 L138.94 -80.22 Q136.00 -78.52 133.06 -80.22 L36.94 -135.71 Q34.00 -137.41 36.94 -139.11 L48.06 -145.52 Q51.00 -147.22 53.94 -145.52 Z'
            {...FILL_PROPS}
            className='iso-ingest-back-panel'
            fill={ISO_FILL_HIGH}
          />
          <path
            d='M-99.06 60.59 L-2.94 116.08 Q0.00 117.78 0.00 114.38 L0.00 3.40 Q0.00 0.00 -2.94 -1.70 L-99.06 -57.19 Q-102.00 -58.89 -102.00 -55.49 L-102.00 55.49 Q-102.00 58.89 -99.06 60.59 Z'
            {...FILL_PROPS}
            className='iso-ingest-center-face iso-ingest-center-face-left'
            fill={ISO_FILL_LOW}
          />
          <path
            d='M99.06 60.59 L2.94 116.08 Q0.00 117.78 0.00 114.38 L0.00 3.40 Q0.00 0.00 2.94 -1.70 L99.06 -57.19 Q102.00 -58.89 102.00 -55.49 L102.00 55.49 Q102.00 58.89 99.06 60.59 Z'
            {...FILL_PROPS}
            className='iso-ingest-center-face iso-ingest-center-face-right'
            fill={ISO_FILL_MID}
          />
          <path
            d='M2.94 -116.08 L99.06 -60.59 Q102.00 -58.89 99.06 -57.19 L2.94 -1.70 Q0.00 0.00 -2.94 -1.70 L-99.06 -57.19 Q-102.00 -58.89 -99.06 -60.59 L-2.94 -116.08 Q0.00 -117.78 2.94 -116.08 Z'
            {...FILL_PROPS}
            className='iso-ingest-center-face iso-ingest-center-face-top'
            fill={ISO_FILL_HIGH}
          />
        </g>
        <g data-ingest-layer='storage-edges' pointerEvents='none'>
          <path
            d='M53.94 -27.74 L150.06 27.74 Q153.00 29.44 150.06 31.14 L138.94 37.56 Q136.00 39.26 133.06 37.56 L36.94 -17.93 Q34.00 -19.63 36.94 -21.33 L48.06 -27.74 Q51.00 -29.44 53.94 -27.74 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M53.94 -145.52 L150.06 -90.03 Q153.00 -88.33 150.06 -86.63 L138.94 -80.22 Q136.00 -78.52 133.06 -80.22 L36.94 -135.71 Q34.00 -137.41 36.94 -139.11 L48.06 -145.52 Q51.00 -147.22 53.94 -145.52 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M53.94 -27.74 L150.06 27.74 Q153.00 29.44 153.00 26.04 L153.00 -84.93 Q153.00 -88.33 150.06 -90.03 L53.94 -145.52 Q51.00 -147.22 51.00 -143.82 L51.00 -32.84 Q51.00 -29.44 53.94 -27.74 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M36.94 -17.93 L133.06 37.56 Q136.00 39.26 136.00 35.86 L136.00 -75.12 Q136.00 -78.52 133.06 -80.22 L36.94 -135.71 Q34.00 -137.41 34.00 -134.01 L34.00 -23.03 Q34.00 -19.63 36.94 -17.93 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M48.06 -27.74 L36.94 -21.33 Q34.00 -19.63 34.00 -23.03 L34.00 -134.01 Q34.00 -137.41 36.94 -139.11 L48.06 -145.52 Q51.00 -147.22 51.00 -143.82 L51.00 -32.84 Q51.00 -29.44 48.06 -27.74 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M150.06 31.14 L138.94 37.56 Q136.00 39.26 136.00 35.86 L136.00 -75.12 Q136.00 -78.52 138.94 -80.22 L150.06 -86.63 Q153.00 -88.33 153.00 -84.93 L153.00 26.04 Q153.00 29.44 150.06 31.14 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M2.94 1.70 L99.06 57.19 Q102.00 58.89 99.06 60.59 L2.94 116.08 Q0.00 117.78 -2.94 116.08 L-99.06 60.59 Q-102.00 58.89 -99.06 57.19 L-2.94 1.70 Q0.00 0.00 2.94 1.70 Z'
            {...LINE_PROPS}
          />
          <path
            d='M2.94 -116.08 L99.06 -60.59 Q102.00 -58.89 99.06 -57.19 L2.94 -1.70 Q0.00 0.00 -2.94 -1.70 L-99.06 -57.19 Q-102.00 -58.89 -99.06 -60.59 L-2.94 -116.08 Q0.00 -117.78 2.94 -116.08 Z'
            {...LINE_PROPS}
          />
          <path
            d='M2.94 1.70 L99.06 57.19 Q102.00 58.89 102.00 55.49 L102.00 -55.49 Q102.00 -58.89 99.06 -60.59 L2.94 -116.08 Q0.00 -117.78 0.00 -114.38 L0.00 -3.40 Q0.00 0.00 2.94 1.70 Z'
            {...LINE_PROPS}
          />
          <path
            d='M-99.06 60.59 L-2.94 116.08 Q0.00 117.78 0.00 114.38 L0.00 3.40 Q0.00 0.00 -2.94 -1.70 L-99.06 -57.19 Q-102.00 -58.89 -102.00 -55.49 L-102.00 55.49 Q-102.00 58.89 -99.06 60.59 Z'
            {...LINE_PROPS}
          />
          <path
            d='M-2.94 1.70 L-99.06 57.19 Q-102.00 58.89 -102.00 55.49 L-102.00 -55.49 Q-102.00 -58.89 -99.06 -60.59 L-2.94 -116.08 Q0.00 -117.78 0.00 -114.38 L0.00 -3.40 Q0.00 0.00 -2.94 1.70 Z'
            {...LINE_PROPS}
          />
          <path
            d='M99.06 60.59 L2.94 116.08 Q0.00 117.78 0.00 114.38 L0.00 3.40 Q0.00 0.00 2.94 -1.70 L99.06 -57.19 Q102.00 -58.89 102.00 -55.49 L102.00 55.49 Q102.00 58.89 99.06 60.59 Z'
            {...LINE_PROPS}
          />
        </g>
        <g data-ingest-layer='storage-details' pointerEvents='none'>
          <path
            d='M68.00 98.15 C68.00 65.63 90.83 26.08 119.00 9.81 C147.17 -6.45 170.00 6.74 170.00 39.26 C170.00 71.78 147.17 111.33 119.00 127.59 C90.83 143.86 68.00 130.67 68.00 98.15 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-right-context'
          />
          <path
            d='M-140.56 115.15 L-97.44 140.04 Q-68.00 157.04 -68.00 123.04 L-68.00 73.26 Q-68.00 39.26 -97.44 22.26 L-140.56 -2.63 Q-170.00 -19.63 -170.00 14.37 L-170.00 64.15 Q-170.00 98.15 -140.56 115.15 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-left-context'
          />
          <path
            d='M-26.35 -83.92 L-24.65 -82.94 Q-17.00 -78.52 -24.65 -74.10 L-60.35 -53.49 Q-68.00 -49.07 -75.65 -53.49 L-77.35 -54.47 Q-85.00 -58.89 -77.35 -63.31 L-41.65 -83.92 Q-34.00 -88.33 -26.35 -83.92 Z'
            {...LINE_PROPS}
          />
        </g>
      </g>
    </svg>
  )
}
