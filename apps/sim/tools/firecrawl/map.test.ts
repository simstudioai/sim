/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mapTool } from '@/tools/firecrawl/map'
import type { MapParams } from '@/tools/firecrawl/types'

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const mapParams: MapParams = { apiKey: 'test-key', url: 'https://example.com' }

const resolveBody = (params: MapParams): Record<string, unknown> =>
  mapTool.request.body!(params) as Record<string, unknown>

describe('firecrawl map declared links shape', () => {
  it('declares links as MapDocument objects, not bare URL strings', () => {
    const links = mapTool.outputs.links as {
      type: string
      items?: { type?: string; properties?: Record<string, unknown> }
    }

    expect(links.type).toBe('array')
    expect(links.items?.type).toBe('object')
    expect(Object.keys(links.items?.properties ?? {}).sort()).toEqual([
      'description',
      'title',
      'url',
    ])
  })

  it('passes the object-shaped links Firecrawl v2 actually returns straight through', async () => {
    const response = await mapTool.transformResponse!(
      jsonOk({
        success: true,
        id: 'map-1',
        links: [
          { url: 'https://example.com/a', title: 'A', description: 'first' },
          { url: 'https://example.com/b' },
        ],
      }),
      mapParams
    )

    expect(response.output.links).toEqual([
      { url: 'https://example.com/a', title: 'A', description: 'first' },
      { url: 'https://example.com/b' },
    ])
    expect(response.output.links[0].url).toBe('https://example.com/a')
  })
})

describe('firecrawl map timeout is not the transport deadline', () => {
  it('does not declare the transport-reserved `timeout` param', () => {
    expect(mapTool.params.timeout).toBeUndefined()
    expect(mapTool.params.firecrawlTimeout).toBeDefined()
  })

  it('maps firecrawlTimeout onto the request body as Firecrawl `timeout`', () => {
    const body = resolveBody({ ...mapParams, firecrawlTimeout: 45000 })

    expect(body.timeout).toBe(45000)
  })
})
