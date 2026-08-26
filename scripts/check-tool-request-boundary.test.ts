import { describe, expect, it } from 'vitest'
import { auditToolRequestTrust } from './check-tool-request-boundary'

const PARAM_TEMPLATE_EXPRESSION = '$' + '{params.id}'
const INPUT_TEMPLATE_EXPRESSION = '$' + '{input.id}'
const DESTRUCTURED_TEMPLATE_EXPRESSION = '$' + '{id}'
const ENCODED_TEMPLATE_EXPRESSION = '$' + '{encodeURIComponent(params.id)}'

function auditRequest(request: string) {
  return auditToolRequestTrust(`
    const tool = {
      id: 'test_tool',
      request: { ${request} },
    }
  `)
}

describe('tool request trust audit', () => {
  it('allows a literal internal URL because the definition owns the full path', () => {
    const audit = auditRequest("url: '/api/tools/test', method: 'GET', headers: () => ({})")

    expect(audit.dynamicInternalRoutes).toBe(0)
    expect(audit.violations).toEqual([])
  })

  it('rejects an unmarked dynamic internal URL', () => {
    const audit = auditRequest(`url: (params) => \`/api/tools/\${encodeURIComponent(params.id)}\``)

    expect(audit.dynamicInternalRoutes).toBe(1)
    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'missing-internal-policy',
      }),
    ])
  })

  it('accepts a marked dynamic internal URL', () => {
    const audit = auditRequest(
      `internal: true, url: (params) => \`/api/tools/\${encodeURIComponent(params.id)}\``
    )

    expect(audit.dynamicInternalRoutes).toBe(1)
    expect(audit.dynamicInternalPolicies).toBe(1)
    expect(audit.violations).toEqual([])
  })

  it('rejects an unencoded internal path parameter', () => {
    const audit = auditRequest(
      `internal: true, url: (params) => \`/api/tools/${PARAM_TEMPLATE_EXPRESSION}\``
    )

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unsafe-internal-path-interpolation',
      }),
    ])
  })

  it('detects a concatenated dynamic internal URL', () => {
    const audit = auditRequest("url: (params) => '/api/tools/' + encodeURIComponent(params.id)")

    expect(audit.dynamicInternalRoutes).toBe(1)
    expect(audit.violations[0]?.reason).toBe('missing-internal-policy')
  })

  it('rejects an unencoded concatenated internal path parameter', () => {
    const audit = auditRequest("internal: true, url: (params) => '/api/tools/' + params.id")

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unsafe-internal-path-interpolation',
      }),
    ])
  })

  it('accepts an encoded concatenated internal path parameter', () => {
    const audit = auditRequest(
      "internal: true, url: (params) => '/api/tools/' + encodeURIComponent(params.id)"
    )

    expect(audit.violations).toEqual([])
  })

  it('rejects an unencoded path parameter with a renamed callback binding', () => {
    const audit = auditRequest(
      `internal: true, url: (input) => \`/api/tools/${INPUT_TEMPLATE_EXPRESSION}\``
    )

    expect(audit.violations[0]?.reason).toBe('unsafe-internal-path-interpolation')
  })

  it('rejects an unencoded destructured callback binding', () => {
    const audit = auditRequest(
      `internal: true, url: ({ id }) => \`/api/tools/${DESTRUCTURED_TEMPLATE_EXPRESSION}\``
    )

    expect(audit.violations[0]?.reason).toBe('unsafe-internal-path-interpolation')
  })

  it('rejects an unencoded template nested inside a concatenation', () => {
    const audit = auditRequest(
      `internal: true, url: (params) => '/api/tools/' + \`${PARAM_TEMPLATE_EXPRESSION}\``
    )

    expect(audit.violations[0]?.reason).toBe('unsafe-internal-path-interpolation')
  })

  it('accepts an encoded template nested inside a concatenation', () => {
    const audit = auditRequest(
      `internal: true, url: (params) => '/api/tools/' + \`${ENCODED_TEMPLATE_EXPRESSION}\``
    )

    expect(audit.violations).toEqual([])
  })

  it('allows a raw query value after a nested encoded path template', () => {
    const audit = auditRequest(
      `internal: true, url: (params) => '/api/tools/' + \`${ENCODED_TEMPLATE_EXPRESSION}?query=\` + params.query`
    )

    expect(audit.violations).toEqual([])
  })

  it('accepts a definition-owned policy for conditional internal and external branches', () => {
    const audit = auditRequest(`
      internal: (params) => params.internal,
      url: (params) => params.internal ? '/api/tools/test' : 'https://example.com/test'
    `)

    expect(audit.dynamicInternalRoutes).toBe(1)
    expect(audit.dynamicInternalPolicies).toBe(1)
    expect(audit.violations).toEqual([])
  })

  it('rejects static trust for a mixed internal and external URL builder', () => {
    const audit = auditRequest(`
      internal: true,
      url: (params) => params.internal ? '/api/tools/test' : 'https://example.com/test'
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'mixed-route-requires-conditional-policy',
      }),
    ])
  })

  it('detects internal paths constructed through URL', () => {
    const audit = auditRequest(`
      url: (params) => {
        const url = new URL('/api/tools/test', 'http://placeholder')
        url.searchParams.set('id', params.id)
        return url.pathname + url.search
      }
    `)

    expect(audit.dynamicInternalRoutes).toBe(1)
    expect(audit.violations[0]?.reason).toBe('missing-internal-policy')
  })

  it('rejects internal trust on an external-only URL builder', () => {
    const audit = auditRequest("internal: true, url: () => 'https://example.com/test'")

    expect(audit.violations[0]?.reason).toBe('internal-policy-without-internal-route')
  })

  it('allows an explicit policy when a helper owns the internal route construction', () => {
    const audit = auditRequest('internal: true, url: (params) => buildInternalRoute(params.id)')

    expect(audit.dynamicInternalRoutes).toBe(0)
    expect(audit.dynamicInternalPolicies).toBe(1)
    expect(audit.violations).toEqual([])
  })

  it('does not mistake a provider-relative helper argument for a Sim API route', () => {
    const audit = auditRequest("url: (params) => providerUrl('/api/messages', params.host)")

    expect(audit.dynamicInternalRoutes).toBe(0)
    expect(audit.violations).toEqual([])
  })
})
