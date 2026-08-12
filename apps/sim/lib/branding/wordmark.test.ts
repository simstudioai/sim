/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMAIL_WORDMARK_SCALE,
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
  it('is committed at the scale the email header renders it', () => {
    expect(readPngSize(WORDMARK_PNG)).toEqual({
      width: EMAIL_WORDMARK_SIZE.width * EMAIL_WORDMARK_SCALE,
      height: EMAIL_WORDMARK_SIZE.height * EMAIL_WORDMARK_SCALE,
    })
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
