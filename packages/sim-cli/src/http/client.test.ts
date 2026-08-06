import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_CONTRACT } from '../contract/commands.js'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api.js'
import { formatApiErrorDetails, resolvePath, SimApiError, SimClient } from './client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API errors', () => {
  it('keeps structured details and does not misdiagnose an ordinary 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'NOT_FOUND',
              message: 'Workflow not found',
              details: { id: 'missing' },
            },
          }),
          { status: 404 }
        )
      )
    )
    const client = new SimClient({
      name: 'default',
      endpoint: 'https://sim.example',
      apiKey: 'key',
      workspaceId: 'ws_1',
      output: 'json',
      sources: {
        endpoint: 'default',
        apiKey: 'env',
        workspaceId: 'env',
        output: 'default',
      },
    })

    const request = client.request('/api/v2/workflows/missing')
    await expect(request).rejects.toMatchObject({
      message: 'Workflow not found',
      code: 'NOT_FOUND',
      details: { id: 'missing' },
    })
    await expect(request).rejects.not.toThrow(/v2 API may not be enabled/)
  })

  it('turns nested validation details into concise path-aware lines', () => {
    const lines = formatApiErrorDetails([
      {
        code: 'invalid_union',
        path: ['predicate'],
        message: 'Invalid input',
        errors: [
          [
            {
              code: 'invalid_union',
              path: ['all', 0],
              message: 'Invalid input',
              errors: [
                [
                  {
                    code: 'invalid_value',
                    path: ['op'],
                    message: 'Expected one of eq, ne',
                  },
                ],
              ],
            },
          ],
        ],
      },
    ])

    expect(lines).toEqual(['  details:', '    predicate.all.0.op: Expected one of eq, ne'])
  })

  it('keeps non-validation details as JSON', () => {
    expect(formatApiErrorDetails({ id: 'missing' })).toEqual(['  details: {"id":"missing"}'])
  })
})

describe('resolvePath', () => {
  it('substitutes a path parameter', () => {
    expect(resolvePath('/api/v2/tables/[tableId]/rows', { tableId: 'tbl_1' })).toBe(
      '/api/v2/tables/tbl_1/rows'
    )
  })

  it('substitutes several parameters', () => {
    expect(
      resolvePath('/api/v2/knowledge/[id]/documents/[documentId]', { id: 'kb', documentId: 'doc' })
    ).toBe('/api/v2/knowledge/kb/documents/doc')
  })

  it('percent-encodes values so an id cannot retarget the request', () => {
    // An unencoded `/` or `?` here would silently address a different endpoint.
    expect(resolvePath('/api/v2/tables/[tableId]', { tableId: 'a/b?c=d' })).toBe(
      '/api/v2/tables/a%2Fb%3Fc%3Dd'
    )
  })

  it('throws rather than sending a URL with a literal [param] in it', () => {
    expect(() => resolvePath('/api/v2/tables/[tableId]', {})).toThrow(SimApiError)
    expect(() => resolvePath('/api/v2/tables/[tableId]', {})).toThrow('tableId')
  })

  it('leaves a parameterless path alone', () => {
    expect(resolvePath('/api/v2/tables')).toBe('/api/v2/tables')
  })
})

describe('generated operation table', () => {
  const names = Object.keys(V2_OPERATIONS) as V2OperationName[]

  it('covers the operations the commands rely on', () => {
    // Named explicitly: if a contract is renamed, the generator happily emits
    // the new name and only this test catches that a command lost its endpoint.
    for (const required of [
      'listTables',
      'getTable',
      'queryRows',
      'createTableRows',
      'deleteTableRows',
      'listWorkflows',
      'getWorkflow',
      'deployWorkflow',
      'undeployWorkflow',
      'rollbackWorkflow',
      'listLogs',
      'getLog',
      'getBillingStatus',
      'listBillingLogs',
      'listWorkflowExecutions',
      'getWorkflowExecution',
      'resumeWorkflow',
      'listFiles',
      'deleteFile',
      'listKnowledgeBases',
      'getKnowledgeBase',
      'listKnowledgeDocuments',
      'searchKnowledge',
    ] satisfies V2OperationName[]) {
      expect(names).toContain(required)
    }
  })

  it('declares every path parameter its path contains', () => {
    for (const name of names) {
      const spec = V2_OPERATIONS[name]
      const inPath = [...spec.path.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])
      expect(spec.pathParams, `${name} path params`).toEqual(inPath)
    }
  })

  it('only targets the public v2 surface with real HTTP verbs', () => {
    for (const name of names) {
      const spec = V2_OPERATIONS[name]
      expect(spec.path, name).toMatch(/^\/api\/v2\//)
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], name).toContain(spec.method)
    }
  })

  it('has no two operations sharing a method and path', () => {
    const seen = new Map<string, string>()
    for (const name of names) {
      const spec = V2_OPERATIONS[name]
      const key = `${spec.method} ${spec.path}`
      expect(seen.get(key), `${key} claimed by both ${seen.get(key)} and ${name}`).toBeUndefined()
      seen.set(key, name)
    }
  })
})

describe('destructive operations are gated', () => {
  /**
   * `DELETE /workflows/[id]/deploy` is an undeploy — reversible by redeploying,
   * and the contract renames it accordingly. Everything else that deletes is
   * gated behind `--yes`.
   */
  const NOT_DESTRUCTIVE = new Set<V2OperationName>([
    'undeployWorkflow',
    // Each of these stops something in flight rather than destroying something
    // kept: an upload that has not been completed owns nothing but its own
    // parts, and a cancelled import or export can simply be started again.
    'abortFileUpload',
    'abortKnowledgeDocumentUpload',
    'cancelTableImport',
    'cancelTableExport',
  ])

  it('every DELETE carries a confirmation message', () => {
    // Without this, a new v2 domain arrives through generation with working
    // delete commands and no gate — which is exactly what happened when the
    // MCP/skills/folders/credentials endpoints landed.
    const ungated = (Object.keys(V2_OPERATIONS) as V2OperationName[]).filter(
      (name) =>
        V2_OPERATIONS[name].method === 'DELETE' &&
        !NOT_DESTRUCTIVE.has(name) &&
        !CLI_CONTRACT[name]?.confirm
    )
    expect(ungated).toEqual([])
  })

  it('states what is destroyed, not just that something is', () => {
    for (const [name, spec] of Object.entries(CLI_CONTRACT)) {
      if (!spec?.confirm) continue
      expect(spec.confirm, name).toMatch(/^This /)
      expect(spec.confirm.length, name).toBeGreaterThan(20)
    }
  })
})
