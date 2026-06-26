import { cn } from '@/lib/core/utils/cn'
import {
  createIsoLineProps,
  ISO_FILL_HIGH,
  ISO_FILL_LOW,
  ISO_FILL_MID,
  ISO_STROKE,
} from '@/app/(landing)/components/mothership/components/iso-marks/iso-illustration-style'

export interface IsoBuildIllustrationProps {
  size?: number
  className?: string
}

const STROKE_PAINT = ISO_STROKE

const LINE_PROPS = createIsoLineProps('iso-build-line', STROKE_PAINT)

/** Isometric tile module the floor grid and the columns are built on. */
const TILE_WIDTH = 38
const TILE_HEIGHT = 21.94

const FLOOR_PANEL_PATH = 'M0.00 -131.64 L228.00 0.00 L0.00 131.64 L-228.00 0.00 Z'

/** Floor grid lines, split by the axis they animate along. */
const GRID_LINES_Y = [
  'M38.00 -109.70 L-190.00 21.94',
  'M76.00 -87.76 L-152.00 43.88',
  'M114.00 -65.82 L-114.00 65.82',
  'M152.00 -43.88 L-76.00 87.76',
  'M190.00 -21.94 L-38.00 109.70',
] as const

const GRID_LINES_X = [
  'M-38.00 -109.70 L190.00 21.94',
  'M-76.00 -87.76 L152.00 43.88',
  'M-114.00 -65.82 L114.00 65.82',
  'M-152.00 -43.88 L76.00 87.76',
  'M-190.00 -21.94 L38.00 109.70',
] as const

/**
 * The 16 columns, in painter's order (back to front), as `{ cx, topY, height }`
 * where `topY` is the centre of the column's top rhombus and `height` is its
 * downward extrusion. Tuned to the supplied "skyline" arrangement.
 */
const COLUMNS = [
  { cx: 152, topY: 0, height: 21.94 },
  { cx: 0, topY: -153.57, height: 43.88 },
  { cx: 76, topY: -153.57, height: 87.76 },
  { cx: 114, topY: -87.76, height: 43.88 },
  { cx: -38, topY: -109.7, height: 21.94 },
  { cx: 0, topY: -76.79, height: 10.97 },
  { cx: -190, topY: -10.97, height: 10.97 },
  { cx: -152, topY: 10.97, height: 10.97 },
  { cx: -38, topY: -10.97, height: 10.97 },
  { cx: 38, topY: -10.97, height: 10.97 },
  { cx: 0, topY: 10.97, height: 10.97 },
  { cx: 76, topY: -21.94, height: 43.88 },
  { cx: 38, topY: 10.97, height: 32.91 },
  { cx: 0, topY: 43.88, height: 21.94 },
  { cx: 76, topY: 43.88, height: 21.94 },
  { cx: 0, topY: 98.73, height: 10.97 },
] as const

const svgNumber = (value: number) => value.toFixed(2)

interface ColumnFaces {
  top: string
  left: string
  right: string
}

const getColumnFaces = (cx: number, topY: number, height: number): ColumnFaces => {
  const baseY = topY + height

  return {
    top: `M${svgNumber(cx)} ${svgNumber(topY - TILE_HEIGHT)} L${svgNumber(cx + TILE_WIDTH)} ${svgNumber(topY)} L${svgNumber(cx)} ${svgNumber(topY + TILE_HEIGHT)} L${svgNumber(cx - TILE_WIDTH)} ${svgNumber(topY)} Z`,
    left: `M${svgNumber(cx - TILE_WIDTH)} ${svgNumber(topY)} L${svgNumber(cx)} ${svgNumber(topY + TILE_HEIGHT)} L${svgNumber(cx)} ${svgNumber(baseY + TILE_HEIGHT)} L${svgNumber(cx - TILE_WIDTH)} ${svgNumber(baseY)} Z`,
    right: `M${svgNumber(cx + TILE_WIDTH)} ${svgNumber(topY)} L${svgNumber(cx)} ${svgNumber(topY + TILE_HEIGHT)} L${svgNumber(cx)} ${svgNumber(baseY + TILE_HEIGHT)} L${svgNumber(cx + TILE_WIDTH)} ${svgNumber(baseY)} Z`,
  }
}

