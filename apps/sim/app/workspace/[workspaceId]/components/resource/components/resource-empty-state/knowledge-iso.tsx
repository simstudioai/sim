import { cn } from '@sim/emcn'
import {
  createIsoLineProps,
  ISO_FILL_HIGH,
  ISO_FILL_LOW,
  ISO_FILL_MID,
  ISO_FILL_PULSE_LOW,
  ISO_STROKE as ISO_STROKE_BASE,
} from '@/components/iso/iso-illustration-style'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

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
 * ruled grid and a skeleton feed whose lines are 1px of `--border`. Carrying
 * the landing's full-weight contour made the volumes read as ink next to those,
 * so the shared stroke is mixed toward `--border` and thinned to land near a
 * hairline once the mark is scaled to empty-state size. Only the width diverges
 * from the shared recipe; the fills are imported so a change to the iso ramp
 * reaches this mark too.
 */
const ISO_STROKE = `color-mix(in srgb, ${ISO_STROKE_BASE} 55%, var(--border))`
/** Darker than any outer face — the bore's wall turns away from the light. */
const ISO_FILL_BORE = ISO_FILL_PULSE_LOW
const KNOWLEDGE_STROKE_WIDTH = 1.9

/** Matches the other three resource graphics, so the set centres as one collection. */
const MARK_HEIGHT = 148

/**
 * Maps flat artwork into the plane of the front volume's cover.
 *
 * The cover is the face at max y, spanned by the volume's width going across and
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

/** `SLABS` is a module constant and the projection is pure, so every face path is fixed. */
const SLAB_PATHS = SLABS.map((box) => {
  const faces = boxFaces(box)
  return {
    key: `${box.x}-${box.y}`,
    left: toPath(faces.left),
    right: toPath(faces.right),
    top: toPath(faces.top),
  }
})

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

/** Shared iso contour recipe at this mark's own weight; spread onto both paths and circles. */
const LINE_PROPS = createIsoLineProps(ISO_STROKE, KNOWLEDGE_STROKE_WIDTH)

/**
 * Down the hole: the near mouth is floored with the wall tone, then the far mouth
 * is painted over it in the cover tone of the volume standing behind — looking
 * through a bore in the front volume lands on that volume's face, not on the page.
 * Both are clipped to the near mouth so the bore never paints outside its opening.
 */
function BoreInterior() {
  return (
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
  )
}

/**
 * Isometric knowledge-base mark on the landing page's iso-illustration recipe.
 *
 * Geometry is authored in a large unit space so the shared stroke constant lands
 * as a hairline once the mark is scaled to empty-state size — as it does on the
 * landing marks, which draw 3.2 into a ~526-unit viewBox.
 */
export function KnowledgeIsoMark() {
  const width = MARK_HEIGHT * ((MAX_X - MIN_X) / (MAX_Y - MIN_Y))
  return (
    <svg
      viewBox={VIEW_BOX}
      width={width}
      height={MARK_HEIGHT}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className={cn('block max-w-none shrink-0', STACK_FADE, MASK_NO_REPEAT)}
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
        {SLAB_PATHS.map((slab) => (
          <g key={slab.key}>
            <path d={slab.left} fill={ISO_FILL_MID} stroke='none' />
            <path d={slab.right} fill={ISO_FILL_LOW} stroke='none' />
            <path d={slab.top} fill={ISO_FILL_HIGH} stroke='none' />
            <path d={slab.left} {...LINE_PROPS} />
            <path d={slab.right} {...LINE_PROPS} />
            <path d={slab.top} {...LINE_PROPS} />
          </g>
        ))}
      </g>

      <BoreInterior />

      <circle cx={BORE_CX} cy={BORE_CY} r={BORE_RADIUS} transform={COVER_PLANE} {...LINE_PROPS} />
    </svg>
  )
}
