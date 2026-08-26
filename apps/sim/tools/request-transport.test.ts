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
const DYNAMIC_INTERNAL_ROUTE_PATTERN = /(?:=>|return)\s*\(?\s*[`'"]\/api\/|new URL\(\s*[`'"]\/api\//
const dynamicInternalRouteTools = Object.entries(tools).filter(
  ([, tool]) =>
    typeof tool.request.url === 'function' &&
    DYNAMIC_INTERNAL_ROUTE_PATTERN.test(tool.request.url.toString())
)
const declaredDynamicInternalRouteTools = Object.entries(tools).filter(
  ([, tool]) => typeof tool.request.url === 'function' && tool.request.internal !== undefined
)
const declaredDynamicInternalRouteToolIds = declaredDynamicInternalRouteTools
  .map(([toolId]) => toolId)
  .sort()

function createProbeValue(): unknown {
  const probe: () => unknown = new Proxy((): unknown => probe, {
    get: (_target, property) => {
      if (property === Symbol.toPrimitive) return () => 'probe'
      if (property === Symbol.iterator)
        return function* iterator() {
          yield 'probe'
        }
      if (property === 'valueOf') return () => 1
      if (property === 'length') return 1
      if (
        ['toString', 'trim', 'toLowerCase', 'toUpperCase', 'replace', 'slice'].includes(
          String(property)
        )
      ) {
        return () => 'probe'
      }
      if (['includes', 'startsWith', 'endsWith'].includes(String(property))) return () => false
      if (['map', 'filter', 'flatMap'].includes(String(property))) {
        return (callback: (value: string, index: number) => unknown) => [callback('probe', 0)]
      }
      if (property === 'join') return () => 'probe'
      return probe
    },
    apply: () => probe,
  })
  return probe
}

function createProbeParams(overrides: Record<string, unknown>): Record<string, unknown> {
  const fallback = createProbeValue()
  return new Proxy(overrides, {
    get: (target, property) =>
      typeof property === 'string' && property in target ? target[property] : fallback,
  })
}

const BASE_INTERNAL_ROUTE_PROBE = {
  _context: {
    workflowId: 'workflow-probe',
    workspaceId: 'workspace-probe',
    userId: 'user-probe',
    executionId: 'execution-probe',
  },
  workflowId: 'workflow-probe',
  workspaceId: 'workspace-probe',
  userId: 'user-probe',
  executionId: 'execution-probe',
  id: 'id-probe',
  query: 'query-probe',
  json: '{}',
  body: {},
  headers: {},
  params: {},
  pathParams: {},
  messages: [],
  files: [],
  rows: [],
  data: {},
  content: 'Plain text',
  url: 'https://example.com',
  baseUrl: 'https://example.com',
  apiBaseUrl: 'https://example.com',
  method: 'GET',
} as const

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
  it('covers every declared dynamic internal route', () => {
    expect(dynamicInternalRouteTools.length).toBeGreaterThan(0)
    expect(declaredDynamicInternalRouteToolIds).toEqual(
      dynamicInternalRouteTools.map(([toolId]) => toolId).sort()
    )
  })

  it.each(dynamicInternalRouteTools)('%s declares its internal route trust', (_toolId, tool) => {
    expect(tool.request.internal).toBeDefined()
  })

  it('probes every declared policy against its dynamic URL branches', () => {
    const scenarios = [
      createProbeParams({ ...BASE_INTERNAL_ROUTE_PROBE }),
      createProbeParams({
        ...BASE_INTERNAL_ROUTE_PROBE,
        content: '<at>Probe User</at>',
        files: [{ id: 'file-probe' }],
      }),
    ]

    for (const [toolId, tool] of declaredDynamicInternalRouteTools) {
      const urlBuilder = tool.request.url
      if (typeof urlBuilder !== 'function') throw new Error(`${toolId} must have a dynamic URL`)
      const policy = tool.request.internal
      const observations: Array<{ internal: boolean; url: string }> = []

      for (const params of scenarios) {
        let url: string
        let internal: boolean
        try {
          url = urlBuilder(params as never)
          internal = typeof policy === 'function' ? policy(params as never) : policy === true
        } catch {
          continue
        }

        observations.push({ internal, url })
        expect(
          internal ? url.startsWith('/api/') : isAbsoluteHttpUrl(url),
          `${toolId} resolved ${url} outside its declared request trust`
        ).toBe(true)
      }

      expect(
        observations.length,
        `${toolId} could not be exercised by the route probe`
      ).toBeGreaterThan(0)
      expect(
        observations.some((observation) => observation.internal),
        `${toolId} did not exercise its internal route`
      ).toBe(true)
      if (typeof policy === 'function') {
        expect(
          observations.some((observation) => !observation.internal),
          `${toolId} did not exercise its external route`
        ).toBe(true)
      }
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