/**
 * Inline supplied illustration for the Build area — a column "skyline" rising
 * off an isometric floor grid. The two grid axes drift along their own diagonal
 * on a slow loop (the live-construction read); hovering redraws every contour
 * from zero. Pure CSS, so this stays a server component.
 */
export function IsoBuildIllustration({ size = 176, className }: IsoBuildIllustrationProps) {
  return (
    <svg
      viewBox='-263.2717227504693 -263.2717227504693 526.5434455009386 526.5434455009386'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      aria-hidden={true}
      focusable='false'
      className={cn('iso-build-illustration block max-w-none shrink-0', className)}
    >
      <style>
        {`
          .iso-build-line {
            stroke-dasharray: 1;
            stroke-dashoffset: 0;
          }

          @media (prefers-reduced-motion: no-preference) {
            [data-build-axis='y'] {
              animation: iso-build-grid-flow-y 6200ms cubic-bezier(0.37, 0, 0.22, 1) infinite;
            }

            [data-build-axis='x'] {
              animation: iso-build-grid-flow-x 6200ms cubic-bezier(0.37, 0, 0.22, 1) infinite;
            }
          }

          .iso-build-illustration:hover .iso-build-line {
            animation: iso-build-line-draw 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
          }

          .iso-build-illustration:hover [data-build-layer='grid'] .iso-build-line {
            animation-delay: 0ms;
          }

          .iso-build-illustration:hover [data-build-layer='columns'] .iso-build-line {
            animation-delay: 105ms;
          }

          @keyframes iso-build-line-draw {
            from {
              stroke-dashoffset: 1;
            }

            to {
              stroke-dashoffset: 0;
            }
          }

          @keyframes iso-build-grid-flow-y {
            0%,
            100% {
              transform: translate(0, 0);
            }

            50% {
              transform: translate(-6px, 3.5px);
            }
          }

          @keyframes iso-build-grid-flow-x {
            0%,
            100% {
              transform: translate(0, 0);
            }

            50% {
              transform: translate(6px, 3.5px);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            [data-build-axis='y'],
            [data-build-axis='x'],
            .iso-build-illustration:hover .iso-build-line {
              animation: none;
            }
          }
        `}
      </style>
      <defs>
        <clipPath id='iso-build-floor-clip'>
          <path d={FLOOR_PANEL_PATH} />
        </clipPath>
        <filter id='iso-build-line-connection' x='-100%' y='-100%' width='300%' height='300%'>
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
      <g filter='url(#iso-build-line-connection)'>
        <g data-build-layer='grid' pointerEvents='none'>
          <path d={FLOOR_PANEL_PATH} fill={ISO_FILL_HIGH} stroke='none' pointerEvents='none' />
          <g clipPath='url(#iso-build-floor-clip)'>
            <g data-build-axis='y'>
              {GRID_LINES_Y.map((path) => (
                <path key={path} d={path} {...LINE_PROPS} strokeLinecap='butt' />
              ))}
            </g>
            <g data-build-axis='x'>
              {GRID_LINES_X.map((path) => (
                <path key={path} d={path} {...LINE_PROPS} strokeLinecap='butt' />
              ))}
            </g>
          </g>
          <path d={FLOOR_PANEL_PATH} {...LINE_PROPS} strokeLinejoin='miter' />
        </g>
        <g data-build-layer='columns' pointerEvents='none'>
          {COLUMNS.map((column) => {
            const faces = getColumnFaces(column.cx, column.topY, column.height)
            const key = `${column.cx}:${column.topY}:${column.height}`

            return (
              <g key={key} pointerEvents='none'>
                <path d={faces.left} {...LINE_PROPS} fill={ISO_FILL_LOW} />
                <path d={faces.right} {...LINE_PROPS} fill={ISO_FILL_MID} />
                <path d={faces.top} {...LINE_PROPS} fill={ISO_FILL_HIGH} />
              </g>
            )
          })}
        </g>
      </g>
    </svg>
  )
}
