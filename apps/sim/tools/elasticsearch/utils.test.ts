/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildAuthHeaders,
  buildBaseUrl,
  optionalNumber,
  parseCloudId,
  safeIndexPathSegment,
} from '@/tools/elasticsearch/utils'

/**
 * Builds a Cloud ID from its decoded parts the way the Elastic Cloud console does.
 */
function cloudId(label: string, decoded: string): string {
  return `${label}:${Buffer.from(decoded, 'utf-8').toString('base64')}`
}

const ES_UUID = 'cec6f261a74bf24ce33bb8811b84294f'
const KIBANA_UUID = 'c6c2ca6d04224e0f8e4b8b1d6a4d1f0a'
const PARENT_DN = 'us-east-1.aws.found.io'

describe('parseCloudId', () => {
  it("addresses the Elasticsearch UUID host, not the deployment label (Elastic's own sample)", () => {
    const id = cloudId('staging', `${PARENT_DN}$${ES_UUID}$${KIBANA_UUID}`)

    expect(parseCloudId(id)).toBe(`https://${ES_UUID}.${PARENT_DN}`)
  })

  it('never emits the label as a hostname component', () => {
    const id = cloudId('staging', `${PARENT_DN}$${ES_UUID}$${KIBANA_UUID}`)

    expect(parseCloudId(id)).not.toContain('staging')
  })

  it('takes the payload as everything after the FIRST colon, not the second split slice', () => {
    /**
     * A real Cloud ID label never contains a colon, so this value is malformed
     * either way. What matters is HOW it fails: `split(':')[1]` would quietly
     * take the middle slice ("staging") and decode it to garbage, while
     * slicing at the first colon keeps "staging:<payload>" whole — which the
     * base64 check then rejects outright.
     */
    const id = `team:staging:${Buffer.from(`${PARENT_DN}$${ES_UUID}$${KIBANA_UUID}`, 'utf-8').toString('base64')}`

    expect(() => parseCloudId(id)).toThrow(/not valid base64/)
  })

  it('rejects a payload carrying characters outside the base64 alphabet', () => {
    expect(() => parseCloudId('staging:not a payload!')).toThrow(/not valid base64/)
  })

  it('accepts an empty label', () => {
    const id = cloudId('', `${PARENT_DN}$${ES_UUID}$${KIBANA_UUID}`)

    expect(parseCloudId(id)).toBe(`https://${ES_UUID}.${PARENT_DN}`)
  })

  it('accepts a bare payload with no label separator at all', () => {
    const payload = Buffer.from(`${PARENT_DN}$${ES_UUID}$${KIBANA_UUID}`, 'utf-8').toString(
      'base64'
    )

    expect(parseCloudId(payload)).toBe(`https://${ES_UUID}.${PARENT_DN}`)
  })

  it('trims surrounding whitespace from a pasted Cloud ID', () => {
    const id = cloudId('staging', `${PARENT_DN}$${ES_UUID}$${KIBANA_UUID}`)

    expect(parseCloudId(`  ${id}\n`)).toBe(`https://${ES_UUID}.${PARENT_DN}`)
  })

  it('omits an explicit port of 443, which https already implies', () => {
    const id = cloudId('staging', `${PARENT_DN}:443$${ES_UUID}$${KIBANA_UUID}`)

    expect(parseCloudId(id)).toBe(`https://${ES_UUID}.${PARENT_DN}`)
  })

  it('appends a non-default port from the decoded host', () => {
    const id = cloudId('staging', `${PARENT_DN}:9243$${ES_UUID}$${KIBANA_UUID}`)

    expect(parseCloudId(id)).toBe(`https://${ES_UUID}.${PARENT_DN}:9243`)
  })

  it('rejects a payload that decodes without an Elasticsearch UUID', () => {
    const id = cloudId('staging', PARENT_DN)

    expect(() => parseCloudId(id)).toThrow(/not properly formatted/)
  })

  it('rejects a Cloud ID with no encoded payload', () => {
    expect(() => parseCloudId('staging:')).toThrow(/not properly formatted/)
  })

  it('rejects an empty Cloud ID', () => {
    expect(() => parseCloudId('   ')).toThrow(/Cloud ID is required/)
  })

  it('rejects a non-numeric port rather than emitting NaN in the URL', () => {
    const id = cloudId('staging', `${PARENT_DN}:abc$${ES_UUID}$${KIBANA_UUID}`)

    expect(() => parseCloudId(id)).toThrow(/invalid host or port/)
  })
})

