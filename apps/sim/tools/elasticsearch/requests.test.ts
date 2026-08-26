/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { bulkTool } from '@/tools/elasticsearch/bulk'
import { clusterHealthTool } from '@/tools/elasticsearch/cluster_health'
import { deleteDocumentTool } from '@/tools/elasticsearch/delete_document'
import { getDocumentTool } from '@/tools/elasticsearch/get_document'
import { getIndexTool } from '@/tools/elasticsearch/get_index'
import { searchTool } from '@/tools/elasticsearch/search'
import type {
  ElasticsearchBulkParams,
  ElasticsearchClusterHealthParams,
  ElasticsearchDeleteDocumentParams,
  ElasticsearchGetDocumentParams,
  ElasticsearchSearchParams,
} from '@/tools/elasticsearch/types'
import { updateDocumentTool } from '@/tools/elasticsearch/update_document'

const SELF_HOSTED = {
  deploymentType: 'self_hosted',
  host: 'https://es.example.com:9200',
  authMethod: 'api_key',
  apiKey: 'test-key',
} as const

const ES_UUID = 'cec6f261a74bf24ce33bb8811b84294f'
const PARENT_DN = 'us-east-1.aws.found.io'
const CLOUD_ID = `staging:${Buffer.from(`${PARENT_DN}$${ES_UUID}$abcd`, 'utf-8').toString('base64')}`

function url<P>(tool: { request: { url: string | ((p: P) => string) } }, params: P): string {
  const build = tool.request.url
  return typeof build === 'function' ? build(params) : build
}

function searchBody(overrides: Partial<ElasticsearchSearchParams>): Record<string, unknown> {
  const build = searchTool.request.body
  if (!build) throw new Error('searchTool.request.body is not defined')
  return build({
    ...SELF_HOSTED,
    index: 'products',
    ...overrides,
  } as ElasticsearchSearchParams) as Record<string, unknown>
}

describe('elasticsearch URL construction', () => {
  it('builds a cloud search URL against the Elasticsearch UUID host', () => {
    const built = url(searchTool, {
      deploymentType: 'cloud',
      cloudId: CLOUD_ID,
      authMethod: 'api_key',
      apiKey: 'k',
      index: 'products',
    } as ElasticsearchSearchParams)

    expect(built).toBe(`https://${ES_UUID}.${PARENT_DN}/products/_search`)
  })

  it('builds a self-hosted search URL', () => {
    const built = url(searchTool, {
      ...SELF_HOSTED,
      index: 'products',
    } as ElasticsearchSearchParams)

    expect(built).toBe('https://es.example.com:9200/products/_search')
  })

  it('rejects a path-traversal index rather than encoding it', () => {
    expect(() =>
      url(searchTool, { ...SELF_HOSTED, index: '..' } as ElasticsearchSearchParams)
    ).toThrow(/path traversal/)
  })

  it('rejects a document id carrying a path separator', () => {
    expect(() =>
      url(getDocumentTool, {
        ...SELF_HOSTED,
        index: 'products',
        documentId: 'a/b',
      } as ElasticsearchGetDocumentParams)
    ).toThrow(/path separator/)
  })

  it('percent-encodes the refresh query parameter', () => {
    const built = url(deleteDocumentTool, {
      ...SELF_HOSTED,
      index: 'products',
      documentId: 'abc',
      refresh: 'wait_for',
    } as ElasticsearchDeleteDocumentParams)

    expect(built).toBe('https://es.example.com:9200/products/_doc/abc?refresh=wait_for')
  })

  it('percent-encodes the bulk refresh query parameter', () => {
    const built = url(bulkTool, {
      ...SELF_HOSTED,
      index: 'products',
      operations: '{}',
      refresh: 'wait_for',
    } as ElasticsearchBulkParams)

    expect(built).toBe('https://es.example.com:9200/products/_bulk?refresh=wait_for')
  })

  it('sends the bulk body as NDJSON', () => {
    const headers = bulkTool.request.headers({
      ...SELF_HOSTED,
      operations: '{}',
    } as ElasticsearchBulkParams)

    expect(headers['Content-Type']).toBe('application/x-ndjson')
  })

  it('keeps a retry_on_conflict of 0 on the update URL', () => {
    const built = url(updateDocumentTool, {
      ...SELF_HOSTED,
      index: 'products',
      documentId: 'abc',
      document: '{}',
      retryOnConflict: 0,
    } as never)

    expect(built).toContain('retry_on_conflict=0')
  })
})

describe('elasticsearch_search size', () => {
  it('sends a numeric size of 0, which asks for hits.total without any documents', () => {
    expect(searchBody({ size: 0 }).size).toBe(0)
  })

  it('sends a numeric from of 0', () => {
    expect(searchBody({ from: 0 }).from).toBe(0)
  })

  it('omits size entirely when it is unset', () => {
    expect(searchBody({})).not.toHaveProperty('size')
  })

  it('omits size when it arrives as an empty string from an untouched subblock', () => {
    expect(searchBody({ size: '' as unknown as number })).not.toHaveProperty('size')
  })

  it('throws instead of sending NaN for a non-numeric size', () => {
    expect(() => searchBody({ size: 'ten' as unknown as number })).toThrow(/size must be a number/)
  })
})

