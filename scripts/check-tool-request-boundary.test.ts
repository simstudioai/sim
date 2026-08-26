import { describe, expect, it } from 'vitest'
import { auditToolRequestTrust } from './check-tool-request-boundary'

const PARAM_TEMPLATE_EXPRESSION = '$' + '{params.id}'

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
    const audit = auditRequest(`url: (params) => \`/api/tools/${PARAM_TEMPLATE_EXPRESSION}\``)

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
      `internal: true, url: (params) => \`/api/tools/${PARAM_TEMPLATE_EXPRESSION}\``
    )

    expect(audit.dynamicInternalRoutes).toBe(1)
    expect(audit.dynamicInternalPolicies).toBe(1)
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

  it('does not mistake a provider-relative helper argument for a Sim API route', () => {
    const audit = auditRequest("url: (params) => providerUrl('/api/messages', params.host)")

    expect(audit.dynamicInternalRoutes).toBe(0)
    expect(audit.violations).toEqual([])
  })
})
