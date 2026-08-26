/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildAuthHeaders,
  buildBaseUrl,
  optionalNumber,
  parseCloudId,
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
