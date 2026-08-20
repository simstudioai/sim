/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createCoverOgImage } from '@/lib/og/cover-image'

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
        title: 'sim-cli-quick-reference',
        subtitle: 'Native Canaries · Shared by Test Sim',
      })
    )
  }, 30_000)

  it('renders without a subtitle', async () => {
    await expectPng(await createCoverOgImage({ title: 'Protected file' }))
  }, 30_000)

  it('lays out a title with no break opportunity', async () => {
    await expectPng(
      await createCoverOgImage({ title: 'a'.repeat(300), subtitle: 'Shared via Sim' })
    )
  }, 30_000)
})
