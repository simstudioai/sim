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

const ISO_STROKE = 'color-mix(in srgb, var(--text-subtle) 76%, var(--text-muted))'
const ISO_FILL_LOW = 'var(--surface-6)'
const ISO_FILL_MID = 'color-mix(in srgb, var(--surface-3) 58%, var(--surface-6))'
const ISO_FILL_HIGH = 'var(--surface-3)'
const ISO_LINE_STROKE_WIDTH = 3.2

const ALL_POINTS: Point[] = SLABS.flatMap((box) => Object.values(boxFaces(box)).flat())

const PADDING = 14
const MIN_X = Math.min(...ALL_POINTS.map(([x]) => x)) - PADDING
const MAX_X = Math.max(...ALL_POINTS.map(([x]) => x)) + PADDING
const MIN_Y = Math.min(...ALL_POINTS.map(([, y]) => y)) - PADDING
const MAX_Y = Math.max(...ALL_POINTS.map(([, y]) => y)) + PADDING
const VIEW_BOX = `${MIN_X.toFixed(2)} ${MIN_Y.toFixed(2)} ${(MAX_X - MIN_X).toFixed(2)} ${(MAX_Y - MIN_Y).toFixed(2)}`

/**
 * Places the knowledge-base mark in the plane of the front volume's cover.
 *
 * The cover is the face at max x, spanned by the volume's depth (across) and its
 * height (up). Walking those two edges gives the face's basis vectors in
 * projected space, and an affine matrix built from them lays flat artwork into
 * the face — so the icon skews with the isometric instead of floating on top of
 * it. Everything derives from the geometry, so retuning the volumes carries the
 * icon with them.
 */
const ICON_VIEW_BOX = { x: -1, y: -2, size: 24 } as const
/** Size of the mark on the cover, in world units. */
const ICON_WORLD_SIZE = 122

const COVER = SLABS[SLABS.length - 1]

const COVER_TRANSFORM = (() => {
  const faceX = COVER.x + COVER.w
  const origin = project(faceX, COVER.y, COVER.z)
  const across: Point = [-COVER.d * COS_30, COVER.d * 0.5]
  const up: Point = [0, -COVER.h]

  const spanAcross = ICON_WORLD_SIZE / COVER.d
  const spanUp = ICON_WORLD_SIZE / COVER.h
  const insetAcross = (1 - spanAcross) / 2
  const insetUp = (1 - spanUp) / 2 + spanUp

  const anchorX = origin[0] + insetAcross * across[0] + insetUp * up[0]
  const anchorY = origin[1] + insetAcross * across[1] + insetUp * up[1]

  const a = (spanAcross * across[0]) / ICON_VIEW_BOX.size
  const b = (spanAcross * across[1]) / ICON_VIEW_BOX.size
  const c = 0
  const d = ICON_WORLD_SIZE / ICON_VIEW_BOX.size
  const e = anchorX - ICON_VIEW_BOX.x * a - ICON_VIEW_BOX.y * c
  const f = anchorY - ICON_VIEW_BOX.x * b - ICON_VIEW_BOX.y * d

  return `matrix(${a.toFixed(4)} ${b.toFixed(4)} ${c.toFixed(4)} ${d.toFixed(4)} ${e.toFixed(3)} ${f.toFixed(3)})`
})()

/** Pre-divided so the mark's contours land at the same weight as the volumes'. */
const ICON_STROKE_WIDTH = (ISO_LINE_STROKE_WIDTH * ICON_VIEW_BOX.size) / ICON_WORLD_SIZE

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

      <g
        transform={COVER_TRANSFORM}
        fill='none'
        stroke={ISO_STROKE}
        strokeWidth={ICON_STROKE_WIDTH}
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <ellipse cx='10.25' cy='3.75' rx='8.5' ry='3' />
        <path d='M1.75 3.75V9.75C1.75 11.41 5.55 12.75 10.25 12.75C14.95 12.75 18.75 11.41 18.75 9.75V3.75' />
        <path d='M1.75 9.75V15.75C1.75 17.41 5.55 18.75 10.25 18.75C14.95 18.75 18.75 17.41 18.75 15.75V9.75' />
      </g>
    </svg>
  )
}
