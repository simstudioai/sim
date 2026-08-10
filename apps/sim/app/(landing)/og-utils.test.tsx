/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createLandingOgImage } from '@/app/(landing)/og-utils'

/**
 * Renders a real PNG. The bundled fonts are the point: Satori throws
 * "No fonts are loaded" if it receives an empty `fonts` array, which is how a
 * failed Google Fonts fetch used to take the whole build down.
 */
describe('landing OG image', () => {
  it('renders a PNG using the bundled Geist fonts', async () => {
    const response = await createLandingOgImage({
      eyebrow: 'Sim integration',
      title: 'Mintlify Integration',
      subtitle: 'Deploy, edit, search, and measure Mintlify documentation',
      pills: ['12 tools', 'API key auth', 'Free to start'],
      domainLabel: 'sim.ai/integrations/mintlify',
    })

    expect(response.status).toBe(200)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(1000)
    // PNG magic number — proves Satori laid the text out and resvg rasterized it.
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  }, 30_000)
})
