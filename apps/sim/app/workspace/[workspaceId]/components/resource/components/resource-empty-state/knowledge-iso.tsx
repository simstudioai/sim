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

/**
 * Thin along y rather than x, so the cover is the face at max y — the one the
 * projection turns to the left. Stacking along y then walks the set left-and-down
 * toward the viewer, so drawing in offset order paints back to front.
 */
const SLABS: Box[] = [0, 90, 180].map((offset) => ({
  x: 0,
  y: offset,
  z: 0,
  w: 208,
  d: 46,
  h: 236,
}))

/**
 * Lighter and thinner than the landing marks draw them.
 *
 * Those marks are the focal art of their section; here the mark sits beside a
 * ruled grid and a skeleton feed whose lines are 1px of `--border-1`. Carrying
 * the landing's full-weight contour made the volumes read as ink next to those,
 * so the stroke is mixed toward `--border-1` and thinned to land near a hairline
 * once the mark is scaled to empty-state size.
 */
const ISO_STROKE =
  'color-mix(in srgb, color-mix(in srgb, var(--text-subtle) 76%, var(--text-muted)) 55%, var(--border-1))'
const ISO_FILL_LOW = 'var(--surface-6)'
const ISO_FILL_MID = 'color-mix(in srgb, var(--surface-3) 58%, var(--surface-6))'
const ISO_FILL_HIGH = 'var(--surface-3)'
/** Darker than any outer face — the bore's wall turns away from the light. */
const ISO_FILL_BORE = 'color-mix(in srgb, var(--surface-6) 72%, var(--surface-7))'
const ISO_LINE_STROKE_WIDTH = 1.9

/**
 * Maps flat artwork into the plane of the front volume's cover.
 *
 * The cover is the face at max x, spanned by the volume's depth going across and
 * its height going up. Those two edges are its basis vectors in projected space,
 * and a matrix built from them lets a plain `<circle>` be authored in face
 * coordinates — the projection skews it into the right ellipse. Local units are
 * world units measured on the face, so a circle stays circular *on the cover*
 * instead of being stretched by the face's aspect.
 */
const COVER = SLABS[SLABS.length - 1]

const COVER_PLANE = (() => {
  const [originX, originY] = project(COVER.x, COVER.y + COVER.d, COVER.z)
  return `matrix(${COS_30.toFixed(4)} 0.5 0 1 ${originX.toFixed(3)} ${(originY - COVER.h).toFixed(3)})`
})()

const BORE_RADIUS = 62
const BORE_CX = COVER.w / 2
const BORE_CY = COVER.h / 2

/**
 * The far mouth of the bore, in the same cover-plane coordinates.
 *
 * Boring straight back through the volume is a world-space step of `-d` along y.
 * Solving the cover-plane matrix for the local offset that produces that step
 * gives `(+d, -d)` — so the far mouth sits up and left of the near one by exactly
 * the volume's thickness, and the sliver of near-mouth it fails to cover is the
 * wall you see down the hole.
 */
const FAR_CX = BORE_CX + COVER.d
const FAR_CY = BORE_CY - COVER.d

const BORE_MASK_ID = 'knowledge-iso-bore-mask'
const BORE_CLIP_ID = 'knowledge-iso-bore-clip'

const ALL_POINTS: Point[] = SLABS.flatMap((box) => Object.values(boxFaces(box)).flat())

const PADDING = 14
const MIN_X = Math.min(...ALL_POINTS.map(([x]) => x)) - PADDING
const MAX_X = Math.max(...ALL_POINTS.map(([x]) => x)) + PADDING
const MIN_Y = Math.min(...ALL_POINTS.map(([, y]) => y)) - PADDING
const MAX_Y = Math.max(...ALL_POINTS.map(([, y]) => y)) + PADDING
const VIEW_BOX = `${MIN_X.toFixed(2)} ${MIN_Y.toFixed(2)} ${(MAX_X - MIN_X).toFixed(2)} ${(MAX_Y - MIN_Y).toFixed(2)}`

/**
 * The tables grid's corner fade, run along the other diagonal.
 *
 * There it dissolves toward the bottom-right, because a grid keeps its meaning
 * cropped. Here the set recedes up and to the right, and the front volume carries
 * the bore — so the fade is anchored at the bottom-left and eats into the back of
 * the set instead, reading as more volumes behind rather than dissolving the one
 * detail worth looking at.
 */
const STACK_FADE =
  '[-webkit-mask-image:linear-gradient(to_right,#000_56%,transparent_100%),linear-gradient(to_bottom,transparent_0%,#000_40%)] [mask-image:linear-gradient(to_right,#000_56%,transparent_100%),linear-gradient(to_bottom,transparent_0%,#000_40%)] [-webkit-mask-composite:source-in] [mask-composite:intersect]'

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
      className={`block max-w-none shrink-0 ${STACK_FADE}`}
    >
      <defs>
        <mask id={BORE_MASK_ID}>
          <rect x={MIN_X} y={MIN_Y} width={MAX_X - MIN_X} height={MAX_Y - MIN_Y} fill='white' />
          <circle cx={BORE_CX} cy={BORE_CY} r={BORE_RADIUS} transform={COVER_PLANE} fill='black' />
        </mask>
        <clipPath id={BORE_CLIP_ID}>
          <circle cx={BORE_CX} cy={BORE_CY} r={BORE_RADIUS} transform={COVER_PLANE} />
        </clipPath>
      </defs>

      <g mask={`url(#${BORE_MASK_ID})`}>
        {SLABS.map((box) => {
          const faces = boxFaces(box)
          return (
            <g key={`${box.x}-${box.y}`}>
              <path d={toPath(faces.left)} fill={ISO_FILL_MID} stroke='none' />
              <path d={toPath(faces.right)} fill={ISO_FILL_LOW} stroke='none' />
              <path d={toPath(faces.top)} fill={ISO_FILL_HIGH} stroke='none' />
              <path d={toPath(faces.left)} {...LINE_PROPS} />
              <path d={toPath(faces.right)} {...LINE_PROPS} />
              <path d={toPath(faces.top)} {...LINE_PROPS} />
            </g>
          )
        })}
      </g>

      {/*
       * Down the hole: the near mouth is floored with the wall tone, then the far
       * mouth is painted over it in the cover tone of the volume standing behind —
       * looking through a bore in the front volume lands on that volume's face,
       * not on the page. Both are clipped to the near mouth so the bore never
       * paints outside its own opening.
       */}
      <g clipPath={`url(#${BORE_CLIP_ID})`}>
        <circle
          cx={BORE_CX}
          cy={BORE_CY}
          r={BORE_RADIUS}
          transform={COVER_PLANE}
          fill={ISO_FILL_BORE}
          stroke='none'
        />
        <circle
          cx={FAR_CX}
          cy={FAR_CY}
          r={BORE_RADIUS}
          transform={COVER_PLANE}
          fill={ISO_FILL_MID}
          stroke='none'
        />
        <circle cx={FAR_CX} cy={FAR_CY} r={BORE_RADIUS} transform={COVER_PLANE} {...LINE_PROPS} />
      </g>

      <circle cx={BORE_CX} cy={BORE_CY} r={BORE_RADIUS} transform={COVER_PLANE} {...LINE_PROPS} />
    </svg>
  )
}
