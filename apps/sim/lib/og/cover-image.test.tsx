/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  COVER_MAX_TITLE_LINES,
  COVER_TITLE_BOX_WIDTH,
  createCoverOgImage,
  layoutCover,
  measureCoverText,
} from '@/lib/og/cover-image'

const SUBTITLE_FONT_SIZE = 30

/**
 * Both inputs are chosen by whoever created the share — a file name and a
 * workspace/owner pair — so nothing upstream bounds their length. The canvas
 * is fixed, so the layout has to do the bounding.
 */
describe('cover OG layout', () => {
  const expectWithinCanvas = (title: string, subtitle?: string) => {
    const layout = layoutCover({ title, subtitle })

    expect(layout.lines.length).toBeGreaterThan(0)
    expect(layout.lines.length).toBeLessThanOrEqual(COVER_MAX_TITLE_LINES)
    for (const line of layout.lines) {
      expect(measureCoverText(line, layout.fontSize)).toBeLessThanOrEqual(COVER_TITLE_BOX_WIDTH)
    }
    if (subtitle) {
      expect(layout.subtitle).not.toBeNull()
      expect(measureCoverText(layout.subtitle as string, SUBTITLE_FONT_SIZE)).toBeLessThanOrEqual(
        COVER_TITLE_BOX_WIDTH
      )
    }
    return layout
  }

  it('sets a short title at the largest step on one line', () => {
    const layout = expectWithinCanvas('Protected file')
    expect(layout.lines).toEqual(['Protected file'])
    expect(layout.fontSize).toBe(110)
    expect(layout.subtitle).toBeNull()
  })

  it('breaks a hyphenated file name after a hyphen', () => {
    const layout = expectWithinCanvas('quarterly-planning-notes.pdf')
    expect(layout.lines[0].endsWith('-')).toBe(true)
  })

  it('steps the type down before it truncates', () => {
    const long = 'Quarterly planning notes for the platform and infrastructure teams'
    const layout = expectWithinCanvas(long)
    expect(layout.fontSize).toBeLessThan(110)
    expect(layout.lines.join('')).not.toContain('…')
  })

  it('truncates a title too long to fit even at the smallest step', () => {
    const layout = expectWithinCanvas(`${'unbroken'.repeat(60)}.pdf`)
    expect(layout.lines).toHaveLength(COVER_MAX_TITLE_LINES)
    expect(layout.lines[COVER_MAX_TITLE_LINES - 1].endsWith('…')).toBe(true)
  })

  it('truncates a caption too long for one line', () => {
    const layout = expectWithinCanvas(
      'report.pdf',
      `${'Very Long Workspace Name '.repeat(10)}· Shared by Someone`
    )
    expect((layout.subtitle as string).endsWith('…')).toBe(true)
  })

  it('leaves a caption that already fits intact', () => {
    const layout = expectWithinCanvas('report.pdf', 'Design · Shared by Someone')
    expect(layout.subtitle).toBe('Design · Shared by Someone')
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
