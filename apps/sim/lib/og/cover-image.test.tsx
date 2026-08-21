/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseFont } from 'opentype.js'
import { describe, expect, it } from 'vitest'
import {
  COVER_MAX_CAPTION_LINES,
  COVER_MAX_TITLE_LINES,
  COVER_TITLE_BOX_WIDTH,
  createCoverOgImage,
  layoutCover,
} from '@/lib/og/cover-image'

const SUBTITLE_FONT_SIZE = 30

/**
 * The font is measured here independently of the renderer rather than through
 * a helper it exports. Sharing one measurement function between the layout and
 * its test makes the assertion circular: swap the renderer back to an
 * average-glyph-width estimate and a shared helper agrees with it, so a title
 * that really does run off the canvas still passes.
 */
const fontFile = readFileSync(join(process.cwd(), 'public', 'brand', 'fonts', 'Soehne-Kraftig.ttf'))
const coverFont = parseFont(
  fontFile.buffer.slice(
    fontFile.byteOffset,
    fontFile.byteOffset + fontFile.byteLength
  ) as ArrayBuffer
)
const measure = (text: string, fontSize: number) => coverFont.getAdvanceWidth(text, fontSize)
/** Undoes the U+00A0 packing so assertions can be written with ordinary spaces. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ')

/**
 * Both inputs are chosen by whoever created the share — a file name and a
 * workspace/owner pair — so nothing upstream bounds their length or their
 * glyphs. The canvas is fixed, so the layout has to do the bounding.
 */
describe('cover OG layout', () => {
  const expectWithinCanvas = (title: string, subtitle?: string) => {
    const layout = layoutCover({ title, subtitle })

    expect(layout.lines.length).toBeGreaterThan(0)
    expect(layout.lines.length).toBeLessThanOrEqual(COVER_MAX_TITLE_LINES)
    for (const line of layout.lines) {
      expect(measure(line, layout.fontSize)).toBeLessThanOrEqual(COVER_TITLE_BOX_WIDTH)
    }
    if (subtitle) {
      expect(layout.subtitleLines.length).toBeGreaterThan(0)
      expect(layout.subtitleLines.length).toBeLessThanOrEqual(COVER_MAX_CAPTION_LINES)
      for (const line of layout.subtitleLines) {
        expect(measure(line, SUBTITLE_FONT_SIZE)).toBeLessThanOrEqual(COVER_TITLE_BOX_WIDTH)
      }
    }
    return layout
  }

  it('sets a short title at the largest step on one line', () => {
    const layout = expectWithinCanvas('Protected file')
    expect(layout.lines.map(plain)).toEqual(['Protected file'])
    expect(layout.fontSize).toBe(110)
    expect(layout.subtitleLines).toEqual([])
  })

  it('breaks a hyphenated file name after a hyphen', () => {
    const layout = expectWithinCanvas('quarterly-planning-notes.pdf')
    expect(layout.lines[0].endsWith('-')).toBe(true)
  })

  it('steps the type down before it truncates', () => {
    const layout = expectWithinCanvas(
      'Quarterly planning notes for the platform and infrastructure teams'
    )
    expect(layout.fontSize).toBeLessThan(110)
    expect(layout.lines.join('')).not.toContain('…')
  })

  /**
   * The cases an average-glyph-width estimate gets wrong. Caps run well wider
   * than the mean and glyphs the font has no coverage for run narrower, so an
   * estimator misjudges both — in the caps direction, by letting the line
   * render straight off the right edge.
   */
  it('keeps a caps-heavy title inside the box', () => {
    expectWithinCanvas('QUARTERLY WORKFORCE PLANNING SUMMARY')
  })

  it('keeps a title of uncovered glyphs inside the box', () => {
    expectWithinCanvas('四半期計画メモ・共有ファイル', '共有ワークスペース')
  })

  it('truncates a title too long to fit even at the smallest step', () => {
    const layout = expectWithinCanvas(`${'unbroken'.repeat(60)}.pdf`)
    expect(layout.lines).toHaveLength(COVER_MAX_TITLE_LINES)
    expect(layout.lines[COVER_MAX_TITLE_LINES - 1].endsWith('…')).toBe(true)
  })

  it('wraps a catalog-length caption onto a second line', () => {
    const layout = expectWithinCanvas(
      'Integrations',
      'Connect 240 apps and services and 3800+ tools to AI agents in Sim — visually, conversationally, or with code.'
    )
    expect(layout.subtitleLines).toHaveLength(2)
    expect(layout.subtitleLines.join('')).not.toContain('…')
  })

  it('truncates a caption too long even for two lines', () => {
    const layout = expectWithinCanvas(
      'report.pdf',
      `${'Very Long Workspace Name '.repeat(10)}· Shared by Someone`
    )
    expect(layout.subtitleLines).toHaveLength(COVER_MAX_CAPTION_LINES)
    expect(layout.subtitleLines[COVER_MAX_CAPTION_LINES - 1].endsWith('…')).toBe(true)
  })

  it('leaves a caption that already fits on one line intact', () => {
    const layout = expectWithinCanvas('report.pdf', 'Design · Shared by Someone')
    expect(layout.subtitleLines.map(plain)).toEqual(['Design · Shared by Someone'])
  })

  /**
   * Satori measures the first plain space in a text node at roughly double
   * width, so every space that reaches it has to be a U+00A0 — and the layout
   * has to pack lines with it already in place, or it would be measuring
   * something other than what it renders.
   */
  it('packs lines and captions with non-breaking spaces', () => {
    const layout = expectWithinCanvas('two words.pdf', 'Design · Shared by Someone')
    expect(layout.lines[0]).toContain('\u00a0')
    expect(layout.lines.join('')).not.toContain(' ')
    expect(layout.subtitleLines.join('')).not.toContain(' ')
  })
})

/**
 * Renders a real PNG. The font read at module scope is the point: it comes off
 * disk rather than the network, so a missing `public/brand/fonts` entry would
 * otherwise surface only as a broken card in production — Satori throws
 * "No fonts are loaded" when it receives an empty `fonts` array.
 */
describe('cover OG image', () => {
  const expectPng = async (response: Response) => {
    expect(response.status).toBe(200)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1000)
    // PNG magic number — proves Satori laid the text out and resvg rasterized it.
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  }

  it('renders a PNG using the bundled Söhne font', async () => {
    await expectPng(
      await createCoverOgImage({
        title: 'quarterly-planning-notes.pdf',
        subtitle: 'Design · Shared by Someone',
      })
    )
  }, 30_000)

  it('renders without a caption', async () => {
    await expectPng(await createCoverOgImage({ title: 'Protected file' }))
  }, 30_000)
})
