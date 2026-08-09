import { describe, expect, it } from 'vitest'
import { internalRoute } from '@/lib/core/utils/internal-route'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { tools } from '@/tools/registry'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

vi.unmock('@/tools/registry')

const privateProvenanceTools = Object.entries(tools).filter(
  ([, tool]) => tool.request.modelInput?.mode === 'private-provenance'
)

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

function buildProbeTool(request: Partial<ToolConfig['request']>): ToolConfig {
  return {
    id: 'probe_tool',
    name: 'Probe',
    description: 'probe',
    version: '1.0.0',
    params: { url: { type: 'string', visibility: 'user-or-llm' } },
    request: { url: '/api/probe', method: 'GET', headers: () => ({}), ...request },
  } as ToolConfig
}

describe('internal transport selection', () => {
  it('trusts a static internal URL from the tool config', () => {
    expect(prepareToolRequest(buildProbeTool({ url: '/api/probe' }), {}).isInternalRoute).toBe(true)
  })

  it('trusts a builder that returns an internal route', () => {
    const prepared = prepareToolRequest(
      buildProbeTool({ url: (p: Record<string, any>) => internalRoute`/api/table/${p.id}/rows` }),
      { id: 't-1' }
    )

    expect(prepared.isInternalRoute).toBe(true)
    expect(prepared.url).toBe('/api/table/t-1/rows')
  })

  it('does not trust a bare internal path a builder returned', () => {
    const prepared = prepareToolRequest(
      buildProbeTool({ url: (p: Record<string, any>) => p.url }),
      { url: '/api/auth/oauth/token' }
    )

    expect(prepared.isInternalRoute).toBe(false)
  })

  it('rejects private provenance when the tool is not internally routed', () => {
    const tool = buildProbeTool({
      url: (p: Record<string, any>) => p.url,
      body: () => ({ probe: true }),
      modelInput: { mode: 'private-provenance', inputPaths: () => [] },
    })

    expect(() =>
      prepareToolRequest(tool, { url: '/api/probe' }, new ResolvedSecretTraceRegistry())
    ).toThrow(/internal routes/)
  })
})

describe('caller-supplied URLs never reach the internal transport', () => {
  it.each(['http_request', 'webhook_request'])('%s cannot route a relative URL inward', (id) => {
    const prepared = prepareToolRequest(tools[id], {
      url: '/api/auth/oauth/token',
      method: 'POST',
      body: { credentialId: 'cred-1' },
    })

    expect(prepared.url).toMatch(/^\/api\//)
    expect(prepared.isInternalRoute).toBe(false)
  })

  it.each([
    ['grafana_list_folders', { baseUrl: '', serviceAccountToken: 't' }],
    ['dynatrace_list_problems', { environmentUrl: '', apiToken: 't' }],
  ])('%s stays external when its host param is blank', (id, params) => {
    const prepared = prepareToolRequest(tools[id], params)

    expect(prepared.url).toMatch(/^\/api\//)
    expect(prepared.isInternalRoute).toBe(false)
  })

  const workspaceContext = { _context: { workspaceId: 'ws-1', userId: 'user-1' } }

  it.each([
    ['function_execute', { code: 'return 1' }],
    ['knowledge_search', { knowledgeBaseIds: ['kb-1'], query: 'q' }],
    ['memory_get_all', workspaceContext],
    ['table_list', workspaceContext],
    ['workflow_executor', { workflowId: 'wf-1' }],
  ])('%s still routes internally', (id, params) => {
    expect(prepareToolRequest(tools[id], params).isInternalRoute).toBe(true)
  })
})
