/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ElasticsearchBlock } from '@/blocks/blocks/elasticsearch'
import { clusterHealthTool } from '@/tools/elasticsearch/cluster_health'
import { getIndexTool } from '@/tools/elasticsearch/get_index'
import type { ElasticsearchClusterHealthParams } from '@/tools/elasticsearch/types'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

const CONNECTION = {
  deploymentType: 'self_hosted',
  host: 'https://es.example.com',
  authMethod: 'api_key',
  apiKey: 'test-key',
} as const

function clusterHealthUrl(overrides: Partial<ElasticsearchClusterHealthParams>): string {
  const build = clusterHealthTool.request.url
  if (typeof build !== 'function')
    throw new Error('clusterHealthTool.request.url is not a function')
  return build({ ...CONNECTION, ...overrides } as ElasticsearchClusterHealthParams)
}

describe('elasticsearch_cluster_health timeout param', () => {
  it('does not declare a param named timeout, which the transport reads as an HTTP deadline', () => {
    expect(clusterHealthTool.params).not.toHaveProperty('timeout')
    expect(clusterHealthTool.params).toHaveProperty('clusterTimeout')
  })

  it('sends clusterTimeout as the Elasticsearch timeout query parameter', () => {
    const url = new URL(clusterHealthUrl({ clusterTimeout: '30s' }))
    expect(url.searchParams.get('timeout')).toBe('30s')
  })

  it('omits the query parameter when no timeout is supplied', () => {
    expect(new URL(clusterHealthUrl({})).searchParams.get('timeout')).toBeNull()
  })

  it('never sets an outbound HTTP deadline from the wait timeout', () => {
    const mapped = ElasticsearchBlock.tools.config?.params?.({
      operation: 'elasticsearch_cluster_health',
      timeout: '30',
    })
    expect(mapped?.clusterTimeout).toBe('30s')

    const prepared = prepareToolRequest(clusterHealthTool as ToolConfig, {
      ...CONNECTION,
      ...mapped,
    })
    expect(prepared.timeout).toBeUndefined()
    expect(new URL(prepared.url).searchParams.get('timeout')).toBe('30s')
  })

  it('preserves a unit-bearing timeout instead of appending a second unit', () => {
    const mapped = ElasticsearchBlock.tools.config?.params?.({
      operation: 'elasticsearch_cluster_health',
      timeout: '1m',
    })
    expect(mapped?.clusterTimeout).toBe('1m')
  })
})

describe('elasticsearch_get_index response shape', () => {
  async function transform(body: unknown) {
    const response = new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    return getIndexTool.transformResponse?.(response, {})
  }

  it('declares only output keys that the transform actually returns', async () => {
    const result = await transform({ 'logs-2024': { aliases: {}, mappings: {}, settings: {} } })
    const returned = Object.keys(result?.output ?? {})
    for (const declared of Object.keys(getIndexTool.outputs ?? {})) {
      expect(returned).toContain(declared)
    }
  })

  it('keeps the previous top-level index keys so saved references still resolve', async () => {
    const result = await transform({ products: { mappings: { properties: { sku: {} } } } })
    const output = result?.output as Record<string, { mappings?: Record<string, unknown> }>
    expect(output.products.mappings).toEqual({ properties: { sku: {} } })
  })

  it('keeps every index a wildcard request matched', async () => {
    const result = await transform({
      'logs-2024.01': { aliases: {}, mappings: {}, settings: {} },
      'logs-2024.02': { aliases: {}, mappings: {}, settings: {} },
    })
    expect(Object.keys((result?.output as { indices: Record<string, unknown> }).indices)).toEqual([
      'logs-2024.01',
      'logs-2024.02',
    ])
  })
})