describe('elasticsearch_cluster_health timeout', () => {
  it('sends the Elasticsearch duration string under esTimeout, never the reserved timeout param', () => {
    const built = url(clusterHealthTool, {
      ...SELF_HOSTED,
      waitForStatus: 'green',
      esTimeout: '30s',
    } as ElasticsearchClusterHealthParams)

    expect(built).toBe(
      'https://es.example.com:9200/_cluster/health?wait_for_status=green&timeout=30s'
    )
  })

  it('does not declare a tool param named timeout, which the transport would read as milliseconds', () => {
    expect(clusterHealthTool.params).not.toHaveProperty('timeout')
    expect(clusterHealthTool.params).toHaveProperty('esTimeout')
  })
})

describe('elasticsearch_get_index transformResponse', () => {
  it('flattens the index-keyed response into index, aliases, mappings, and settings', async () => {
    const transform = getIndexTool.transformResponse
    if (!transform) throw new Error('getIndexTool.transformResponse is not defined')

    const result = await transform(
      new Response(
        JSON.stringify({
          'my-index': {
            aliases: { live: {} },
            mappings: { properties: { title: { type: 'text' } } },
            settings: { index: { number_of_shards: '1' } },
          },
        }),
        { status: 200 }
      )
    )

    expect(result.output).toMatchObject({
      index: 'my-index',
      aliases: { live: {} },
      mappings: { properties: { title: { type: 'text' } } },
      settings: { index: { number_of_shards: '1' } },
    })
  })

  it('declares the flattened keys rather than a phantom "index" object', () => {
    expect(getIndexTool.outputs?.index?.type).toBe('string')
    expect(getIndexTool.outputs).toHaveProperty('aliases')
    expect(getIndexTool.outputs).toHaveProperty('mappings')
    expect(getIndexTool.outputs).toHaveProperty('settings')
  })
})

describe('unreachable non-ok outcomes are not advertised', () => {
  it('get_document has no 404 branch — the executor throws before transformResponse runs', () => {
    expect(getDocumentTool.transformResponse?.toString()).not.toContain('404')
  })

  it('delete_document has no 404 branch', () => {
    expect(deleteDocumentTool.transformResponse?.toString()).not.toContain('404')
  })

  it('get_document does not advertise found: false as a possible output', () => {
    expect(getDocumentTool.outputs?.found?.description).toMatch(/Always true/)
  })

  it('delete_document does not advertise "not_found" as a possible result', () => {
    expect(deleteDocumentTool.outputs?.result?.description).toMatch(/Always "deleted"/)
  })
})

describe('date-math index targets', () => {
  it("builds a search URL for Elasticsearch's canonical date-math index", () => {
    const built = url(searchTool, {
      ...SELF_HOSTED,
      index: '<logstash-{now/d}>',
    } as ElasticsearchSearchParams)

    expect(built).toBe('https://es.example.com:9200/%3Clogstash-%7Bnow%2Fd%7D%3E/_search')
  })

  it('keeps the encoded date-math segment intact through the URL parser', () => {
    const built = url(searchTool, {
      ...SELF_HOSTED,
      index: '<logstash-{now/d}>',
    } as ElasticsearchSearchParams)

    expect(new URL(built).pathname).toBe('/%3Clogstash-%7Bnow%2Fd%7D%3E/_search')
  })

  it('accepts a date-math index on a document write path too', () => {
    const built = url(getDocumentTool, {
      ...SELF_HOSTED,
      index: '<logstash-{now/d}>',
      documentId: 'abc',
    } as ElasticsearchGetDocumentParams)

    expect(built).toBe('https://es.example.com:9200/%3Clogstash-%7Bnow%2Fd%7D%3E/_doc/abc')
  })

  it('still rejects a bare dot-segment index', () => {
    expect(() =>
      url(searchTool, { ...SELF_HOSTED, index: '..' } as ElasticsearchSearchParams)
    ).toThrow(/path traversal/)
  })

  it('still rejects a path separator in a document id, which is not a date-math parameter', () => {
    expect(() =>
      url(getDocumentTool, {
        ...SELF_HOSTED,
        index: 'products',
        documentId: 'a/b',
      } as ElasticsearchGetDocumentParams)
    ).toThrow(/path separator/)
  })
})

