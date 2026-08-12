/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMAIL_WORDMARK_SIZE, WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@/lib/branding/wordmark'

/** Email clients do no responsive image selection, so the asset carries retina detail itself. */
const MIN_RETINA_SCALE = 2

const WORDMARK_PNG = path.join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'brand',
  'color',
  'email',
  'wordmark.png'
)

/** Reads width/height out of a PNG's IHDR, which always follows the 8-byte signature. */
function readPngSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(file)
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

describe('email wordmark asset', () => {
  it('out-resolves the box the email header renders it in', () => {
    const { width, height } = readPngSize(WORDMARK_PNG)
    expect(width).toBeGreaterThanOrEqual(EMAIL_WORDMARK_SIZE.width * MIN_RETINA_SCALE)
    expect(height).toBeGreaterThanOrEqual(EMAIL_WORDMARK_SIZE.height * MIN_RETINA_SCALE)
  })

  it('is committed at the aspect ratio the header displays it at', () => {
    const { width, height } = readPngSize(WORDMARK_PNG)
    const assetAspect = width / height
    const boxAspect = EMAIL_WORDMARK_SIZE.width / EMAIL_WORDMARK_SIZE.height
    expect(Math.abs(assetAspect - boxAspect) / boxAspect).toBeLessThan(0.01)
  })

  it('renders the mark at the brand outlines aspect ratio, within a rounding pixel', () => {
    const boxAspect = EMAIL_WORDMARK_SIZE.width / EMAIL_WORDMARK_SIZE.height
    const viewBoxAspect = WORDMARK_VIEW_BOX.width / WORDMARK_VIEW_BOX.height
    expect(Math.abs(boxAspect - viewBoxAspect) / viewBoxAspect).toBeLessThan(0.01)
  })

  it('carries every glyph of the logotype', () => {
    expect(WORDMARK_PATHS).toHaveLength(4)
    for (const d of WORDMARK_PATHS) expect(d.startsWith('M')).toBe(true)
  })
})
