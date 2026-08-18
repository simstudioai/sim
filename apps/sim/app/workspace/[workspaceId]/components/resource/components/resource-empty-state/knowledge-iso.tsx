/**
 * Isometric knowledge-base mark, built on the landing page's iso-illustration
 * recipe: `ISO_STROKE` contours at `ISO_LINE_STROKE_WIDTH`, faces filled from the
 * three-tier surface ramp, round caps and joins throughout.
 *
 * Geometry is authored in a large unit space so the shared 3.2 stroke constant
 * lands as a hairline once the mark is scaled down to empty-state size, exactly
 * as it does on the landing marks (they draw 3.2 into a ~526-unit viewBox).
 */
const COS_30 = Math.cos(Math.PI / 6)

type Point = readonly [number, number]

/** Standard isometric projection: +x right-and-down, +y left-and-down, +z up. */
function project(x: number, y: number, z: number): Point {
  return [(x - y) * COS_30, (x + y) * 0.5 - z]
}

function toPath(points: Point[]): string {
  return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')} Z`
}

interface Box {
  x: number
  y: number
  z: number
  w: number
  d: number
  h: number
}

/** The three faces an isometric viewer can see, brightest on top. */
function boxFaces(box: Box) {
  const { x, y, z, w, d, h } = box
  const x1 = x + w
  const y1 = y + d
  const z1 = z + h
  return {
    top: [project(x, y, z1), project(x1, y, z1), project(x1, y1, z1), project(x, y1, z1)],
    right: [project(x1, y, z1), project(x1, y1, z1), project(x1, y1, z), project(x1, y, z)],
    left: [project(x, y1, z1), project(x1, y1, z1), project(x1, y1, z), project(x, y1, z)],
  }
}

/** Three upright volumes, and one page drawn out of the set lying in front. */
const SLABS: Box[] = [0, 90, 180].map((offset) => ({
  x: offset,
  y: 0,
  z: 0,
  w: 46,
  d: 208,
  h: 236,
}))

const PAGE = {
  x: 242,
  y: 46,
  w: 168,
  d: 196,
} as const

const PAGE_QUAD: Point[] = [
  project(PAGE.x, PAGE.y, 0),
  project(PAGE.x + PAGE.w, PAGE.y, 0),
  project(PAGE.x + PAGE.w, PAGE.y + PAGE.d, 0),
  project(PAGE.x, PAGE.y + PAGE.d, 0),
]

/** Text ruled across the loose page, in its own plane so it lies with it. */
const PAGE_LINES: Point[][] = [0.3, 0.54, 0.78].map((t, index) => {
  const y = PAGE.y + PAGE.d * t
  const inset = 30
  const length = [0.8, 0.92, 0.66][index]
  return [
    project(PAGE.x + inset, y, 0),
    project(PAGE.x + inset + (PAGE.w - inset * 2) * length, y, 0),
  ]
})

const ISO_STROKE = 'color-mix(in srgb, var(--text-subtle) 76%, var(--text-muted))'
const ISO_FILL_LOW = 'var(--surface-6)'
const ISO_FILL_MID = 'color-mix(in srgb, var(--surface-3) 58%, var(--surface-6))'
const ISO_FILL_HIGH = 'var(--surface-3)'
const ISO_LINE_STROKE_WIDTH = 3.2

const ALL_POINTS: Point[] = [
  ...SLABS.flatMap((box) => Object.values(boxFaces(box)).flat()),
  ...PAGE_QUAD,
]

const PADDING = 14
const MIN_X = Math.min(...ALL_POINTS.map(([x]) => x)) - PADDING
const MAX_X = Math.max(...ALL_POINTS.map(([x]) => x)) + PADDING
const MIN_Y = Math.min(...ALL_POINTS.map(([, y]) => y)) - PADDING
const MAX_Y = Math.max(...ALL_POINTS.map(([, y]) => y)) + PADDING
const VIEW_BOX = `${MIN_X.toFixed(2)} ${MIN_Y.toFixed(2)} ${(MAX_X - MIN_X).toFixed(2)} ${(MAX_Y - MIN_Y).toFixed(2)}`

const LINE_PROPS = {
  fill: 'none' as const,
  stroke: ISO_STROKE,
  strokeWidth: ISO_LINE_STROKE_WIDTH,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

interface KnowledgeIsoMarkProps {
  height?: number
}

export function KnowledgeIsoMark({ height = 148 }: KnowledgeIsoMarkProps) {
  const width = height * ((MAX_X - MIN_X) / (MAX_Y - MIN_Y))
  return (
    <svg
      viewBox={VIEW_BOX}
      width={width}
      height={height}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className='block max-w-none shrink-0'
    >
      {SLABS.map((box) => {
        const faces = boxFaces(box)
        return (
          <g key={box.x}>
            <path d={toPath(faces.left)} fill={ISO_FILL_LOW} stroke='none' />
            <path d={toPath(faces.right)} fill={ISO_FILL_MID} stroke='none' />
            <path d={toPath(faces.top)} fill={ISO_FILL_HIGH} stroke='none' />
            <path d={toPath(faces.left)} {...LINE_PROPS} />
            <path d={toPath(faces.right)} {...LINE_PROPS} />
            <path d={toPath(faces.top)} {...LINE_PROPS} />
          </g>
        )
      })}

      <path d={toPath(PAGE_QUAD)} fill='var(--bg)' stroke='none' />
      <path d={toPath(PAGE_QUAD)} {...LINE_PROPS} />
      {PAGE_LINES.map(([from, to]) => (
        <path
          key={`${from[0]}-${from[1]}`}
          d={`M ${from[0].toFixed(2)} ${from[1].toFixed(2)} L ${to[0].toFixed(2)} ${to[1].toFixed(2)}`}
          {...LINE_PROPS}
          strokeWidth={ISO_LINE_STROKE_WIDTH * 0.8}
        />
      ))}
    </svg>
  )
}