describe('buildBaseUrl', () => {
  it('routes a cloud deployment through the Cloud ID decoder', () => {
    const url = buildBaseUrl({
      deploymentType: 'cloud',
      cloudId: cloudId('staging', `${PARENT_DN}$${ES_UUID}$${KIBANA_UUID}`),
      authMethod: 'api_key',
    })

    expect(url).toBe(`https://${ES_UUID}.${PARENT_DN}`)
  })

  it('strips every trailing slash from a self-hosted host, not just the last one', () => {
    const url = buildBaseUrl({
      deploymentType: 'self_hosted',
      host: 'https://es.example.com:9200///',
      authMethod: 'api_key',
    })

    expect(url).toBe('https://es.example.com:9200')
  })

  it('trims whitespace around a pasted self-hosted host', () => {
    const url = buildBaseUrl({
      deploymentType: 'self_hosted',
      host: '  https://es.example.com  ',
      authMethod: 'api_key',
    })

    expect(url).toBe('https://es.example.com')
  })

  it('rejects a self-hosted deployment with no host', () => {
    expect(() =>
      buildBaseUrl({ deploymentType: 'self_hosted', host: '   ', authMethod: 'api_key' })
    ).toThrow(/Host is required/)
  })

  it('rejects a cloud deployment with no Cloud ID', () => {
    expect(() => buildBaseUrl({ deploymentType: 'cloud', authMethod: 'api_key' })).toThrow(
      /Cloud ID is required/
    )
  })
})

