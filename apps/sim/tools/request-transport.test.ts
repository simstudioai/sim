import { describe, expect, it, vi } from 'vitest'
import { requestTool } from '@/tools/http/request'
import { webhookRequestTool } from '@/tools/http/webhook_request'
import { tools } from '@/tools/registry'
import { prepareToolRequest } from '@/tools/request-transport'
import { isInternalToolConfig, type ToolConfig } from '@/tools/types'

vi.unmock('@/tools/registry')

const requestTools = Object.entries(tools).filter(
  (entry): entry is [string, ToolConfig] => !isInternalToolConfig(entry[1])
)
const dynamicRouteTools = requestTools.filter(([, tool]) => typeof tool.request.url === 'function')
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
  url: string | ((params: Record<string, unknown>) => string)
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
    },
  }
}

describe('external request transport', () => {
  it('rejects relative Sim API routes', () => {
    expect(() => prepareToolRequest(createRequestTool('/api/tools/probe'), {})).toThrow(
      'External tool requests require an absolute HTTP(S) URL'
    )
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
      ).url
    ).toBe('http://example.com')
    expect(
      prepareToolRequest(
        createRequestTool(() => 'https://example.com'),
        {}
      ).url
    ).toBe('https://example.com')
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

describe('dynamic external request registry invariant', () => {
  it('covers every dynamic external request URL', () => {
    expect(dynamicRouteTools.length).toBeGreaterThan(0)
  })

  it('probes every dynamic request URL as an absolute HTTP(S) URL', () => {
    let exercisedTools = 0

    for (const [toolId, tool] of dynamicRouteTools) {
      const urlBuilder = tool.request.url
      if (typeof urlBuilder !== 'function') throw new Error(`${toolId} must have a dynamic URL`)
      const observations: string[] = []
      const scenarios = [
        createSchemaProbeParams(tool, false),
        createSchemaProbeParams(tool, true),
        createSchemaProbeParams(tool, true, true),
      ]

      for (const params of scenarios) {
        let url: string
        try {
          url = urlBuilder(params as never)
        } catch {
          continue
        }

        if (!url) continue
        observations.push(url)
        expect(
          isAbsoluteHttpUrl(url),
          `${toolId} resolved ${url} outside the external HTTP transport`
        ).toBe(true)
        expect(() =>
          prepareToolRequest(
            createRequestTool(() => url),
            {}
          )
        ).not.toThrow()
      }

      if (observations.length === 0) continue
      exercisedTools += 1
    }

    expect(exercisedTools).toBeGreaterThan(0)
  })
})
