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

describe('firecrawl map numeric coercion', () => {
  it('drops a non-numeric limit rather than putting JSON null on the wire', () => {
    const body = resolveBody({ ...mapParams, limit: 'ten' as unknown as number })

    expect(Object.hasOwn(body, 'limit')).toBe(false)
  })

  it('drops a non-numeric firecrawlTimeout rather than putting JSON null on the wire', () => {
    const body = resolveBody({ ...mapParams, firecrawlTimeout: 'soon' as unknown as number })

    expect(Object.hasOwn(body, 'timeout')).toBe(false)
  })

  it('still forwards numeric strings, which the block short-inputs produce', () => {
    const body = resolveBody({
      ...mapParams,
      limit: '5' as unknown as number,
      firecrawlTimeout: '45000' as unknown as number,
    })

    expect(body).toMatchObject({ limit: 5, timeout: 45000 })
  })
})
