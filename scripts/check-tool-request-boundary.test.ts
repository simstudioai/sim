import { describe, expect, it } from 'vitest'
import { auditToolSelfHops } from './check-tool-request-boundary'

const ENCODED_ID_TEMPLATE = '$' + '{encodeURIComponent(params.id)}'

function auditRequest(request: string) {
  return auditToolSelfHops(`
    const tool = {
      id: 'test_tool',
      request: { ${request} },
    }
  `)
}

describe('tool self-hop audit', () => {
  it('allows an absolute external provider URL', () => {
    const audit = auditRequest(
      "url: 'https://api.example.com/v1/items', method: 'GET', headers: () => ({})"
    )

    expect(audit).toEqual({
      violations: [],
      detectedSelfHops: 0,
      legacyInternalPolicies: 0,
    })
  })

  it('rejects a literal same-origin API route', () => {
    const audit = auditRequest("url: '/api/tools/test', method: 'POST'")

    expect(audit.detectedSelfHops).toBe(1)
    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'same-origin-tool-request',
      }),
    ])
  })

  it('rejects a dynamic same-origin API route', () => {
    const audit = auditRequest(`url: (params) => \`/api/tools/${ENCODED_ID_TEMPLATE}\``)

    expect(audit.detectedSelfHops).toBe(1)
    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a concatenated same-origin API route', () => {
    const audit = auditRequest("url: (params) => '/api/tools/' + params.id")

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a compound same-origin URL constructor path', () => {
    const audit = auditRequest(`
      url: (params) => new URL('/api/tools/' + params.id, params.baseUrl).toString()
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin path referenced through a constant', () => {
    const audit = auditToolSelfHops(`
      const INTERNAL_URL = '/api/tools/test'
      const tool = {
        id: 'test_tool',
        request: { url: INTERNAL_URL, method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin path returned through a helper', () => {
    const audit = auditToolSelfHops(`
      function buildInternalUrl(id) {
        return '/api/tools/' + id
      }
      const tool = {
        id: 'test_tool',
        request: { url: (params) => buildInternalUrl(params.id), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a conditional builder with a same-origin branch', () => {
    const audit = auditRequest(`
      url: (params) =>
        params.useExternal
          ? 'https://api.example.com/v1/items'
          : '/api/tools/test'
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin URL constructor', () => {
    const audit = auditRequest(`
      url: (params) => {
        const url = new URL('/api/tools/test', params.baseUrl)
        return url.toString()
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects the obsolete request.internal escape hatch', () => {
    const audit = auditRequest('internal: true, url: (params) => buildInternalRoute(params.id)')

    expect(audit.legacyInternalPolicies).toBe(1)
    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'legacy-internal-policy',
      }),
    ])
  })

  it('rejects request.internal even when the URL comes only from a spread', () => {
    const audit = auditToolSelfHops(`
      const externalRequest = { url: 'https://api.example.com/v1/items' }
      const tool = {
        id: 'test_tool',
        request: { ...externalRequest, internal: true },
      }
    `)

    expect(audit.legacyInternalPolicies).toBe(1)
    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'legacy-internal-policy',
      }),
    ])
  })

  it('does not mistake a provider-relative path argument for a Sim API route', () => {
    const audit = auditRequest("url: (params) => providerUrl('/api/messages', params.host)")

    expect(audit.violations).toEqual([])
  })
})
