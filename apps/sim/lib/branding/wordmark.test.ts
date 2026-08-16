/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMAIL_WORDMARK_CANVAS,
  EMAIL_WORDMARK_SIZE,
  WORDMARK_PATHS,
  WORDMARK_VIEW_BOX,
} from '@/lib/branding/wordmark'

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
  it('keeps the canvas every email already sent was measured against', () => {
    expect(readPngSize(WORDMARK_PNG)).toEqual({
      width: EMAIL_WORDMARK_CANVAS.width,
      height: EMAIL_WORDMARK_CANVAS.height,
    })
  })

  it('renders undistorted in the box the header displays it in', () => {
    const boxAspect = EMAIL_WORDMARK_SIZE.width / EMAIL_WORDMARK_SIZE.height
    const canvasAspect = EMAIL_WORDMARK_CANVAS.width / EMAIL_WORDMARK_CANVAS.height
    expect(Math.abs(boxAspect - canvasAspect) / canvasAspect).toBeLessThan(0.01)
  })

  it('out-resolves that box, since email clients do no responsive selection', () => {
    expect(EMAIL_WORDMARK_CANVAS.width).toBeGreaterThanOrEqual(EMAIL_WORDMARK_SIZE.width * 2)
    expect(EMAIL_WORDMARK_CANVAS.height).toBeGreaterThanOrEqual(EMAIL_WORDMARK_SIZE.height * 2)
  })

  it('carries every glyph of the logotype', () => {
    expect(WORDMARK_PATHS).toHaveLength(4)
    for (const d of WORDMARK_PATHS) expect(d.startsWith('M')).toBe(true)
    expect(WORDMARK_VIEW_BOX.width).toBeGreaterThan(WORDMARK_VIEW_BOX.height)
  })
})
