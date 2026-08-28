import { describe, expect, it } from 'vitest'
import { auditToolSelfHops } from './check-tool-request-boundary'

const ENCODED_ID_TEMPLATE = '$' + '{encodeURIComponent(params.id)}'
const GET_BASE_URL_TEMPLATE = '$' + '{getBaseUrl()}'
const PARAMS_HOST_TEMPLATE = '$' + '{params.host}'

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

  it('rejects a statically concatenated same-origin API route', () => {
    const audit = auditRequest("url: () => '/' + 'api/tools/test', method: 'POST'")

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin API route declared with method syntax', () => {
    const audit = auditRequest("url() { return '/api/tools/test' }, method: 'POST'")

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a compound same-origin URL constructor path', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: {
          url: (params) => new URL('/api/tools/' + params.id, getBaseUrl()).toString(),
          method: 'POST',
        },
      }
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

  it('rejects a same-origin request object referenced through an identifier', () => {
    const audit = auditToolSelfHops(`
      const internalRequest = { url: '/api/tools/test', method: 'POST' }
      const tool = { id: 'test_tool', request: internalRequest }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'same-origin-tool-request',
      }),
    ])
  })

  it('rejects a same-origin request inherited through a tool-level spread', () => {
    const audit = auditToolSelfHops(`
      const base = { request: { url: '/api/tools/test', method: 'POST' } }
      const tool = { id: 'test_tool', ...base }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'same-origin-tool-request',
      }),
    ])
  })

  it('rejects a same-origin URL inherited through a request-object spread', () => {
    const audit = auditToolSelfHops(`
      const internalRequest = { url: '/api/tools/test', method: 'POST' }
      const tool = {
        id: 'test_tool',
        request: { ...internalRequest, headers: () => ({}) },
      }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'same-origin-tool-request',
      }),
    ])
  })

  it('uses a direct external URL that overrides an internal request spread', () => {
    const audit = auditToolSelfHops(`
      const internalRequest = { url: '/api/tools/test', method: 'POST' }
      const tool = {
        id: 'test_tool',
        request: {
          ...internalRequest,
          url: 'https://api.example.com/v1/items',
        },
      }
    `)

    expect(audit.violations).toEqual([])
  })

  it('rejects an unresolved spread that can override a known request', () => {
    const audit = auditToolSelfHops(`
      const known = { url: 'https://api.example.com/v1/items', method: 'POST' }
      const tool = { id: 'test_tool', request: { ...known, ...unknownRequest } }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unresolved-request-policy',
      }),
    ])
  })

  it('retains an earlier URL when only one spread branch overrides it', () => {
    const audit = auditToolSelfHops(`
      const override = flag
        ? { url: 'https://api.example.com/v1/items' }
        : { headers: () => ({}) }
      const tool = {
        id: 'test_tool',
        request: { url: '/api/tools/test', method: 'POST', ...override },
      }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'same-origin-tool-request',
      }),
    ])
  })

  it('rejects a same-origin request object referenced through a member', () => {
    const requestContainer = `
      const requestContainer = {
        request: { url: '/api/tools/test', method: 'POST' },
      }
    `
    const audit = auditToolSelfHops(`
      ${requestContainer}
      const tool = { id: 'test_tool', request: requestContainer.request }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'same-origin-tool-request',
      }),
    ])
  })

  it('rejects an indirect legacy internal request policy', () => {
    const audit = auditToolSelfHops(`
      const legacyRequest = {
        internal: true,
        url: 'https://api.example.com/v1/items',
        method: 'POST',
      }
      const tool = { id: 'test_tool', request: legacyRequest }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'legacy-internal-policy',
      }),
    ])
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
    const audit = auditToolSelfHops(`
      import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: {
          url: () => {
            const url = new URL('/api/tools/test', getInternalApiBaseUrl())
            return url.toString()
          },
          method: 'POST',
        },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin path passed through a local URL helper', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl as getSimOrigin } from '@/lib/core/utils/urls'
      function providerUrl(path, host) {
        return new URL(path, host).toString()
      }
      const simOrigin = getSimOrigin()
      const tool = {
        id: 'test_tool',
        request: {
          url: () => providerUrl('/api/tools/test', simOrigin),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin request returned by a local helper', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function buildRequest(path, host) {
        return {
          url: () => new URL(path, host).toString(),
          method: 'POST',
        }
      }
      const tool = {
        id: 'test_tool',
        request: buildRequest('/api/tools/test', getBaseUrl()),
      }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'same-origin-tool-request',
      }),
    ])
  })

  it('rejects a same-origin path forwarded through nested local helpers', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function providerUrl(path, host) {
        return new URL(path, host).toString()
      }
      function buildUrl(path) {
        return providerUrl(path, getBaseUrl())
      }
      const tool = {
        id: 'test_tool',
        request: { url: () => buildUrl('/api/tools/test'), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin path concatenated with the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: { url: () => getBaseUrl() + '/api/tools/test', method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a helper-returned path concatenated with the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function buildPath() {
        return '/api/tools/test'
      }
      const tool = {
        id: 'test_tool',
        request: { url: () => getBaseUrl() + buildPath(), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a locally-bound helper path concatenated with the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function buildPath() {
        const path = '/api/tools/test'
        return path
      }
      const tool = {
        id: 'test_tool',
        request: { url: () => getBaseUrl() + buildPath(), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin path interpolated with the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: { url: () => \`${GET_BASE_URL_TEMPLATE}/api/tools/test\`, method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a helper-returned path interpolated with the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function buildPath() {
        return '/api/tools/test'
      }
      const tool = {
        id: 'test_tool',
        request: { url: () => \`\${getBaseUrl()}\${buildPath()}\`, method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a helper-returned path resolved against the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function buildPath() {
        return '/api/tools/test'
      }
      const tool = {
        id: 'test_tool',
        request: { url: () => new URL(buildPath(), getBaseUrl()).toString(), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a relative internal path resolved against the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: { url: () => new URL('api/tools/test', getBaseUrl()).toString(), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a normalized relative internal path resolved against the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function buildPath() {
        return 'provider/../api/tools/test'
      }
      const tool = {
        id: 'test_tool',
        request: { url: () => new URL(buildPath(), getBaseUrl()).toString(), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects an internal path resolved against a path-normalized Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const baseUrl = getBaseUrl() + '/tool-proxy/'
      const tool = {
        id: 'test_tool',
        request: { url: () => new URL('/api/tools/test', baseUrl).toString(), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects an internal path resolved against a template-normalized Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const baseUrl = \`\${getBaseUrl()}/tool-proxy/\`
      const tool = {
        id: 'test_tool',
        request: { url: () => new URL('/api/tools/test', baseUrl).toString(), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects an internal path resolved against a helper-normalized Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function getNormalizedOrigin() {
        const origin = \`\${getBaseUrl()}/tool-proxy/\`
        return origin
      }
      const tool = {
        id: 'test_tool',
        request: {
          url: () => new URL('/api/tools/test', getNormalizedOrigin()).toString(),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a one-argument URL built from the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: {
          url: () => new URL(\`${GET_BASE_URL_TEMPLATE}/api/tools/test\`).toString(),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a one-argument URL concatenated from the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: {
          url: () => new URL(getBaseUrl() + '/api/tools/test').toString(),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a chained path concatenated from the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: { url: () => getBaseUrl() + '/api' + '/tools/test', method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a known Sim URL builder wrapped in URL construction', () => {
    const audit = auditToolSelfHops(`
      import { buildAPIUrl } from '@/executor/utils/http'
      const tool = {
        id: 'test_tool',
        request: {
          url: () => new URL(buildAPIUrl('/api/tools/test')).toString(),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects an internal path resolved against a local Sim-origin wrapper', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      function getHost() {
        return getBaseUrl()
      }
      const tool = {
        id: 'test_tool',
        request: { url: () => new URL('/api/tools/test', getHost()).toString(), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin URL returned by an imported helper', () => {
    const audit = auditToolSelfHops(`
      import { buildWorkflowMcpServerUrl } from '@/lib/mcp/urls'
      const tool = {
        id: 'test_tool',
        request: { url: (params) => buildWorkflowMcpServerUrl(params.id), method: 'POST' },
      }
    `)

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('rejects a same-origin path passed through a known imported URL builder', () => {
    const audit = auditToolSelfHops(`
      import { buildAPIUrl as buildSimUrl } from '@/executor/utils/http'
      const tool = {
        id: 'test_tool',
        request: {
          url: () => buildSimUrl('/api/tools/test').toString(),
          method: 'POST',
        },
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

  it('allows an API-shaped provider path resolved against an external origin', () => {
    const audit = auditToolSelfHops(`
      function providerUrl(path, host) {
        return new URL(path, host).toString()
      }
      const tool = {
        id: 'test_tool',
        request: {
          url: () => providerUrl('/api/messages', 'https://provider.example.com'),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations).toEqual([])
  })

  it('allows a helper-returned API-shaped path resolved against an external origin', () => {
    const audit = auditToolSelfHops(`
      function buildPath() {
        return '/api/messages'
      }
      const tool = {
        id: 'test_tool',
        request: {
          url: () => new URL(buildPath(), 'https://provider.example.com').toString(),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations).toEqual([])
  })

  it('allows a protocol-relative provider URL resolved against the Sim origin', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: {
          url: () => new URL('//provider.example.com/api/messages', getBaseUrl()).toString(),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations).toEqual([])
  })

  it('does not treat hostname mutation as Sim-origin normalization', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const providerOrigin = getBaseUrl() + '.provider.example.com'
      const tool = {
        id: 'test_tool',
        request: {
          url: () => new URL('/api/messages', providerOrigin).toString(),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations).toEqual([])
  })

  it('does not treat a dynamic hostname suffix as Sim-origin normalization', () => {
    const audit = auditToolSelfHops(`
      import { getBaseUrl } from '@/lib/core/utils/urls'
      const tool = {
        id: 'test_tool',
        request: {
          url: (params) => new URL(
            '/api/messages',
            \`\${getBaseUrl()}\${params.providerDomain}\`
          ).toString(),
          method: 'POST',
        },
      }
    `)

    expect(audit.violations).toEqual([])
  })

  it('allows an API-shaped path interpolated with an external provider origin', () => {
    const audit = auditRequest(
      `url: (params) => \`${PARAMS_HOST_TEMPLATE}/api/messages\`, method: 'POST'`
    )

    expect(audit.violations).toEqual([])
  })

  it('allows a one-argument URL for an external provider API', () => {
    const audit = auditRequest(
      "url: () => new URL('https://api.example.com/api/messages').toString(), method: 'POST'"
    )

    expect(audit.violations).toEqual([])
  })

  it('ignores internal-looking returns in an unused nested callback', () => {
    const audit = auditRequest(`
      url: () => {
        const parseProviderField = () => {
          return '/api/provider-field'
        }
        return 'https://api.example.com/v1/items'
      },
      method: 'POST'
    `)

    expect(audit.violations).toEqual([])
  })

  it('allows an external request returned by a local helper', () => {
    const audit = auditToolSelfHops(`
      function buildRequest(path, host) {
        return {
          url: () => new URL(path, host).toString(),
          method: 'POST',
        }
      }
      const tool = {
        id: 'test_tool',
        request: buildRequest('/api/messages', 'https://provider.example.com'),
      }
    `)

    expect(audit.violations).toEqual([])
  })

  it('allows a provider request returned by an imported helper', () => {
    const audit = auditToolSelfHops(
      `
        import { snowflakeStatementRequest } from '@/tools/snowflake/utils'
        const tool = {
          id: 'test_tool',
          request: snowflakeStatementRequest(() => ({ statement: 'select 1' })),
        }
      `,
      'apps/sim/tools/snowflake/audit-fixture.ts'
    )

    expect(audit.violations).toEqual([])
  })

  it('preserves Sim-origin arguments passed into an imported request factory', () => {
    const audit = auditToolSelfHops(
      `
        import { getBaseUrl } from '@/lib/core/utils/urls'
        import { createRequest } from './fixtures/check-tool-request-boundary/request-factory'
        const tool = { id: 'test_tool', request: createRequest(getBaseUrl()) }
      `,
      'scripts/audit-fixture.ts'
    )

    expect(audit.violations[0]?.reason).toBe('same-origin-tool-request')
  })

  it('allows an external request object referenced through a member', () => {
    const audit = auditToolSelfHops(`
      const baseTool = {
        request: { url: 'https://api.example.com/v1/items', method: 'GET' },
      }
      const tool = { id: 'test_tool', request: baseTool.request }
    `)

    expect(audit.violations).toEqual([])
  })

  it('rejects a tool request object that cannot be statically resolved', () => {
    const audit = auditToolSelfHops(`
      const tool = { id: 'test_tool', request: unknownRequestFactory() }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unresolved-request-policy',
      }),
    ])
  })

  it('rejects a direct-id tool whose request may come from an unresolved spread', () => {
    const audit = auditToolSelfHops(`
      const tool = { id: 'test_tool', ...unknownBase }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unresolved-request-policy',
      }),
    ])
  })

  it('rejects a request when any conditional branch cannot be resolved', () => {
    const audit = auditToolSelfHops(`
      const external = { url: 'https://api.example.com/v1/items', method: 'GET' }
      const tool = {
        id: 'test_tool',
        request: flag ? external : unknownRequestFactory(),
      }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unresolved-request-policy',
      }),
    ])
  })

  it('does not use a nested function return to resolve an outer request factory', () => {
    const audit = auditToolSelfHops(`
      function buildRequest() {
        function decoy() {
          return { url: 'https://api.example.com/v1/items', method: 'GET' }
        }
        return unknownRequestFactory()
      }
      const tool = { id: 'test_tool', request: buildRequest() }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unresolved-request-policy',
      }),
    ])
  })
})
