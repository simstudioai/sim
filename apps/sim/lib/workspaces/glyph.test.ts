/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { type GlyphShape, generateGlyph } from '@/lib/workspaces/glyph'

const SEEDS = Array.from({ length: 200 }, (_, i) => `workspace-${i}`)

function extent(s: GlyphShape): [number, number, number, number] {
  switch (s.kind) {
    case 'circle':
      return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r]
    case 'ring':
      return [
        s.cx - s.r - s.w / 2,
        s.cy - s.r - s.w / 2,
        s.cx + s.r + s.w / 2,
        s.cy + s.r + s.w / 2,
      ]
    case 'capsule':
      return [
        Math.min(s.x1, s.x2) - s.w / 2,
        Math.min(s.y1, s.y2) - s.w / 2,
        Math.max(s.x1, s.x2) + s.w / 2,
        Math.max(s.y1, s.y2) + s.w / 2,
      ]
    case 'poly':
      return [
        Math.min(...s.points.map((p) => p[0])),
        Math.min(...s.points.map((p) => p[1])),
        Math.max(...s.points.map((p) => p[0])),
        Math.max(...s.points.map((p) => p[1])),
      ]
  }
}

describe('generateGlyph', () => {
  it('is deterministic per seed', () => {
    expect(generateGlyph('ws_abc')).toEqual(generateGlyph('ws_abc'))
  })

  it('gives nearly every seed a distinct glyph', () => {
    const distinct = new Set(SEEDS.map((s) => JSON.stringify(generateGlyph(s))))
    expect(distinct.size).toBeGreaterThanOrEqual(SEEDS.length - 2)
  })

  it('keeps every shape family centered inside the 100-unit box', () => {
    const kinds = new Set<GlyphShape['kind']>()
    for (const seed of SEEDS) {
      const shapes = generateGlyph(seed)
      for (const s of shapes) kinds.add(s.kind)
      const boxes = shapes.map(extent)
      const x0 = Math.min(...boxes.map((b) => b[0]))
      const y0 = Math.min(...boxes.map((b) => b[1]))
      const x1 = Math.max(...boxes.map((b) => b[2]))
      const y1 = Math.max(...boxes.map((b) => b[3]))
      expect(x0).toBeGreaterThanOrEqual(11.9)
      expect(y0).toBeGreaterThanOrEqual(11.9)
      expect(x1).toBeLessThanOrEqual(88.1)
      expect(y1).toBeLessThanOrEqual(88.1)
      expect((x0 + x1) / 2).toBeCloseTo(50, 6)
      expect((y0 + y1) / 2).toBeCloseTo(50, 6)
    }
    expect([...kinds].sort()).toEqual(['capsule', 'circle', 'poly', 'ring'])
  })

  it('rejects an empty seed', () => {
    expect(() => generateGlyph('')).toThrow('non-empty seed')
  })
})
