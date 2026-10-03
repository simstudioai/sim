import { describe, expect, it } from 'vitest'
import { auditToolSelfHops, mayAccessToolRequest } from './check-tool-request-boundary'

const ENCODED_ID_TEMPLATE = '$' + '{encodeURIComponent(params.id)}'
const GET_BASE_URL_TEMPLATE = '$' + '{getBaseUrl()}'
const _PARAMS_HOST_TEMPLATE = '$' + '{params.host}'

function auditRequest(request: string) {
  return auditToolSelfHops(`
    const tool = {
      id: 'test_tool',
      request: { ${request} },
    }
  `)
}

describe('tool self-hop audit', () => {
  it('rejects the retired direct execution property', () => {
    const audit = auditToolSelfHops(`
      const tool = {
        id: 'test_tool',
        directExecution: async () => ({ success: true, output: {} }),
      }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({ reason: 'retired-direct-execution' }),
    ])
  })

  it('allows ordinary operation implementations', () => {
    const audit = auditToolSelfHops(`
      const tool = {
        id: 'test_tool',
        operation: { input: (params) => params },
      }
    `)

    expect(audit.violations).toEqual([])
  })

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

  it('rejects same-origin opt-in on an integration tool', () => {
    const audit = auditToolSelfHops(`
      const tool = {
        id: 'test_tool',
        request: {
          allowSameOrigin: true,
          url: (params) => params.url,
          method: 'POST',
          headers: () => ({}),
        },
      }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unapproved-same-origin-policy',
      }),
    ])
  })

  it.each(['http_request', 'webhook_request'])(
    'allows the intentional same-origin policy on %s',
    (toolId) => {
      const audit = auditToolSelfHops(`
        const tool = {
          id: '${toolId}',
          request: {
            allowSameOrigin: true,
            url: (params) => params.url,
            method: 'POST',
            headers: () => ({}),
          },
        }
      `)

      expect(audit.violations).toEqual([])
    }
  )

  it('fails closed on a computed request property key', () => {
    const audit = auditToolSelfHops(`
      const tool = {
        id: 'test_tool',
        [runtimeRequestKey]: {
          url: 'https://provider.example.com',
          method: 'POST',
          headers: () => ({}),
        },
      }
    `)

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unresolved-request-policy',
      }),
    ])
  })

  it('does not mistake a provider-relative path argument for a Sim API route', () => {
    const audit = auditToolSelfHops(`
      function providerUrl(path, host) {
        return new URL(path, host).toString()
      }
      const tool = {
        id: 'test_tool',
        request: { url: (params) => providerUrl('/api/messages', params.host), method: 'GET' },
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

  it('fails closed when a dynamic suffix follows the Sim origin', () => {
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

    expect(audit.violations).toEqual([
      expect.objectContaining({
        toolId: 'test_tool',
        reason: 'unresolved-request-policy',
      }),
    ])
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

  it('rejects a request URL returned by an uninspectable helper', () => {
    const audit = auditToolSelfHops(`
      const tool = {
        id: 'test_tool',
        request: { url: () => unknownUrlHelper(), method: 'GET' },
      }
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

describe('tool request access candidate scan', () => {
  it('finds direct request member access', () => {
    expect(mayAccessToolRequest('const url = tool.request.url')).toBe(true)
  })
})
