/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { countTool } from '@/tools/elasticsearch/count'
import { createIndexTool } from '@/tools/elasticsearch/create_index'
import { searchTool } from '@/tools/elasticsearch/search'
import type {
  ElasticsearchCountParams,
  ElasticsearchCreateIndexParams,
  ElasticsearchSearchParams,
} from '@/tools/elasticsearch/types'

const CONNECTION = {
  deploymentType: 'self_hosted',
  host: 'https://es.example.com',
  authMethod: 'api_key',
  apiKey: 'test-key',
  index: 'products',
} as const

function searchBody(overrides: Partial<ElasticsearchSearchParams>): Record<string, unknown> {
  const build = searchTool.request.body
  if (!build) throw new Error('searchTool.request.body is not defined')
  return build({ ...CONNECTION, ...overrides } as ElasticsearchSearchParams) as Record<
    string,
    unknown
  >
}

function countBody(overrides: Partial<ElasticsearchCountParams>): Record<string, unknown> {
  const build = countTool.request.body
  if (!build) throw new Error('countTool.request.body is not defined')
  return build({ ...CONNECTION, ...overrides } as ElasticsearchCountParams) as Record<
    string,
    unknown
  >
}

function createIndexBody(
  overrides: Partial<ElasticsearchCreateIndexParams>
): Record<string, unknown> {
  const build = createIndexTool.request.body
  if (!build) throw new Error('createIndexTool.request.body is not defined')
  return build({ ...CONNECTION, ...overrides } as ElasticsearchCreateIndexParams) as Record<
    string,
    unknown
  >
}

describe('elasticsearch_search request body', () => {
  it('throws on malformed query JSON instead of silently scanning the whole index', () => {
    expect(() => searchBody({ query: '{"match":{title:"x"}}' })).toThrow(/Invalid JSON/)
  })

  it('omits the query key entirely when no query is provided', () => {
    const body = searchBody({})
    expect(body).not.toHaveProperty('query')
  })

  it('passes valid query JSON through unchanged', () => {
    const body = searchBody({ query: '{"match":{"title":"x"}}' })
    expect(body.query).toEqual({ match: { title: 'x' } })
  })

  it('throws on malformed sort JSON instead of silently dropping it', () => {
    expect(() => searchBody({ sort: '[{created_at:"desc"}]' })).toThrow(/Invalid JSON/)
  })

  it('passes valid sort JSON through unchanged', () => {
    const body = searchBody({ sort: '[{"created_at":"desc"}]' })
    expect(body.sort).toEqual([{ created_at: 'desc' }])
  })
})

describe('elasticsearch_count request body', () => {
  it('throws on malformed query JSON instead of silently counting the whole index', () => {
    expect(() => countBody({ query: '{"match":{status:"active"}}' })).toThrow(/Invalid JSON/)
  })

  it('omits the query key entirely when no query is provided', () => {
    const body = countBody({})
    expect(body).not.toHaveProperty('query')
  })

  it('passes valid query JSON through unchanged', () => {
    const body = countBody({ query: '{"match":{"status":"active"}}' })
    expect(body.query).toEqual({ match: { status: 'active' } })
  })
})

describe('elasticsearch_create_index request body', () => {
  it('throws on malformed settings JSON instead of creating a default index', () => {
    expect(() => createIndexBody({ settings: '{number_of_shards:1}' })).toThrow(/Invalid JSON/)
  })

  it('throws on malformed mappings JSON instead of creating a default-mapped index', () => {
    expect(() => createIndexBody({ mappings: '{"properties":{title:{"type":"text"}}}' })).toThrow(
      /Invalid JSON/
    )
  })

  it('omits settings and mappings when neither is provided', () => {
    const body = createIndexBody({})
    expect(body).not.toHaveProperty('settings')
    expect(body).not.toHaveProperty('mappings')
  })

  it('passes valid settings and mappings through unchanged', () => {
    const body = createIndexBody({
      settings: '{"number_of_shards":1}',
      mappings: '{"properties":{"title":{"type":"text"}}}',
    })
    expect(body.settings).toEqual({ number_of_shards: 1 })
    expect(body.mappings).toEqual({ properties: { title: { type: 'text' } } })
  })
})