describe('buildAuthHeaders', () => {
  it('sends an API key with the ApiKey scheme', () => {
    const headers = buildAuthHeaders({
      deploymentType: 'self_hosted',
      authMethod: 'api_key',
      apiKey: 'abc123',
    })

    expect(headers.Authorization).toBe('ApiKey abc123')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('base64-encodes basic auth credentials', () => {
    const headers = buildAuthHeaders({
      deploymentType: 'self_hosted',
      authMethod: 'basic_auth',
      username: 'elastic',
      password: 'secret',
    })

    expect(headers.Authorization).toBe(`Basic ${Buffer.from('elastic:secret').toString('base64')}`)
  })

  it('honors an overridden content type for NDJSON bulk requests', () => {
    const headers = buildAuthHeaders(
      { deploymentType: 'self_hosted', authMethod: 'api_key', apiKey: 'abc123' },
      'application/x-ndjson'
    )

    expect(headers['Content-Type']).toBe('application/x-ndjson')
  })

  it('rejects basic auth with a username but no password', () => {
    expect(() =>
      buildAuthHeaders({
        deploymentType: 'self_hosted',
        authMethod: 'basic_auth',
        username: 'elastic',
      })
    ).toThrow(/Invalid authentication configuration/)
  })
})

describe('optionalNumber', () => {
  it('keeps a genuine numeric zero instead of treating it as unset', () => {
    expect(optionalNumber(0, 'size')).toBe(0)
  })

  it('keeps a zero that arrived as a string from a text subblock', () => {
    expect(optionalNumber('0', 'size')).toBe(0)
  })

  it('treats undefined, null, and empty string as unset', () => {
    expect(optionalNumber(undefined, 'size')).toBeUndefined()
    expect(optionalNumber(null, 'size')).toBeUndefined()
    expect(optionalNumber('', 'size')).toBeUndefined()
  })

  it('throws a named error instead of forwarding NaN', () => {
    expect(() => optionalNumber('ten', 'size')).toThrow(/size must be a number/)
  })
})

/**
 * Verbatim Cloud IDs from Elastic's own decoder fixtures
 * (`beats/libbeat/cloudid/cloudid_test.go`), which are the authority on where
 * a per-service port may appear in the decoded payload.
 */
const ELASTIC_FIXTURES = {
  customPort:
    'custom-port:dXMtY2VudHJhbDEuZ2NwLmNsb3VkLmVzLmlvOjkyNDMkYWMzMWViYjkwMjQxNzczMTU3MDQzYzM0ZmQyNmZkNDYkYTRjMDYyMzBlNDhjOGZjZTdiZTg4YTA3NGEzYmIzZTA=',
  differentEsKbPort:
    'different-es-kb-port:dXMtY2VudHJhbDEuZ2NwLmNsb3VkLmVzLmlvJGFjMzFlYmI5MDI0MTc3MzE1NzA0M2MzNGZkMjZmZDQ2OjkyNDMkYTRjMDYyMzBlNDhjOGZjZTdiZTg4YTA3NGEzYmIzZTA6OTI0NA==',
  onlyKbSet:
    'only-kb-set:dXMtY2VudHJhbDEuZ2NwLmNsb3VkLmVzLmlvJGFjMzFlYmI5MDI0MTc3MzE1NzA0M2MzNGZkMjZmZDQ2JGE0YzA2MjMwZTQ4YzhmY2U3YmU4OGEwNzRhM2JiM2UwOjkyNDQ=',
  hostAndKbSet:
    'host-and-kb-set:dXMtY2VudHJhbDEuZ2NwLmNsb3VkLmVzLmlvOjkyNDMkYWMzMWViYjkwMjQxNzczMTU3MDQzYzM0ZmQyNmZkNDYkYTRjMDYyMzBlNDhjOGZjZTdiZTg4YTA3NGEzYmIzZTA6OTI0NA==',
  extraItems:
    'extra-items:dXMtY2VudHJhbDEuZ2NwLmNsb3VkLmVzLmlvJGFjMzFlYmI5MDI0MTc3MzE1NzA0M2MzNGZkMjZmZDQ2JGE0YzA2MjMwZTQ4YzhmY2U3YmU4OGEwNzRhM2JiM2UwJGFub3RoZXJpZCRhbmRhbm90aGVy',
} as const

const GCP_ES_UUID = 'ac31ebb90241773157043c34fd26fd46'
const GCP_PARENT_DN = 'us-central1.gcp.cloud.es.io'

describe('parseCloudId per-service ports', () => {
  it('strips a port carried by the Elasticsearch UUID instead of splicing it into the hostname', () => {
    expect(parseCloudId(ELASTIC_FIXTURES.differentEsKbPort)).toBe(
      `https://${GCP_ES_UUID}.${GCP_PARENT_DN}:9243`
    )
  })

  it('never emits a port inside the hostname label', () => {
    expect(parseCloudId(ELASTIC_FIXTURES.differentEsKbPort)).not.toContain(`${GCP_ES_UUID}:9243.`)
  })

  it('builds a parseable URL for a Cloud ID whose ES UUID carries a port', () => {
    expect(() => new URL(parseCloudId(ELASTIC_FIXTURES.differentEsKbPort))).not.toThrow()
  })

  it("takes the parent domain's port when the Elasticsearch UUID has none", () => {
    expect(parseCloudId(ELASTIC_FIXTURES.customPort)).toBe(
      `https://${GCP_ES_UUID}.${GCP_PARENT_DN}:9243`
    )
  })

  it("ignores Kibana's port entirely — it addresses a different service", () => {
    expect(parseCloudId(ELASTIC_FIXTURES.onlyKbSet)).toBe(`https://${GCP_ES_UUID}.${GCP_PARENT_DN}`)
    expect(parseCloudId(ELASTIC_FIXTURES.hostAndKbSet)).toBe(
      `https://${GCP_ES_UUID}.${GCP_PARENT_DN}:9243`
    )
  })

  it('lets the Elasticsearch UUID port override the parent domain port', () => {
    const id = cloudId('mixed', `${GCP_PARENT_DN}:9243$${GCP_ES_UUID}:9244$${KIBANA_UUID}`)

    expect(parseCloudId(id)).toBe(`https://${GCP_ES_UUID}.${GCP_PARENT_DN}:9244`)
  })

  it('omits an Elasticsearch UUID port of 443 that overrides a non-default parent port', () => {
    const id = cloudId('mixed', `${GCP_PARENT_DN}:9243$${GCP_ES_UUID}:443$${KIBANA_UUID}`)

    expect(parseCloudId(id)).toBe(`https://${GCP_ES_UUID}.${GCP_PARENT_DN}`)
  })

  it('rejects a non-numeric port on the Elasticsearch UUID rather than emitting NaN', () => {
    const id = cloudId('bad', `${GCP_PARENT_DN}$${GCP_ES_UUID}:abc$${KIBANA_UUID}`)

    expect(() => parseCloudId(id)).toThrow(/invalid host or port/)
  })

  it('tolerates a payload with more than three $-separated parts', () => {
    expect(parseCloudId(ELASTIC_FIXTURES.extraItems)).toBe(
      `https://${GCP_ES_UUID}.${GCP_PARENT_DN}`
    )
  })
})

describe('safeIndexPathSegment', () => {
  it("encodes Elasticsearch's canonical date-math index instead of rejecting it", () => {
    expect(safeIndexPathSegment('<logstash-{now/d}>', 'index')).toBe('%3Clogstash-%7Bnow%2Fd%7D%3E')
  })

  it('produces a path the URL parser leaves intact — %2F is not a separator', () => {
    const built = new URL(
      `https://es.example.com/${safeIndexPathSegment('<logstash-{now/d}>', 'index')}/_search`
    )

    expect(built.pathname).toBe('/%3Clogstash-%7Bnow%2Fd%7D%3E/_search')
  })

  it('keeps date math without a slash working, as it already did', () => {
    expect(safeIndexPathSegment('<logstash-{now-1d}>', 'index')).toBe('%3Clogstash-%7Bnow-1d%7D%3E')
  })

  it('still rejects a bare dot segment, which no encoding neutralizes', () => {
    expect(() => safeIndexPathSegment('..', 'index')).toThrow(/path traversal/)
    expect(() => safeIndexPathSegment('.', 'index')).toThrow(/path traversal/)
    expect(() => safeIndexPathSegment('  ..  ', 'index')).toThrow(/path traversal/)
  })

  it('leaves an embedded dot pair inert rather than popping a path segment', () => {
    const built = new URL(
      `https://es.example.com/v1/${safeIndexPathSegment('a/../..', 'index')}/_search`
    )

    expect(built.pathname).toBe('/v1/a%2F..%2F../_search')
  })

  it('rejects an empty index', () => {
    expect(() => safeIndexPathSegment('   ', 'index')).toThrow(/index is required/)
  })

  it('percent-encodes a comma-separated multi-target, which Elasticsearch decodes back', () => {
    expect(safeIndexPathSegment('logs-a,logs-b', 'index')).toBe('logs-a%2Clogs-b')
  })

  it('encodes a wildcard target', () => {
    expect(safeIndexPathSegment('logs-*', 'index')).toBe('logs-*')
  })
})
