/**
 * @vitest-environment node
 */
import { knowledgeBase, workflow, workflowBlocks, workflowDeploymentVersion } from '@sim/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
  const reads = new Map<unknown, unknown[][]>()
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = []
  const deletes: Array<{ table: unknown }> = []

  const nextPage = (table: unknown): unknown[] => {
    const pages = reads.get(table)
    return pages && pages.length > 0 ? (pages.shift() as unknown[]) : []
  }

  // A drizzle-style read builder bound to one table: `.where`/`.orderBy`/`.limit` chain back to
  // the same builder, and awaiting it (at `.where()` or `.limit()`) shifts that table's next page.
  const makeReadBuilder = (table: unknown) => {
    const builder = {
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      then: (onFulfilled: (rows: unknown[]) => unknown, onRejected?: (error: unknown) => unknown) =>
        Promise.resolve(nextPage(table)).then(onFulfilled, onRejected),
    }
    return builder
  }

  const db = {
    select: () => ({ from: (table: unknown) => makeReadBuilder(table) }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, values })
          return Promise.resolve([])
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletes.push({ table })
        return Promise.resolve([])
      },
    }),
  }

  return {
    db,
    updates,
    deletes,
    queueRead: (table: unknown, ...pages: unknown[][]) => reads.set(table, pages),
    reset: () => {
      reads.clear()
      updates.length = 0
      deletes.length = 0
    },
  }
})

const { mockInvalidateDeployedStateCache } = vi.hoisted(() => ({
  mockInvalidateDeployedStateCache: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: dbMock.db,
  dbReplica: dbMock.db,
  runOutsideTransactionContext: <T>(fn: () => T): T => fn(),
  instrumentPoolClient: <T>(client: T): T => client,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  invalidateDeployedStateCache: mockInvalidateDeployedStateCache,
  CREDENTIAL_SUBBLOCK_IDS: new Set(['credential', 'manualCredential', 'triggerCredentials']),
}))

// The reference indexer resolves a tool's params via the tool registry; stub it so loading the
// remap module never pulls the full registry (this file only exercises top-level selectors).
vi.mock('@/tools/params', () => ({
  getToolIdForOperation: () => undefined,
  getToolParametersConfig: () => null,
  getSubBlocksForToolInput: (
    _toolId: string,
    _type: string,
    _values: unknown,
    _modes: unknown,
    provided?: { subBlocks?: SubBlockConfig[] }
  ) => ({ subBlocks: provided?.subBlocks ?? [] }),
  formatParameterLabel: (label: string) => label,
}))

import { getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import {
  clearFailedForkResourceReferences,
  clearFailedReferencesInDeploymentVersions,
  clearFailedReferencesInWorkflows,
  rewriteDeploymentVersionState,
} from '@/ee/workspace-forking/lib/copy/cleanup-failed'
import type { ForkCopyResolver } from '@/ee/workspace-forking/lib/remap/fork-bootstrap'
import type { ForkRemapKind } from '@/ee/workspace-forking/lib/remap/remap-references'

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Knowledge', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

/** A KB block whose `documentId` (document-selector) hangs off `knowledgeBaseId` (kb-selector). */
const kbBlockConfig = () =>
  blockWith([
    { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
    { id: 'documentId', title: 'Doc', type: 'document-selector', dependsOn: ['knowledgeBaseId'] },
  ])

/** An agent block whose `tools` tool-input holds a KB tool with a nested `knowledgeBaseId` param. */
const agentToolConfig = (type: string): BlockConfig => {
  if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
  if (type === 'kbtool')
    return blockWith([{ id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' }])
  return undefined as unknown as BlockConfig
}

/** A deployment-version state whose agent block references `kbId` inside a tool-input tool param. */
const agentVersionState = (kbId: string) => ({
  blocks: {
    'agent-1': {
      id: 'agent-1',
      type: 'agent',
      name: 'Agent',
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [{ type: 'kbtool', toolId: 'kbtool_search', params: { knowledgeBaseId: kbId } }],
        },
      },
    },
  },
  edges: [],
  loops: {},
  parallels: {},
})

type AgentStateBlocks = {
  blocks: {
    'agent-1': { subBlocks: { tools: { value: Array<{ params: { knowledgeBaseId: string } }> } } }
  }
}
const nestedKbValue = (state: unknown) =>
  (state as AgentStateBlocks).blocks['agent-1'].subBlocks.tools.value[0].params.knowledgeBaseId

/** A serialized deployment-version state whose single block points its KB selector at `kbId`. */
const versionState = (kbId: string) => ({
  blocks: {
    'block-1': {
      id: 'block-1',
      type: 'knowledge',
      name: 'KB Block',
      subBlocks: {
        knowledgeBaseId: { id: 'knowledgeBaseId', type: 'knowledge-base-selector', value: kbId },
        documentId: { id: 'documentId', type: 'document-selector', value: 'doc-keep' },
      },
    },
  },
  edges: [],
  loops: {},
  parallels: {},
})

const draftBlockRow = (kbId: string) => ({
  id: 'b-1',
  workflowId: 'wf-1',
  type: 'knowledge',
  subBlocks: {
    knowledgeBaseId: { id: 'knowledgeBaseId', type: 'knowledge-base-selector', value: kbId },
    documentId: { id: 'documentId', type: 'document-selector', value: 'doc-keep' },
  },
})

/** A draft block whose `file-upload` subblock points at a copied workspace-file storage key. */
const fileBlockRow = (fileKey: string) => ({
  id: 'b-file',
  workflowId: 'wf-1',
  type: 'agent',
  subBlocks: {
    file: { id: 'file', type: 'file-upload', value: { key: fileKey, name: 'a.png' } },
  },
})

const failedKbResolver: ForkCopyResolver = (kind, id) =>
  kind === 'knowledge-base' && id === 'failed-kb' ? null : id

const failedByKind = () =>
  new Map<ForkRemapKind, Set<string>>([['knowledge-base', new Set(['failed-kb'])]])

type StateBlocks = { blocks: Record<string, { subBlocks: Record<string, { value: unknown }> }> }
const kbValue = (state: unknown) =>
  (state as StateBlocks).blocks['block-1'].subBlocks.knowledgeBaseId.value
const docValue = (state: unknown) =>
  (state as StateBlocks).blocks['block-1'].subBlocks.documentId.value

describe('cleanup-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.reset()
    vi.mocked(getBlock).mockReturnValue(kbBlockConfig())
  })

  describe('rewriteDeploymentVersionState', () => {
    it('clears a block ref that resolves to a failed id and its dependents', () => {
      const result = rewriteDeploymentVersionState(versionState('failed-kb'), failedKbResolver)
      expect(result.changed).toBe(true)
      expect(kbValue(result.state)).toBe('')
      // documentId hangs off knowledgeBaseId, so the cleared parent clears it too.
      expect(docValue(result.state)).toBe('')
    })

    it('leaves a state that references no failed id untouched (same reference, not changed)', () => {
      const input = versionState('other-kb')
      const result = rewriteDeploymentVersionState(input, failedKbResolver)
      expect(result.changed).toBe(false)
      expect(result.state).toBe(input)
    })

    it('is tolerant of a malformed state shape', () => {
      const input = { not: 'a workflow state' }
      const result = rewriteDeploymentVersionState(input, failedKbResolver)
      expect(result.changed).toBe(false)
      expect(result.state).toBe(input)
    })

    // The deployed-version sweep must clear EVERY subblock variety the draft sweep does -
    // including a failed id nested in an agent block's `tool-input` tool params, not only
    // top-level selectors - via the shared remapForkSubBlocks/clearFailedSubBlockReferences.
    it('clears a failed id nested in an agent tool-input param inside a deployed version', () => {
      vi.mocked(getBlock).mockImplementation((type) => agentToolConfig(type))
      const result = rewriteDeploymentVersionState(agentVersionState('failed-kb'), failedKbResolver)
      expect(result.changed).toBe(true)
      expect(nestedKbValue(result.state)).toBe('')
    })

    it('leaves an agent tool-input param that references no failed id untouched', () => {
      vi.mocked(getBlock).mockImplementation((type) => agentToolConfig(type))
      const input = agentVersionState('other-kb')
      const result = rewriteDeploymentVersionState(input, failedKbResolver)
      expect(result.changed).toBe(false)
      expect(result.state).toBe(input)
    })
  })

  describe('clearFailedReferencesInWorkflows', () => {
    it('sweeps the draft blocks and returns the affected workflow ids', async () => {
      dbMock.queueRead(workflow, [{ id: 'wf-1' }])
      dbMock.queueRead(workflowBlocks, [draftBlockRow('failed-kb')])

      const affected = await clearFailedReferencesInWorkflows('child-ws', failedByKind(), 'test')

      expect([...affected]).toEqual(['wf-1'])
      expect(dbMock.updates).toHaveLength(1)
      expect(dbMock.updates[0].table).toBe(workflowBlocks)
      const cleared = dbMock.updates[0].values.subBlocks as Record<string, { value: unknown }>
      expect(cleared.knowledgeBaseId.value).toBe('')
      expect(cleared.documentId.value).toBe('')
    })

    it('returns an empty set and writes nothing when no block references a failed id', async () => {
      dbMock.queueRead(workflow, [{ id: 'wf-1' }])
      dbMock.queueRead(workflowBlocks, [draftBlockRow('other-kb')])

      const affected = await clearFailedReferencesInWorkflows('child-ws', failedByKind(), 'test')

      expect(affected.size).toBe(0)
      expect(dbMock.updates).toHaveLength(0)
    })
  })

  describe('clearFailedReferencesInDeploymentVersions', () => {
    it('rewrites a version referencing a failed id and invalidates its deployed-state cache', async () => {
      dbMock.queueRead(workflowDeploymentVersion, [
        { id: 'dv-1', version: 5, state: versionState('failed-kb') },
      ])

      await clearFailedReferencesInDeploymentVersions(new Set(['wf-1']), failedByKind(), 'test')

      expect(dbMock.updates).toHaveLength(1)
      expect(dbMock.updates[0].table).toBe(workflowDeploymentVersion)
      expect(kbValue(dbMock.updates[0].values.state)).toBe('')
      expect(docValue(dbMock.updates[0].values.state)).toBe('')
      expect(mockInvalidateDeployedStateCache).toHaveBeenCalledTimes(1)
      expect(mockInvalidateDeployedStateCache).toHaveBeenCalledWith('dv-1')
    })

    it('leaves a version that does not reference a failed id unwritten and uncached', async () => {
      dbMock.queueRead(workflowDeploymentVersion, [
        { id: 'dv-old', version: 3, state: versionState('other-kb') },
      ])

      await clearFailedReferencesInDeploymentVersions(new Set(['wf-1']), failedByKind(), 'test')

      expect(dbMock.updates).toHaveLength(0)
      expect(mockInvalidateDeployedStateCache).not.toHaveBeenCalled()
    })

    it('writes only the changed version when a workflow mixes referencing and non-referencing versions', async () => {
      dbMock.queueRead(workflowDeploymentVersion, [
        { id: 'dv-active', version: 5, state: versionState('failed-kb') },
        { id: 'dv-old', version: 4, state: versionState('other-kb') },
      ])

      await clearFailedReferencesInDeploymentVersions(new Set(['wf-1']), failedByKind(), 'test')

      expect(dbMock.updates).toHaveLength(1)
      expect(mockInvalidateDeployedStateCache).toHaveBeenCalledTimes(1)
      expect(mockInvalidateDeployedStateCache).toHaveBeenCalledWith('dv-active')
    })

    it('does nothing when no workflows were affected', async () => {
      await clearFailedReferencesInDeploymentVersions(new Set(), failedByKind(), 'test')
      expect(dbMock.updates).toHaveLength(0)
      expect(mockInvalidateDeployedStateCache).not.toHaveBeenCalled()
    })
  })

  describe('clearFailedForkResourceReferences', () => {
    it('threads the draft sweep into the deployed sweep, then drops the placeholder', async () => {
      dbMock.queueRead(workflow, [{ id: 'wf-1' }])
      dbMock.queueRead(workflowBlocks, [draftBlockRow('failed-kb')])
      dbMock.queueRead(workflowDeploymentVersion, [
        { id: 'dv-active', version: 5, state: versionState('failed-kb') },
        { id: 'dv-old', version: 4, state: versionState('other-kb') },
      ])

      const cleaned = await clearFailedForkResourceReferences({
        childWorkspaceId: 'child-ws',
        failures: [{ kind: 'knowledge-base', childId: 'failed-kb', documentChildIds: [] }],
        requestId: 'test',
      })

      expect(cleaned).toEqual({ cleared: 1, clearingFailed: false })
      // One draft block update + one deployed version update (only the referencing version).
      const updatedTables = dbMock.updates.map((u) => u.table)
      expect(updatedTables).toEqual([workflowBlocks, workflowDeploymentVersion])
      expect(mockInvalidateDeployedStateCache).toHaveBeenCalledTimes(1)
      expect(mockInvalidateDeployedStateCache).toHaveBeenCalledWith('dv-active')
      // The orphaned KB placeholder is dropped after both sweeps.
      expect(dbMock.deletes).toHaveLength(1)
      expect(dbMock.deletes[0].table).toBe(knowledgeBase)
    })

    it('still drops the placeholder when no workflow referenced the failed resource', async () => {
      dbMock.queueRead(workflow, [{ id: 'wf-1' }])
      dbMock.queueRead(workflowBlocks, [draftBlockRow('other-kb')])

      const cleaned = await clearFailedForkResourceReferences({
        childWorkspaceId: 'child-ws',
        failures: [{ kind: 'knowledge-base', childId: 'failed-kb', documentChildIds: [] }],
        requestId: 'test',
      })

      expect(cleaned).toEqual({ cleared: 1, clearingFailed: false })
      // No draft block referenced the failed id AND no deployed targets were threaded, so the
      // deployed sweep is skipped entirely.
      expect(dbMock.updates).toHaveLength(0)
      expect(mockInvalidateDeployedStateCache).not.toHaveBeenCalled()
      expect(dbMock.deletes).toHaveLength(1)
      expect(dbMock.deletes[0].table).toBe(knowledgeBase)
    })

    it('sweeps a deployed target version even when no draft referenced the failed id', async () => {
      // Draft is clean (other-kb), but a deployed target version still points at the dropped
      // placeholder - the deployed-target scope (not draft divergence) catches it.
      dbMock.queueRead(workflow, [{ id: 'wf-1' }])
      dbMock.queueRead(workflowBlocks, [draftBlockRow('other-kb')])
      dbMock.queueRead(workflowDeploymentVersion, [
        { id: 'dv-1', version: 5, state: versionState('failed-kb') },
      ])

      const cleaned = await clearFailedForkResourceReferences({
        childWorkspaceId: 'child-ws',
        failures: [{ kind: 'knowledge-base', childId: 'failed-kb', documentChildIds: [] }],
        deployedTargetWorkflowIds: ['wf-deployed'],
        requestId: 'test',
      })

      expect(cleaned).toEqual({ cleared: 1, clearingFailed: false })
      expect(dbMock.updates.map((u) => u.table)).toContain(workflowDeploymentVersion)
      expect(mockInvalidateDeployedStateCache).toHaveBeenCalledWith('dv-1')
      // Clearing succeeded, so the placeholder is dropped.
      expect(dbMock.deletes[0].table).toBe(knowledgeBase)
    })

    it('clears a file-upload reference to a failed copied blob and drops no row', async () => {
      dbMock.queueRead(workflow, [{ id: 'wf-1' }])
      dbMock.queueRead(workflowBlocks, [fileBlockRow('workspace/child/failed.png')])

      const cleaned = await clearFailedForkResourceReferences({
        childWorkspaceId: 'child-ws',
        failures: [{ kind: 'file', childKey: 'workspace/child/failed.png' }],
        requestId: 'test',
      })

      expect(cleaned).toEqual({ cleared: 1, clearingFailed: false })
      expect(dbMock.updates).toHaveLength(1)
      expect(dbMock.updates[0].table).toBe(workflowBlocks)
      const cleared = dbMock.updates[0].values.subBlocks as Record<string, { value: unknown }>
      expect(cleared.file.value).toBe('')
      // A failed file has no placeholder row to drop (the metadata row stays re-uploadable).
      expect(dbMock.deletes).toHaveLength(0)
    })

    it('reports cleared:0 + clearingFailed and skips the placeholder drop when a clear phase throws', async () => {
      // A clear-phase failure must not drop the placeholder: that would turn an empty placeholder
      // into a dangling reference to a deleted row. Make the draft block UPDATE throw.
      dbMock.queueRead(workflow, [{ id: 'wf-1' }])
      dbMock.queueRead(workflowBlocks, [draftBlockRow('failed-kb')])
      const originalUpdate = dbMock.db.update
      dbMock.db.update = () => {
        throw new Error('update failed')
      }
      try {
        const cleaned = await clearFailedForkResourceReferences({
          childWorkspaceId: 'child-ws',
          failures: [{ kind: 'knowledge-base', childId: 'failed-kb', documentChildIds: [] }],
          requestId: 'test',
        })
        // The count must NOT overstate: nothing was cleared and the flag marks cleanup incomplete.
        expect(cleaned).toEqual({ cleared: 0, clearingFailed: true })
      } finally {
        dbMock.db.update = originalUpdate
      }
      // The drop is skipped, so the placeholder row survives (no delete issued).
      expect(dbMock.deletes).toHaveLength(0)
    })
  })
})
