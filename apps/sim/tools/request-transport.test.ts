import { describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { requestTool } from '@/tools/http/request'
import { webhookRequestTool } from '@/tools/http/webhook_request'
import { tools } from '@/tools/registry'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

vi.unmock('@/tools/registry')

const privateProvenanceTools = Object.entries(tools).filter(
  ([, tool]) => tool.request.modelInput?.mode === 'private-provenance'
)
const dynamicRouteTools = Object.entries(tools).filter(
  ([, tool]) => typeof tool.request.url === 'function' && !tool.directExecution
)
const PROBE_CONTEXT = {
  workflowId: 'workflow-probe',
  workspaceId: 'workspace-probe',
  userId: 'user-probe',
  executionId: 'execution-probe',
} as const
const PROBE_FILE = {
  name: 'probe.txt',
  mimeType: 'text/plain',
  data: 'data:text/plain;base64,cHJvYmU=',
} as const
const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function createSchemaProbeParams(
  tool: ToolConfig,
  includeOptional: boolean,
  adversarialPathStrings = false
) {
  const params: Record<string, unknown> = {
    _context: PROBE_CONTEXT,
    ...PROBE_CONTEXT,
  }

  for (const [name, schema] of Object.entries(tool.params)) {
    if (!includeOptional && !schema.required) continue

    let value: unknown
    if (name === 'mimeType') value = includeOptional ? EXCEL_MIME_TYPE : undefined
    else if (name === 'content') value = includeOptional ? '<at>Probe User</at>' : 'Plain text'
    else if (/(?:url|host)$/i.test(name)) {
      value = 'https://example.com'
    } else if (name === 'method') value = 'GET'
    else if (schema.type === 'file')
      value = includeOptional || schema.required ? PROBE_FILE : undefined
    else if (schema.type === 'file[]') value = includeOptional ? [PROBE_FILE] : []
    else if (schema.type === 'array') value = includeOptional ? [{ id: 'item-probe' }] : []
    else if (schema.type === 'object') value = {}
    else if (schema.type === 'json') value = includeOptional ? [{ id: 'item-probe' }] : {}
    else if (schema.type === 'number') value = 1
    else if (schema.type === 'boolean') value = includeOptional
    else if (adversarialPathStrings) value = '../probe?next=/api'
    else value = name.toLowerCase().includes('id') ? 'id-probe' : 'probe'

    if (value !== undefined) params[name] = value
  }

  return params
}

function isAbsoluteHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function createRequestTool(
  url: string | ((params: Record<string, unknown>) => string),
  internal?: true | ((params: Record<string, unknown>) => boolean)
): ToolConfig {
  return {
    id: 'request_transport_probe',
    name: 'Request transport probe',
    description: 'Tests request transport trust decisions',
    version: '1.0.0',
    params: {},
    request: {
      url,
      method: 'GET',
      headers: () => ({}),
      ...(internal ? { internal } : {}),
    },
  }
}

describe('request URL trust', () => {
  it('keeps literal Sim API routes internal', () => {
    const request = prepareToolRequest(createRequestTool('/api/tools/probe'), {})

    expect(request.isInternalRoute).toBe(true)
  })

  it('requires dynamic Sim API routes to opt in', () => {
    const untrustedTool = createRequestTool(() => '/api/tools/probe')
    const internalTool = createRequestTool(() => '/api/tools/probe', true)

    expect(() => prepareToolRequest(untrustedTool, {})).toThrow(
      'External tool requests require an absolute HTTP(S) URL'
    )
    expect(prepareToolRequest(internalTool, {}).isInternalRoute).toBe(true)
  })

  it('rejects an internal definition that resolves outside the Sim API', () => {
    const tool = createRequestTool(() => 'https://example.com', true)

    expect(() => prepareToolRequest(tool, {})).toThrow(
      'Internal tool requests must target a Sim API route'
    )
  })

  it.each([
    '/api/tools/probe/../auth/oauth/token',
    '/api/tools/probe/%2e%2e/auth/oauth/token',
    '/api/tools/probe\\..\\auth/oauth/token',
    '/api/tools/probe value',
    '/api/tools/probe?next=/auth/oauth/token',
  ])('rejects a non-canonical internal route: %s', (url) => {
    expect(() =>
      prepareToolRequest(
        createRequestTool(() => url, true),
        {}
      )
    ).toThrow('Internal tool requests must target a Sim API route')
  })

  it('allows encoded path segments and query values on internal routes', () => {
    const request = prepareToolRequest(
      createRequestTool(() => '/api/tools/probe/probe%20value?next=..%2Fsafe', true),
      {}
    )

    expect(request.isInternalRoute).toBe(true)
  })

  it('supports definition-owned trust for a conditional URL builder', () => {
    const tool = createRequestTool(
      (params) => (params.useInternal === true ? '/api/tools/probe' : 'https://example.com/probe'),
      (params) => params.useInternal === true
    )

    expect(prepareToolRequest(tool, { useInternal: true }).isInternalRoute).toBe(true)
    expect(prepareToolRequest(tool, { useInternal: false }).isInternalRoute).toBe(false)
  })

  it.each(['relative/path', 'ftp://example.com/file', 'javascript:alert(1)'])(
    'rejects an invalid external URL: %s',
    (url) => {
      const tool = createRequestTool(() => url)

      expect(() => prepareToolRequest(tool, {})).toThrow(
        'External tool requests require an absolute HTTP(S) URL'
      )
    }
  )

  it('allows absolute HTTP and HTTPS URLs on the external transport', () => {
    expect(
      prepareToolRequest(
        createRequestTool(() => 'http://example.com'),
        {}
      ).isInternalRoute
    ).toBe(false)
    expect(
      prepareToolRequest(
        createRequestTool(() => 'https://example.com'),
        {}
      ).isInternalRoute
    ).toBe(false)
  })

  it.each([
    ['http_request', requestTool, { url: '/api/auth/oauth/token', method: 'GET' }],
    ['webhook_request', webhookRequestTool, { url: '/api/auth/oauth/token', body: {} }],
  ])('rejects a relative URL from %s', (_toolId, tool, params) => {
    expect(() => prepareToolRequest(tool, params)).toThrow(
      'External tool requests require an absolute HTTP(S) URL'
    )
  })
})

describe('dynamic internal route registry invariant', () => {
  it('covers every dynamic registry URL, with explicit declarations as the trust policy', () => {
    expect(dynamicRouteTools.length).toBeGreaterThan(0)
  })

  it('probes every dynamic registry URL against its declared trust policy', () => {
    let exercisedTools = 0

    for (const [toolId, tool] of dynamicRouteTools) {
      const urlBuilder = tool.request.url
      if (typeof urlBuilder !== 'function') throw new Error(`${toolId} must have a dynamic URL`)
      const policy = tool.request.internal
      const observations: Array<{ internal: boolean; url: string }> = []
      const scenarios = [
        createSchemaProbeParams(tool, false),
        createSchemaProbeParams(tool, true),
        createSchemaProbeParams(tool, true, true),
      ]

      for (const params of scenarios) {
        let url: string
        let internal: boolean
        try {
          url = urlBuilder(params as never)
          internal = typeof policy === 'function' ? policy(params as never) : policy === true
        } catch {
          continue
        }

        if (!url && policy === undefined) continue
        observations.push({ internal, url })
        expect(
          internal ? url.startsWith('/api/') : isAbsoluteHttpUrl(url),
          `${toolId} resolved ${url} outside its declared request trust`
        ).toBe(true)
        expect(() =>
          prepareToolRequest(
            createRequestTool(() => url, internal ? true : undefined),
            {}
          )
        ).not.toThrow()
      }

      if (observations.length === 0) {
        expect(
          policy,
          `${toolId} declares internal trust but could not be exercised by the route probe`
        ).toBeUndefined()
        continue
      }
      exercisedTools += 1
      if (policy !== undefined) {
        expect(
          observations.some((observation) => observation.internal),
          `${toolId} did not exercise its internal route`
        ).toBe(true)
      }
      if (typeof policy === 'function') {
        expect(
          observations.some((observation) => !observation.internal),
          `${toolId} did not exercise its external route`
        ).toBe(true)
      }
    }

    expect(exercisedTools).toBeGreaterThan(0)
  })

  it('validates every literal internal registry route', () => {
    const literalInternalRoutes = Object.entries(tools).filter(
      ([, tool]) => typeof tool.request.url === 'string' && tool.request.url.startsWith('/api/')
    )

    expect(literalInternalRoutes.length).toBeGreaterThan(0)
    for (const [toolId, tool] of literalInternalRoutes) {
      expect(
        () => prepareToolRequest(createRequestTool(tool.request.url as string), {}),
        `${toolId} has a non-canonical literal internal route`
      ).not.toThrow()
    }
  })
})

describe('private-provenance tool registry invariant', () => {
  it('covers at least one registered tool', () => {
    expect(privateProvenanceTools.length).toBeGreaterThan(0)
  })

  it.each(privateProvenanceTools)(
    '%s is internal and receives the private provenance header and body envelope',
    (registryId, tool) => {
      const url = typeof tool.request.url === 'function' ? tool.request.url({}) : tool.request.url

      expect(url, `${registryId} must use an authenticated internal route`).toMatch(/^\/api\//)
      expect(
        tool.request.body,
        `${registryId} must have a JSON body for its private provenance envelope`
      ).toBeTypeOf('function')

      const transportProbe: ToolConfig = {
        ...tool,
        request: {
          ...tool.request,
          url,
          method: 'POST',
          headers: () => ({ 'Content-Type': 'application/json' }),
          body: () => ({ probe: true }),
          modelInput: {
            mode: 'private-provenance',
            inputPaths: () => [],
          },
        },
      }
      const prepared = prepareToolRequest(transportProbe, {}, new ResolvedSecretTraceRegistry())
      const body = JSON.parse(prepared.body ?? '{}') as Record<string, unknown>

      expect(prepared.headers.get(PRIVATE_MODEL_INPUT_PROVENANCE_HEADER)).toBe(
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
      expect(body[RESOLVED_SECRET_PROVENANCE_FIELD]).toEqual({
        version: 1,
        complete: true,
        entries: [],
      })
    }
  )
})
