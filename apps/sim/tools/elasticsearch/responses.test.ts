/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as elasticsearchTools from '@/tools/elasticsearch'
import type { ToolConfig } from '@/tools/types'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const GET_INDEX_BODY = {
  'logs-2024': { aliases: {}, mappings: { properties: {} }, settings: { index: {} } },
  'logs-2025': { aliases: {}, mappings: { properties: {} }, settings: { index: {} } },
}

/**
 * `GET /{index}` answers with a map keyed by index name. The tool previously
 * declared an output called `index`, which appears nowhere in that body, so the
 * whole payload was unreachable from the reference picker.
 */
describe('elasticsearch_get_index output shape', () => {
  const tool = elasticsearchTools.elasticsearchGetIndexTool

  it('declares only outputs the transform actually produces', async () => {
    const result = await tool.transformResponse!(jsonResponse(GET_INDEX_BODY))
    for (const declared of Object.keys(tool.outputs ?? {})) {
      expect(Object.keys(result.output)).toContain(declared)
    }
  })

  it('exposes every matched index under the declared aggregate', async () => {
    const result = await tool.transformResponse!(jsonResponse(GET_INDEX_BODY))
    expect(Object.keys(result.output.indices as object)).toEqual(['logs-2024', 'logs-2025'])
  })

  it('keeps the raw per-index keys so references saved earlier still resolve', async () => {
    const result = await tool.transformResponse!(jsonResponse(GET_INDEX_BODY))
    expect(result.output['logs-2024']).toEqual(GET_INDEX_BODY['logs-2024'])
  })

  it('lets an index literally named indices win its own key', async () => {
    const body = { indices: { aliases: {}, mappings: {}, settings: {} } }
    const result = await tool.transformResponse!(jsonResponse(body))
    expect(result.output.indices).toEqual(body.indices)
  })
})

describe('elasticsearch_list_indices filtering', () => {
  const tool = elasticsearchTools.elasticsearchListIndicesTool
  const rows = [
    { index: 'products', health: 'green', status: 'open', 'docs.count': '5', pri: '1', rep: '1' },
    { index: '.kibana', health: 'green', status: 'open', 'docs.count': '2', pri: '1', rep: '0' },
  ]

  it('omits system indices by default', async () => {
    const result = await tool.transformResponse!(jsonResponse(rows), {} as never)
    expect((result.output.indices as Array<{ index: string }>).map((i) => i.index)).toEqual([
      'products',
    ])
  })

  it('includes them when the caller opts in', async () => {
    const result = await tool.transformResponse!(jsonResponse(rows), {
      includeSystemIndices: true,
    } as never)
    expect((result.output.indices as Array<{ index: string }>).map((i) => i.index)).toEqual([
      'products',
      '.kibana',
    ])
  })

  /** `item.index.startsWith` threw outright when a `_cat` row had no index column. */
  it('does not throw on a row with no index column', async () => {
    const result = await tool.transformResponse!(jsonResponse([{ health: 'green' }]), {} as never)
    expect(result.success).toBe(true)
    expect(result.output.indices).toHaveLength(1)
  })

  it('does not throw when the body is not an array', async () => {
    const result = await tool.transformResponse!(jsonResponse({ error: 'x' }), {} as never)
    expect(result.output.indices).toEqual([])
  })
})

/**
 * `host` and a Cloud ID are user-supplied origins and every tool sends an
 * `Authorization` header. `prepareToolRequest` only populates `redirectPolicy`
 * from the tool, and the credential-stripping branch in
 * `lib/core/security/input-validation.server.ts` is gated on that policy
 * existing — so without one, a redirect carries the credential off-origin.
 *
 * `stripAuthOnRedirect` is deliberately not used: it drops `Authorization` on
 * every hop including same-origin, which would break a reverse proxy in front
 * of Elasticsearch issuing a legitimate same-origin redirect.
 */
describe('every Elasticsearch tool declines cross-origin credentials', () => {
  const tools = Object.values(elasticsearchTools) as ToolConfig[]

  it('covers all thirteen tools', () => {
    expect(tools).toHaveLength(13)
  })

  it.each(tools.map((tool) => [tool.id, tool] as const))('%s', (_id, tool) => {
    expect(tool.request?.redirectPolicy?.({})).toEqual({
      mode: 'legacy',
      sendCredentialsOnCrossOriginRedirect: false,
    })
    expect(tool.request?.stripAuthOnRedirect).toBeUndefined()
  })
})

/** Outputs that are absent on a documented branch must be declared optional. */
describe('conditionally-present outputs are declared optional', () => {
  it.each([
    ['elasticsearchGetDocumentTool', ['_version', '_source']],
    ['elasticsearchDeleteDocumentTool', ['_version']],
    ['elasticsearchCreateIndexTool', ['shards_acknowledged', 'index']],
    ['elasticsearchClusterStatsTool', ['status']],
  ] as const)('%s', (name, fields) => {
    const tool = (elasticsearchTools as Record<string, ToolConfig>)[name]
    for (const field of fields) {
      expect(tool.outputs?.[field]).toMatchObject({ optional: true })
    }
  })
})

/** The error branch must satisfy the same declared shape as the success branch. */
describe('elasticsearch_get_index error branch', () => {
  it('still exposes the declared aggregate on failure', async () => {
    const tool = elasticsearchTools.elasticsearchGetIndexTool
    const result = await tool.transformResponse!(
      new Response(JSON.stringify({ error: { reason: 'no such index' } }), { status: 404 })
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('no such index')
    expect(result.output.indices).toEqual({})
  })
})
