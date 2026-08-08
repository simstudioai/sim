import { describe, expect, it } from 'vitest'
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

interface ProbeParams {
  url: string
  tableId: string
}

function buildProbeTool(
  request: Partial<ToolConfig<ProbeParams>['request']>
): ToolConfig<ProbeParams> {
  return {
    id: 'probe_tool',
    name: 'Probe',
    description: 'probe',
    version: '1.0.0',
    params: {
      url: { type: 'string', visibility: 'user-or-llm' },
      tableId: { type: 'string', visibility: 'user-or-llm' },
    },
    request: {
      url: '/api/probe',
      method: 'GET',
      headers: () => ({}),
      ...request,
    },
  }
}

describe('internal transport selection', () => {
  it('trusts a statically configured internal URL', () => {
    const prepared = prepareToolRequest(buildProbeTool({ url: '/api/probe' }), {})

    expect(prepared.isInternalRoute).toBe(true)
  })

  it('trusts a URL builder that declares an internal route', () => {
    const prepared = prepareToolRequest(
      buildProbeTool({
        internalRoute: true,
        url: (params) => `/api/table/${params.tableId}/rows`,
      }),
      { tableId: 'table-1' }
    )

    expect(prepared.isInternalRoute).toBe(true)
  })

  it('does not trust a declared internal tool that resolves to an external URL', () => {
    const prepared = prepareToolRequest(
      buildProbeTool({ internalRoute: true, url: () => 'https://attacker.example/x' }),
      {}
    )

    expect(prepared.isInternalRoute).toBe(false)
  })

  it('rejects private provenance on an undeclared builder that emits an internal path', () => {
    const tool = buildProbeTool({
      url: (params) => params.url,
      body: () => ({ probe: true }),
      modelInput: { mode: 'private-provenance', inputPaths: () => [] },
    })

    expect(() =>
      prepareToolRequest(tool, { url: '/api/probe' }, new ResolvedSecretTraceRegistry())
    ).toThrow(/internal routes/)
  })
})

describe('caller-supplied tool URLs never reach the internal transport', () => {
  it.each(['http_request', 'webhook_request'])(
    '%s cannot mint an internal request from a relative URL',
    (toolId) => {
      const prepared = prepareToolRequest(tools[toolId], {
        url: '/api/auth/oauth/token',
        method: 'POST',
        body: { credentialId: 'cred-1' },
      })

      expect(prepared.isInternalRoute).toBe(false)
    }
  )

  it('keeps a self-hosted integration external when its host param is blank', () => {
    const prepared = prepareToolRequest(tools.grafana_list_folders, {
      baseUrl: '',
      serviceAccountToken: 'token',
    })

    expect(prepared.url).toMatch(/^\/api\//)
    expect(prepared.isInternalRoute).toBe(false)
  })

  const workspaceContext = { _context: { workspaceId: 'workspace-1', userId: 'user-1' } }

  it.each([
    ['function_execute', { code: 'return 1' }],
    ['knowledge_search', { knowledgeBaseIds: ['kb-1'], query: 'q' }],
    ['memory_get_all', workspaceContext],
    ['table_list', workspaceContext],
    ['workflow_executor', { workflowId: 'workflow-1' }],
  ])('%s still uses the internal transport', (toolId, params) => {
    const prepared = prepareToolRequest(tools[toolId], params)

    expect(prepared.isInternalRoute).toBe(true)
  })
})

const PROBE_HOST = 'https://internal-route-probe.invalid'

const declaredInternalTools = Object.entries(tools).filter(
  ([, tool]) => tool.request.internalRoute === true
)

describe('declared internal tool registry invariant', () => {
  it('covers at least one registered tool', () => {
    expect(declaredInternalTools.length).toBeGreaterThan(0)
  })

  it.each(declaredInternalTools)(
    '%s keeps its internal path out of reach of its params',
    (registryId, tool) => {
      const probeParams: Record<string, unknown> = {
        _context: { workspaceId: 'workspace-1', userId: 'user-1' },
      }
      for (const name of Object.keys(tool.params)) probeParams[name] = PROBE_HOST

      let url: string
      try {
        url = (tool.request.url as (params: Record<string, unknown>) => string)(probeParams)
      } catch {
        return
      }

      expect(url, `${registryId} builds its host from a caller-supplied param`).toMatch(/^\/api\//)
    }
  )
})
