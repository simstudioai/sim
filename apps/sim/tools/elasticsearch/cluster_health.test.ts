/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ElasticsearchBlock } from '@/blocks/blocks/elasticsearch'
import * as elasticsearchTools from '@/tools/elasticsearch'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

const CONNECTION = {
  deploymentType: 'self_hosted',
  host: 'https://es.example.com',
  authMethod: 'api_key',
  apiKey: 'test-key',
} as const

function mapBlockParams(params: Record<string, unknown>): Record<string, unknown> {
  const config = ElasticsearchBlock.tools.config
  if (!config?.params) throw new Error('block has no params mapper')
  return config.params(params) as Record<string, unknown>
}

/**
 * `tools/request-transport.ts` reads `params.timeout` as the outbound HTTP
 * deadline in milliseconds. A tool param of that name therefore arms a client
 * abort as a side effect of asking Elasticsearch to wait.
 */
describe('cluster health timeout does not arm a client abort', () => {
  it('sends the wait on the wire and leaves no client deadline', () => {
    const prepared = prepareToolRequest(
      elasticsearchTools.elasticsearchClusterHealthTool as ToolConfig,
      { ...CONNECTION, clusterTimeout: '30s', waitForStatus: 'yellow' }
    )
    expect(prepared.url).toContain('timeout=30s')
    expect(prepared.url).toContain('wait_for_status=yellow')
    expect(prepared.timeout).toBeUndefined()
  })

  it('ignores a stray transport timeout left in saved state', () => {
    const mapped = mapBlockParams({ operation: 'elasticsearch_cluster_health', timeout: '30' })
    expect(mapped.timeout).toBeUndefined()
    expect(mapped.clusterTimeout).toBe('30s')
  })

  it('declares no param named timeout', () => {
    expect(
      Object.keys(elasticsearchTools.elasticsearchClusterHealthTool.params ?? {})
    ).not.toContain('timeout')
  })
})

describe('cluster health timeout units', () => {
  it.each([
    ['30', '30s'],
    ['30s', '30s'],
    ['1m', '1m'],
    ['500ms', '500ms'],
    ['2h', '2h'],
  ])('maps %o to %o', (input, expected) => {
    const mapped = mapBlockParams({ operation: 'elasticsearch_cluster_health', timeout: input })
    expect(mapped.clusterTimeout).toBe(expected)
  })

  it('emits nothing for a blank timeout', () => {
    expect(
      mapBlockParams({ operation: 'elasticsearch_cluster_health', timeout: '   ' })
    ).not.toHaveProperty('clusterTimeout')
  })
})

describe('list indices system-index opt-in', () => {
  it('coerces the dropdown string to a real boolean', () => {
    expect(
      mapBlockParams({ operation: 'elasticsearch_list_indices', includeSystemIndices: 'true' })
    ).toMatchObject({ includeSystemIndices: true })
  })

  it('omits the flag when the dropdown is left at its default', () => {
    expect(
      mapBlockParams({ operation: 'elasticsearch_list_indices', includeSystemIndices: '' })
    ).not.toHaveProperty('includeSystemIndices')
  })
})
