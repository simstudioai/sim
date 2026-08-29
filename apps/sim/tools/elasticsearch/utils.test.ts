/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as elasticsearchTools from '@/tools/elasticsearch'
import { buildBaseUrl, parseCloudId } from '@/tools/elasticsearch/utils'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

function cloudId(payload: string, label = 'my-deployment'): string {
  return `${label}:${Buffer.from(payload).toString('base64')}`
}

const PARENT_DOMAIN = 'us-east-1.aws.found.io'
const ES_UUID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const KIBANA_UUID = '0f9e8d7c6b5a4938271605f4e3d2c1b0'

describe('parseCloudId', () => {
  it('resolves the Elasticsearch UUID as the host, not the deployment label', () => {
    const url = parseCloudId(cloudId(`${PARENT_DOMAIN}$${ES_UUID}$${KIBANA_UUID}`))
    expect(url).toBe(`https://${ES_UUID}.${PARENT_DOMAIN}`)
    expect(url).not.toContain('my-deployment')
  })

  it('ignores a colon inside the deployment label by splitting at the last colon', () => {
    const url = parseCloudId(cloudId(`${PARENT_DOMAIN}$${ES_UUID}$${KIBANA_UUID}`, 'eu:prod'))
    expect(url).toBe(`https://${ES_UUID}.${PARENT_DOMAIN}`)
  })

  it('applies a per-service port taken from the last colon of the component', () => {
    const url = parseCloudId(cloudId(`${PARENT_DOMAIN}$${ES_UUID}:9243$${KIBANA_UUID}`))
    expect(url).toBe(`https://${ES_UUID}.${PARENT_DOMAIN}:9243`)
  })

  it('inherits the parent domain port when the service component has none', () => {
    const url = parseCloudId(cloudId(`${PARENT_DOMAIN}:9243$${ES_UUID}$${KIBANA_UUID}`))
    expect(url).toBe(`https://${ES_UUID}.${PARENT_DOMAIN}:9243`)
  })

  it('omits an explicit :443, which is the Elastic Cloud default', () => {
    const url = parseCloudId(cloudId(`${PARENT_DOMAIN}:443$${ES_UUID}$${KIBANA_UUID}`))
    expect(url).toBe(`https://${ES_UUID}.${PARENT_DOMAIN}`)
  })

  it('rejects an @ in the Elasticsearch component that would redirect credentials', () => {
    const hostile = cloudId(`${PARENT_DOMAIN}$${ES_UUID}@evil.example.com$${KIBANA_UUID}`)
    expect(() => parseCloudId(hostile)).toThrow(/Invalid Cloud ID/)
  })

  it.each(['#', '?', '/', '\\'])('rejects %s in the parent domain component', (character) => {
    const hostile = cloudId(`${PARENT_DOMAIN}${character}x$${ES_UUID}$${KIBANA_UUID}`)
    expect(() => parseCloudId(hostile)).toThrow(/Invalid Cloud ID/)
  })

  it('rejects a non-numeric port that would smuggle a host into the authority', () => {
    const hostile = cloudId(`${PARENT_DOMAIN}$${ES_UUID}:80@evil.example.com$${KIBANA_UUID}`)
    expect(() => parseCloudId(hostile)).toThrow(/Invalid Cloud ID/)
  })

  it('rejects a backslash, which the URL parser treats as an authority terminator', () => {
    const hostile = cloudId(`${PARENT_DOMAIN}$${ES_UUID}\\evil.example.com$${KIBANA_UUID}`)
    expect(() => parseCloudId(hostile)).toThrow(/Invalid Cloud ID/)
  })

  it('rejects a payload with fewer than three $-separated components', () => {
    expect(() => parseCloudId(cloudId(`${PARENT_DOMAIN}$${ES_UUID}`))).toThrow(/Invalid Cloud ID/)
  })

  it('rejects an empty Elasticsearch component', () => {
    expect(() => parseCloudId(cloudId(`${PARENT_DOMAIN}$$${KIBANA_UUID}`))).toThrow(
      /Invalid Cloud ID/
    )
  })
})

describe('buildBaseUrl', () => {
  it('strips a trailing slash from a self-hosted host', () => {
    expect(
      buildBaseUrl({
        deploymentType: 'self_hosted',
        host: 'https://es.example.com/',
        authMethod: 'api_key',
      })
    ).toBe('https://es.example.com')
  })

  it('requires a host when self-hosted', () => {
    expect(() => buildBaseUrl({ deploymentType: 'self_hosted', authMethod: 'api_key' })).toThrow(
      /Host is required/
    )
  })
})

describe('every Elasticsearch tool resolves the same cloud host', () => {
  const tools = Object.values(elasticsearchTools) as ToolConfig[]
  const params = {
    deploymentType: 'cloud',
    cloudId: cloudId(`${PARENT_DOMAIN}$${ES_UUID}$${KIBANA_UUID}`),
    authMethod: 'api_key',
    apiKey: 'test-key',
    index: 'products',
    documentId: 'doc-1',
    document: '{}',
    operations: '{}',
  }

  it('covers all thirteen tools', () => {
    expect(tools).toHaveLength(13)
  })

  it.each(tools.map((tool) => [tool.id, tool] as const))('%s', (_id, tool) => {
    const url = typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
    expect(new URL(url).host).toBe(`${ES_UUID}.${PARENT_DOMAIN}`)
  })
})

/**
 * `_bulk` answers `application/json` with HTTP 406, so it is the one tool that
 * must override the shared header builder's default media type.
 */
describe('elasticsearch_bulk wire format', () => {
  it('sends the bulk content type Elasticsearch requires', () => {
    const prepared = prepareToolRequest(elasticsearchTools.elasticsearchBulkTool as ToolConfig, {
      deploymentType: 'self_hosted',
      host: 'https://es.example.com',
      authMethod: 'api_key',
      apiKey: 'test-key',
      operations: '{"index":{"_index":"products","_id":"1"}}\n{"name":"Widget"}',
    })
    expect(prepared.headers.get('content-type')).toBe('application/x-ndjson')
  })
})
