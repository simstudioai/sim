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
 * Inline supplied illustration for the Context area - a central store
 * cube whose three faces cycle fills like data loading in, flanked by a back
 * slab and two outline "context source" glyphs. Hovering spreads the sources
 * away from the core and redraws every contour from zero.
 */
export function IsoIngestIllustration({ size = 168, className }: IsoIngestIllustrationProps) {
  return (
    <svg
      viewBox='-263.2717227504693 -263.2717227504693 526.5434455009386 526.5434455009386'
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
              transform: translate(18px, -11px);
            }

            .iso-ingest-illustration:hover .iso-ingest-left-context {
              transform: translate(-26px, 13px);
            }

            .iso-ingest-illustration:hover .iso-ingest-right-context {
              transform: translate(26px, 13px);
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
      <g filter='url(#iso-ingest-line-connection)'>
        <g data-ingest-layer='storage-fills' pointerEvents='none'>
          <path
            d='M44.30 -19.23 L183.46 61.12 Q189.88 64.82 189.88 57.41 L189.88 -103.28 Q189.88 -110.69 183.46 -114.40 L44.30 -194.74 Q37.88 -198.45 37.88 -191.04 L37.88 -30.34 Q37.88 -22.93 44.30 -19.23 Z'
            {...FILL_PROPS}
            className='iso-ingest-back-panel'
            fill={ISO_FILL_LOW}
          />
          <path
            d='M201.99 57.83 L196.30 61.12 Q189.88 64.82 189.88 57.41 L189.88 -103.28 Q189.88 -110.69 196.30 -114.40 L201.99 -117.68 Q208.41 -121.39 208.41 -113.98 L208.41 46.72 Q208.41 54.13 201.99 57.83 Z'
            {...FILL_PROPS}
            className='iso-ingest-back-panel'
            fill={ISO_FILL_MID}
          />
          <path
            d='M62.82 -205.44 L201.99 -125.09 Q208.41 -121.39 201.99 -117.68 L196.30 -114.40 Q189.88 -110.69 183.46 -114.40 L44.30 -194.74 Q37.88 -198.45 44.30 -202.15 L49.99 -205.44 Q56.41 -209.14 62.82 -205.44 Z'
            {...FILL_PROPS}
            className='iso-ingest-back-panel'
            fill={ISO_FILL_HIGH}
          />
          <path
            d='M-145.58 91.46 L-6.42 171.81 Q0.00 175.51 0.00 168.10 L0.00 7.41 Q0.00 -0.00 -6.42 -3.71 L-145.58 -84.05 Q-152.00 -87.76 -152.00 -80.35 L-152.00 80.35 Q-152.00 87.76 -145.58 91.46 Z'
            {...FILL_PROPS}
            className='iso-ingest-center-face iso-ingest-center-face-left'
            fill={ISO_FILL_LOW}
          />
          <path
            d='M145.58 91.46 L6.42 171.81 Q0.00 175.51 0.00 168.10 L0.00 7.41 Q0.00 -0.00 6.42 -3.71 L145.58 -84.05 Q152.00 -87.76 152.00 -80.35 L152.00 80.35 Q152.00 87.76 145.58 91.46 Z'
            {...FILL_PROPS}
            className='iso-ingest-center-face iso-ingest-center-face-right'
            fill={ISO_FILL_MID}
          />
          <path
            d='M6.42 -171.81 L145.58 -91.46 Q152.00 -87.76 145.58 -84.05 L6.42 -3.71 Q0.00 -0.00 -6.42 -3.71 L-145.58 -84.05 Q-152.00 -87.76 -145.58 -91.46 L-6.42 -171.81 Q0.00 -175.51 6.42 -171.81 Z'
            {...FILL_PROPS}
            className='iso-ingest-center-face iso-ingest-center-face-top'
            fill={ISO_FILL_HIGH}
          />
        </g>
        <g data-ingest-layer='storage-edges' pointerEvents='none'>
          <path
            d='M62.82 -29.92 L201.99 50.42 Q208.41 54.13 201.99 57.83 L196.30 61.12 Q189.88 64.82 183.46 61.12 L44.30 -19.23 Q37.88 -22.93 44.30 -26.64 L49.99 -29.92 Q56.41 -33.63 62.82 -29.92 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M62.82 -205.44 L201.99 -125.09 Q208.41 -121.39 201.99 -117.68 L196.30 -114.40 Q189.88 -110.69 183.46 -114.40 L44.30 -194.74 Q37.88 -198.45 44.30 -202.15 L49.99 -205.44 Q56.41 -209.14 62.82 -205.44 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M62.82 -29.92 L201.99 50.42 Q208.41 54.13 208.41 46.72 L208.41 -113.98 Q208.41 -121.39 201.99 -125.09 L62.82 -205.44 Q56.41 -209.14 56.41 -201.73 L56.41 -41.04 Q56.41 -33.63 62.82 -29.92 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M44.30 -19.23 L183.46 61.12 Q189.88 64.82 189.88 57.41 L189.88 -103.28 Q189.88 -110.69 183.46 -114.40 L44.30 -194.74 Q37.88 -198.45 37.88 -191.04 L37.88 -30.34 Q37.88 -22.93 44.30 -19.23 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M49.99 -29.92 L44.30 -26.64 Q37.88 -22.93 37.88 -30.34 L37.88 -191.04 Q37.88 -198.45 44.30 -202.15 L49.99 -205.44 Q56.41 -209.14 56.41 -201.73 L56.41 -41.04 Q56.41 -33.63 49.99 -29.92 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M201.99 57.83 L196.30 61.12 Q189.88 64.82 189.88 57.41 L189.88 -103.28 Q189.88 -110.69 196.30 -114.40 L201.99 -117.68 Q208.41 -121.39 208.41 -113.98 L208.41 46.72 Q208.41 54.13 201.99 57.83 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-back-panel'
          />
          <path
            d='M6.42 3.70 L145.58 84.05 Q152.00 87.76 145.58 91.46 L6.42 171.81 Q0.00 175.51 -6.42 171.81 L-145.58 91.46 Q-152.00 87.76 -145.58 84.05 L-6.42 3.70 Q0.00 0.00 6.42 3.70 Z'
            {...LINE_PROPS}
          />
          <path
            d='M6.42 -171.81 L145.58 -91.46 Q152.00 -87.76 145.58 -84.05 L6.42 -3.71 Q0.00 -0.00 -6.42 -3.71 L-145.58 -84.05 Q-152.00 -87.76 -145.58 -91.46 L-6.42 -171.81 Q0.00 -175.51 6.42 -171.81 Z'
            {...LINE_PROPS}
          />
          <path
            d='M6.42 3.70 L145.58 84.05 Q152.00 87.76 152.00 80.35 L152.00 -80.35 Q152.00 -87.76 145.58 -91.46 L6.42 -171.81 Q0.00 -175.51 0.00 -168.10 L0.00 -7.41 Q0.00 0.00 6.42 3.70 Z'
            {...LINE_PROPS}
          />
          <path
            d='M-145.58 91.46 L-6.42 171.81 Q0.00 175.51 0.00 168.10 L0.00 7.41 Q0.00 -0.00 -6.42 -3.71 L-145.58 -84.05 Q-152.00 -87.76 -152.00 -80.35 L-152.00 80.35 Q-152.00 87.76 -145.58 91.46 Z'
            {...LINE_PROPS}
          />
          <path
            d='M-6.42 3.70 L-145.58 84.05 Q-152.00 87.76 -152.00 80.35 L-152.00 -80.35 Q-152.00 -87.76 -145.58 -91.46 L-6.42 -171.81 Q0.00 -175.51 0.00 -168.10 L0.00 -7.41 Q0.00 0.00 -6.42 3.70 Z'
            {...LINE_PROPS}
          />
          <path
            d='M145.58 91.46 L6.42 171.81 Q0.00 175.51 0.00 168.10 L0.00 7.41 Q0.00 -0.00 6.42 -3.71 L145.58 -84.05 Q152.00 -87.76 152.00 -80.35 L152.00 80.35 Q152.00 87.76 145.58 91.46 Z'
            {...LINE_PROPS}
          />
        </g>
        <g data-ingest-layer='storage-details' pointerEvents='none'>
          <path
            d='M75.88 132.29 C75.88 83.82 109.91 24.89 151.88 0.65 C193.86 -23.58 227.88 -3.94 227.88 44.53 C227.88 93.00 193.86 151.93 151.88 176.17 C109.91 200.40 75.88 180.75 75.88 132.29 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-right-context'
          />
          <path
            d='M-194.26 149.09 L-110.45 197.48 Q-77.54 216.48 -77.54 178.48 L-77.54 81.71 Q-77.54 43.71 -110.45 24.71 L-194.26 -23.68 Q-227.17 -42.68 -227.17 -4.68 L-227.17 92.09 Q-227.17 130.09 -194.26 149.09 Z'
            {...LINE_PROPS}
            className='iso-ingest-line iso-ingest-left-context'
          />
          <path
            d='M-50.58 -122.45 L-44.42 -118.89 Q-38.00 -115.18 -44.42 -111.48 L-98.08 -80.49 Q-104.50 -76.79 -110.92 -80.49 L-117.08 -84.05 Q-123.50 -87.76 -117.08 -91.46 L-63.42 -122.45 Q-57.00 -126.15 -50.58 -122.45 Z'
            {...LINE_PROPS}
          />
        </g>
      </g>
    </svg>
  )
}
