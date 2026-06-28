/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { detectForkCascadeReferences } from '@/lib/workspaces/fork/mapping/cascade'
import type {
  ForkReference,
  ForkReferenceResolver,
} from '@/lib/workspaces/fork/remap/remap-references'

/** Executor that returns the queued result arrays in the order queries are issued. */
function queuedExecutor(results: unknown[][]): DbOrTx {
  let index = 0
  const builder = {
    from: () => builder,
    where: () => Promise.resolve(results[index++] ?? []),
  }
  return { select: () => builder } as unknown as DbOrTx
}

function ref(kind: ForkReference['kind'], sourceId: string): ForkReference {
  return { kind, sourceId, subBlockKey: 'tools', required: false }
}

const resolveNone: ForkReferenceResolver = () => null
const resolveAll: ForkReferenceResolver = (_kind, sourceId) => sourceId

describe('detectForkCascadeReferences', () => {
  it('returns empty when there are no content references', async () => {
    const result = await detectForkCascadeReferences({
      executor: queuedExecutor([]),
      sourceWorkspaceId: 'ws',
      references: [ref('credential', 'cred-1'), ref('table', 'tbl-1')],
      resolve: resolveNone,
    })
    expect(result.references).toEqual([])
    expect(result.unmapped).toEqual([])
    expect(result.mcpReauthServerIds).toEqual([])
  })

  it('surfaces env keys from custom tool code as required unmapped env-var refs', async () => {
    const result = await detectForkCascadeReferences({
      executor: queuedExecutor([[{ id: 't1', title: 'Weather', code: 'fetch(`{{API_KEY}}`)' }]]),
      sourceWorkspaceId: 'ws',
      references: [ref('custom-tool', 't1')],
      resolve: resolveNone,
    })
    expect(result.references).toHaveLength(1)
    expect(result.references[0]).toMatchObject({
      kind: 'env-var',
      sourceId: 'API_KEY',
      required: true,
    })
    expect(result.unmapped).toHaveLength(1)
  })

  it('marks env-var cascade refs mapped when the resolver finds them in the target', async () => {
    const result = await detectForkCascadeReferences({
      executor: queuedExecutor([[{ id: 't1', title: 'Weather', code: '{{API_KEY}}' }]]),
      sourceWorkspaceId: 'ws',
      references: [ref('custom-tool', 't1')],
      resolve: resolveAll,
    })
    expect(result.references).toHaveLength(1)
    expect(result.unmapped).toHaveLength(0)
  })

  it('extracts env keys from MCP url/headers and flags oauth servers for re-auth', async () => {
    const result = await detectForkCascadeReferences({
      executor: queuedExecutor([
        [
          {
            id: 'mcp-1',
            name: 'Server',
            url: 'https://x/{{HOST_KEY}}',
            headers: { Authorization: '{{TOKEN}}' },
            authType: 'headers',
          },
          { id: 'mcp-2', name: 'OAuth Server', url: 'https://y', headers: {}, authType: 'oauth' },
        ],
      ]),
      sourceWorkspaceId: 'ws',
      references: [ref('mcp-server', 'mcp-1'), ref('mcp-server', 'mcp-2')],
      resolve: resolveNone,
    })
    const envIds = result.references
      .filter((r) => r.kind === 'env-var')
      .map((r) => r.sourceId)
      .sort()
    expect(envIds).toEqual(['HOST_KEY', 'TOKEN'])
    expect(result.mcpReauthServerIds).toEqual(['mcp-2'])
  })

  it('flags literal MCP header values as inline secrets (not env)', async () => {
    const result = await detectForkCascadeReferences({
      executor: queuedExecutor([
        [
          {
            id: 'mcp-1',
            name: 'Server',
            url: 'https://x',
            headers: { Authorization: 'sk-literal' },
            authType: 'headers',
          },
        ],
      ]),
      sourceWorkspaceId: 'ws',
      references: [ref('mcp-server', 'mcp-1')],
      resolve: resolveNone,
    })
    expect(result.references).toHaveLength(0)
    expect(result.inlineSecretSources).toHaveLength(1)
  })

  it('surfaces KB connector credentials as required credential refs', async () => {
    const result = await detectForkCascadeReferences({
      executor: queuedExecutor([
        [{ id: 'kc-1', knowledgeBaseId: 'kb-1', credentialId: 'cred-9', encryptedApiKey: null }],
      ]),
      sourceWorkspaceId: 'ws',
      references: [ref('knowledge-base', 'kb-1')],
      resolve: resolveNone,
    })
    expect(result.references).toHaveLength(1)
    expect(result.references[0]).toMatchObject({
      kind: 'credential',
      sourceId: 'cred-9',
      required: true,
    })
  })

  it('dedupes a shared env key referenced by two custom tools', async () => {
    const result = await detectForkCascadeReferences({
      executor: queuedExecutor([
        [
          { id: 't1', title: 'A', code: '{{SHARED}}' },
          { id: 't2', title: 'B', code: '{{SHARED}}' },
        ],
      ]),
      sourceWorkspaceId: 'ws',
      references: [ref('custom-tool', 't1'), ref('custom-tool', 't2')],
      resolve: resolveNone,
    })
    expect(result.references).toHaveLength(1)
    expect(result.references[0].sourceId).toBe('SHARED')
  })
})