describe('elasticsearch_get_index multi-target responses', () => {
  const transformIndex = getIndexTool.transformResponse

  async function getIndex(body: unknown) {
    if (!transformIndex) throw new Error('getIndexTool.transformResponse is not defined')
    return transformIndex(new Response(JSON.stringify(body), { status: 200 }))
  }

  it('keeps every matched index instead of dropping all but one', async () => {
    const result = await getIndex({
      'logs-2024': { aliases: { live: {} }, mappings: {}, settings: {} },
      'logs-2025': { aliases: {}, mappings: { properties: {} }, settings: { index: {} } },
    })

    expect(Object.keys(result.output.indices)).toEqual(['logs-2024', 'logs-2025'])
  })

  it('reports how many targets a wildcard or comma-separated request matched', async () => {
    const result = await getIndex({
      'logs-a': { aliases: {}, mappings: {}, settings: {} },
      'logs-b': { aliases: {}, mappings: {}, settings: {} },
      'logs-c': { aliases: {}, mappings: {}, settings: {} },
    })

    expect(result.output.matchedCount).toBe(3)
  })

  it('preserves data_stream and lifecycle, which the flattened shape has no slot for', async () => {
    const result = await getIndex({
      'logs-2024': {
        aliases: {},
        mappings: {},
        settings: {},
        data_stream: 'logs',
        lifecycle: { data_retention: '7d' },
      },
    })

    expect(result.output.indices['logs-2024']).toMatchObject({
      data_stream: 'logs',
      lifecycle: { data_retention: '7d' },
    })
  })

  it('leaves the single-index flattened shape exactly as declared', async () => {
    const result = await getIndex({
      'my-index': {
        aliases: { live: {} },
        mappings: { properties: { title: { type: 'text' } } },
        settings: { index: { number_of_shards: '1' } },
      },
    })

    expect(result.output.index).toBe('my-index')
    expect(result.output.aliases).toEqual({ live: {} })
    expect(result.output.mappings).toEqual({ properties: { title: { type: 'text' } } })
    expect(result.output.settings).toEqual({ index: { number_of_shards: '1' } })
    expect(result.output.matchedCount).toBe(1)
  })

  it('declares indices and matchedCount as outputs so the flattening is not silently lossy', () => {
    expect(getIndexTool.outputs?.indices?.type).toBe('json')
    expect(getIndexTool.outputs?.matchedCount?.type).toBe('number')
  })

  it('survives an empty response without inventing an index name', async () => {
    const result = await getIndex({})

    expect(result.output.index).toBe('')
    expect(result.output.matchedCount).toBe(0)
    expect(result.output.indices).toEqual({})
  })
})

describe('elasticsearch_cluster_health esTimeout normalization', () => {
  function healthUrl(esTimeout: unknown): string {
    return url(clusterHealthTool, {
      ...SELF_HOSTED,
      esTimeout,
    } as ElasticsearchClusterHealthParams)
  }

  it('appends the implied seconds unit to a bare number, which Elasticsearch rejects unit-less', () => {
    expect(healthUrl('30')).toContain('timeout=30s')
  })

  it('normalizes in the tool, so a Copilot call that never runs the block mapping is still valid', () => {
    const built = healthUrl('30')

    expect(built).not.toContain('timeout=30&')
    expect(built.endsWith('timeout=30')).toBe(false)
  })

  it('leaves a minute duration alone rather than rewriting "1m" to "1ms"', () => {
    expect(healthUrl('1m')).toContain('timeout=1m')
  })

  it('preserves an explicit seconds suffix', () => {
    expect(healthUrl('45s')).toContain('timeout=45s')
  })

  it('passes the unit-less values Elasticsearch does accept through untouched', () => {
    expect(healthUrl('0')).toContain('timeout=0')
    expect(healthUrl('0')).not.toContain('timeout=0s')
    expect(healthUrl('-1')).toContain('timeout=-1')
  })

  it('accepts a number that arrived unquoted from a resolved reference', () => {
    expect(healthUrl(30)).toContain('timeout=30s')
  })

  it('omits the timeout entirely when unset or blank', () => {
    expect(healthUrl(undefined)).not.toContain('timeout=')
    expect(healthUrl('   ')).not.toContain('timeout=')
  })

  it('declares an explicit visibility so every surface agrees on who may set it', () => {
    expect(clusterHealthTool.params.esTimeout.visibility).toBe('user-or-llm')
  })
})

describe('elasticsearch_search declares no unreachable aggregations', () => {
  it('does not advertise an aggregations output, since no aggs param exists to produce one', () => {
    expect(searchTool.outputs).not.toHaveProperty('aggregations')
  })

  it('has no aggs param that would make aggregations reachable', () => {
    expect(searchTool.params).not.toHaveProperty('aggs')
    expect(searchTool.params).not.toHaveProperty('aggregations')
  })

  it('does not read aggregations off the response body', () => {
    expect(searchTool.transformResponse?.toString()).not.toContain('aggregations')
  })

  it('builds a body with no aggregation key at any size', () => {
    expect(Object.keys(searchBody({ size: 0 }))).toEqual(['size'])
  })
})
