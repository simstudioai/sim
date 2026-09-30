/**
 * Deterministic workspace glyphs: a workspace id seeds one of three blob
 * shapes (burst, ring, glyph) laid out in a 100×100 box. Callers draw the
 * shapes under a goo filter (blur + alpha threshold) so touching parts melt
 * together, the same technique as the chat thinking loader.
 */

export type GlyphShape =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'capsule'; x1: number; y1: number; x2: number; y2: number; w: number }
  | { kind: 'ring'; cx: number; cy: number; r: number; w: number }
  | { kind: 'poly'; points: [number, number][] }

interface Rng {
  range: (lo: number, hi: number) => number
  int: (lo: number, hi: number) => number
  pick: <T>(items: readonly T[]) => T
  chance: (p: number) => boolean
}

const TAU = Math.PI * 2
const DEG = Math.PI / 180

function hashString(s: string): number {
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

/** mulberry32 seeded from a string hash. */
function makeRng(seed: string): Rng {
  let a = hashString(seed)
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  }
}

const polar = (r: number, a: number): [number, number] => [
  50 + r * Math.cos(a),
  50 + r * Math.sin(a),
]

function burst(rng: Rng): GlyphShape[] {
  const arms = rng.pick([3, 4, 4, 5, 6, 8])
  const length = rng.range(26, 38)
  const width = rng.range(8, 13)
  const shapes: GlyphShape[] = [{ kind: 'circle', cx: 50, cy: 50, r: rng.range(8, 16) }]
  const knobs = rng.chance(0.5)
  const knobR = rng.range(7, 11)
  const knobGap = rng.pick([-6, -3, 0, 2, 4])
  const rotation = rng.range(0, 360) * DEG
  for (let i = 0; i < arms; i++) {
    const a = rotation + (i * TAU) / arms
    const [x2, y2] = polar(length, a)
    shapes.push({ kind: 'capsule', x1: 50, y1: 50, x2, y2, w: width })
    if (knobs) {
      const [cx, cy] = polar(length + knobGap / 2, a)
      shapes.push({ kind: 'circle', cx, cy, r: knobR })
    }
  }
  return shapes
}

function ring(rng: Rng): GlyphShape[] {
  const nubs = rng.int(0, 3)
  const radius = rng.range(24, 30)
  const thickness = rng.range(9, 13)
  const inward = rng.chance(0.6)
  const nubScale = rng.range(0.55, 0.8)
  const centerDot = nubs === 0 || rng.chance(0.3)
  const centerR = rng.range(6, 12)
  const rotation = rng.range(0, 360) * DEG
  const shapes: GlyphShape[] = [{ kind: 'ring', cx: 50, cy: 50, r: radius, w: thickness }]
  for (let i = 0; i < nubs; i++) {
    const [cx, cy] = polar(
      radius + (inward ? -1 : 1) * thickness * 0.9,
      rotation + (i * TAU) / nubs
    )
    shapes.push({ kind: 'circle', cx, cy, r: thickness * nubScale })
  }
  if (centerDot) shapes.push({ kind: 'circle', cx: 50, cy: 50, r: centerR })
  return shapes
}

function glyph(rng: Rng): GlyphShape[] {
  const knobs = rng.chance(0.7)
  const sides = rng.pick([3, 3, 4, 5, 6])
  const knobR = rng.range(9, 14)
  const inset = knobs ? 0.72 : 1
  const rotation = rng.range(0, 360) * DEG
  const corners = Array.from({ length: sides }, (_, i) => polar(30, rotation + (i * TAU) / sides))
  const shapes: GlyphShape[] = [
    {
      kind: 'poly',
      points: corners.map(([x, y]) => [50 + (x - 50) * inset, 50 + (y - 50) * inset]),
    },
  ]
  if (knobs) for (const [cx, cy] of corners) shapes.push({ kind: 'circle', cx, cy, r: knobR })
  return shapes
}

const BUILDERS = { burst, ring, glyph } as const
const KINDS = Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]

function bounds(s: GlyphShape): [number, number, number, number] {
  switch (s.kind) {
    case 'circle':
      return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r]
    case 'ring': {
      const o = s.r + s.w / 2
      return [s.cx - o, s.cy - o, s.cx + o, s.cy + o]
    }
    case 'capsule': {
      const h = s.w / 2
      return [
        Math.min(s.x1, s.x2) - h,
        Math.min(s.y1, s.y2) - h,
        Math.max(s.x1, s.x2) + h,
        Math.max(s.y1, s.y2) + h,
      ]
    }
    case 'poly': {
      const xs = s.points.map((p) => p[0])
      const ys = s.points.map((p) => p[1])
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }
  }
}

/**
 * Centers the layout and scales it to at most 76 units across. Scale is
 * capped at 1.1 because the gaps between parts are tuned to the goo filter's
 * blur radius; enlarging them further would split parts that should neck.
 */
function fitToBox(shapes: GlyphShape[]): GlyphShape[] {
  const boxes = shapes.map(bounds)
  const x0 = Math.min(...boxes.map((b) => b[0]))
  const y0 = Math.min(...boxes.map((b) => b[1]))
  const x1 = Math.max(...boxes.map((b) => b[2]))
  const y1 = Math.max(...boxes.map((b) => b[3]))
  const k = Math.min(1.1, 76 / Math.max(x1 - x0, y1 - y0))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const X = (x: number) => 50 + (x - cx) * k
  const Y = (y: number) => 50 + (y - cy) * k
  return shapes.map((s): GlyphShape => {
    switch (s.kind) {
      case 'circle':
        return { kind: 'circle', cx: X(s.cx), cy: Y(s.cy), r: s.r * k }
      case 'ring':
        return { kind: 'ring', cx: X(s.cx), cy: Y(s.cy), r: s.r * k, w: s.w * k }
      case 'capsule':
        return { kind: 'capsule', x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2), w: s.w * k }
      case 'poly':
        return { kind: 'poly', points: s.points.map(([x, y]) => [X(x), Y(y)]) }
    }
  })
}

/** The glyph for a seed (a workspace id): same seed, same shapes, everywhere. */
export function generateGlyph(seed: string): GlyphShape[] {
  if (!seed) throw new Error('generateGlyph requires a non-empty seed')
  const kind = makeRng(`type:${seed}`).pick(KINDS)
  return fitToBox(BUILDERS[kind](makeRng(`${kind}:${seed}`)))
}
