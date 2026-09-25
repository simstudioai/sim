import { workflowAuthzMockFns } from '@sim/testing'
import type { BlockState } from '@sim/workflow-types/workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  customBlocks: vi.fn(),
  loadNormalized: vi.fn(),
  loadSnapshot: vi.fn(),
  replace: vi.fn(),
  assertIdsUnclaimed: vi.fn(),
  notify: vi.fn(),
  recordAudit: vi.fn(),
}))

// Exercise the real registry, request overlay, edit engine, sanitizer and lint.
// The global registry mock accepts every type and would hide this regression.
vi.unmock('@/blocks/registry')
vi.mock('@/blocks/registry-maps', async () => {
  const { partialBlockRegistry } = await import('@sim/testing/mocks/block-registry.mock')
  return partialBlockRegistry(await import('@/blocks/blocks/start_trigger'))
})
vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_UPDATED: 'workflow.updated' },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))
vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  listCustomBlocksWithInputsForWorkspace: mocks.customBlocks,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadNormalized,
}))
vi.mock('@/lib/workflows/queries', () => ({ loadWorkflowReadSnapshot: mocks.loadSnapshot }))
vi.mock('@/lib/workflows/persistence/replace-normalized-state', () => ({
  replaceWorkflowNormalizedState: mocks.replace,
  assertWorkflowGraphIdsUnclaimed: mocks.assertIdsUnclaimed,
  collectWorkflowGraphIds: () => ({ blockIds: [], edgeIds: [], subflowIds: [] }),
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowUpdated: mocks.notify }))
vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: async () => true,
}))
vi.mock('@/lib/core/config/block-visibility', () => ({
  getBlockVisibility: async () => ({
    revealed: new Set(),
    disabled: new Set(),
    previewTagged: new Set(),
  }),
}))
vi.mock('@/lib/permission-groups/config-scope.server', () => ({
  resolvePermissionGroupConfig: async () => null,
}))

import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'
import type { CustomBlockWithInputs } from '@/lib/workflows/custom-blocks/operations'
import type { EditWorkflowOperation } from '@/lib/workflows/editing/types'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import { getBlock } from '@/blocks/registry'

const context = {
  workflowId: 'consumer-workflow',
  workflow: { id: 'consumer-workflow', name: 'Consumer', workspaceId: 'consumer-workspace' },
  workspaceId: 'consumer-workspace',
  workspaceOrganizationId: 'org-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
const session = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const copilot = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: context.workspaceId,
  delegationId: 'tool-call-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-01-01'),
  expiresAt: new Date('2099-01-01'),
}
const customBlock: CustomBlockWithInputs = {
  id: 'custom-1',
  organizationId: 'org-1',
  workflowId: 'publisher-workflow',
  workflowName: 'Uppercase worker',
  workspaceId: 'publisher-workspace',
  workspaceName: 'Publisher',
  type: 'custom_block_uppercase',
  name: 'Uppercase worker',
  description: 'Uppercase text',
  iconUrl: null,
  enabled: true,
  traceChildRuns: false,
  inputFields: [{ id: 'input-text', name: 'Text', type: 'string', required: true }],
  exposedOutputs: [],
}

function block(id: string, type: string, text?: string): BlockState {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    enabled: true,
    subBlocks:
      text === undefined
        ? {}
        : { 'input-text': { id: 'input-text', type: 'short-input', value: text } },
    outputs: {},
  }
}

function graph(includeCustom = false) {
  return {
    blocks: {
      start: block('start', 'start_trigger'),
      ...(includeCustom ? { worker: block('worker', customBlock.type, 'hello') } : {}),
    },
    edges: includeCustom
      ? [
          {
            id: 'edge-1',
            source: 'start',
            target: 'worker',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ]
      : [],
    loops: {},
    parallels: {},
  }
}

const add: EditWorkflowOperation = {
  operation_type: 'add',
  block_id: 'new-worker',
  params: { type: customBlock.type, name: 'New Worker', inputs: { 'input-text': 'hello' } },
}

describe('custom blocks in authorized workflow authoring', () => {
  beforeEach(() => {
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.customBlocks.mockResolvedValue([customBlock])
    mocks.loadNormalized.mockImplementation(async () => graph())
    mocks.loadSnapshot.mockImplementation(async () => ({
      workflowRecord: context.workflow,
      normalizedData: graph(true),
    }))
    mocks.replace.mockImplementation(async ({ state }) => prepareWorkflowStateForPersistence(state))
  })

  it.each([session, copilot])(
    'adds an org block with its deployed inputs as $kind',
    async (principal) => {
      const result = await applyWorkflowOperations.execute({
        principal,
        input: { workflowId: context.workflowId, operations: [add], atomic: true, layout: 'none' },
      })
      const worker = Object.values(result.graph.blocks).find(
        (item) => item.type === customBlock.type
      )
      expect(result.applied).toBe(1)
      expect(result.inputValidationErrors).toEqual([])
      expect(worker?.subBlocks['input-text'].value).toBe('hello')
      expect(mocks.customBlocks).toHaveBeenCalledWith(context.workspaceId)
      expect(mocks.replace).toHaveBeenCalledTimes(1)
      expect(getBlock(customBlock.type)).toBeUndefined()
    }
  )

  it.each([false, true])(
    'edits an existing custom block without losing inputs or edges (dry run: %s)',
    async (dryRun) => {
      mocks.loadNormalized.mockImplementation(async () => graph(true))
      const result = await applyWorkflowOperations.execute({
        principal: copilot,
        input: {
          workflowId: context.workflowId,
          operations: [
            {
              operation_type: 'edit',
              block_id: 'worker',
              params: { inputs: { 'input-text': 'updated' } },
            },
          ],
          atomic: true,
          layout: 'none',
          dryRun,
        },
      })
      expect(result.graph.blocks.worker.subBlocks['input-text'].value).toBe('updated')
      expect(result.graph.edges).toEqual(graph(true).edges)
      expect(result.lint.fieldIssues).toEqual([])
      expect(mocks.replace).toHaveBeenCalledTimes(dryRun ? 0 : 1)
      if (!dryRun) {
        const persisted = mocks.replace.mock.calls[0][0].state
        expect(persisted.blocks.worker.subBlocks['input-text']).toMatchObject({
          value: 'updated',
          type: 'short-input',
        })
        expect(persisted.edges).toEqual(graph(true).edges)
      }
    }
  )

  it('fails closed when custom schemas cannot be loaded', async () => {
    mocks.customBlocks.mockRejectedValue(new Error('Schema read failed'))
    await expect(
      replaceWorkflowState.execute({
        principal: session,
        input: { workflowId: context.workflowId, ...graph(true) },
      })
    ).rejects.toThrow('Schema read failed')
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('isolates simultaneous authoring requests for different organizations', async () => {
    const other = { ...customBlock, organizationId: 'org-2', type: 'custom_block_other' }
    mocks.resolveContext.mockImplementation(async ({ workflowId }) => ({
      ...context,
      workflowId,
      workspaceId: workflowId,
      workspaceOrganizationId: workflowId === 'one' ? 'org-1' : 'org-2',
    }))
    mocks.customBlocks.mockImplementation(async (workspaceId) =>
      workspaceId === 'one' ? [customBlock] : [other]
    )
    let release: () => void = () => {
      throw new Error('Barrier not initialized')
    }
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let waiting = 0
    mocks.loadNormalized.mockImplementation(async () => {
      if (++waiting === 2) release()
      await barrier
      return graph()
    })
    mocks.replace.mockImplementation(async ({ state, workspaceId }) => {
      const foreignType = workspaceId === 'one' ? other.type : customBlock.type
      expect(getBlock(foreignType)).toBeUndefined()
      return prepareWorkflowStateForPersistence(state)
    })
    const results = await Promise.all(
      [customBlock, other].map((row, index) =>
        applyWorkflowOperations.execute({
          principal: session,
          input: {
            workflowId: index === 0 ? 'one' : 'two',
            operations: [{ ...add, params: { ...add.params, type: row.type } }],
            atomic: true,
            layout: 'none',
          },
        })
      )
    )
    expect(results.map((result) => result.applied)).toEqual([1, 1])
    expect(mocks.replace).toHaveBeenCalledTimes(2)
    expect(getBlock(customBlock.type)).toBeUndefined()
    expect(getBlock(other.type)).toBeUndefined()
  })

  it.each([false, true])(
    'replaces and lints a custom-block graph (dry run: %s)',
    async (dryRun) => {
      const result = await replaceWorkflowState.execute({
        principal: copilot,
        input: { workflowId: context.workflowId, ...graph(true), dryRun },
      })
      expect(result.blocksCount).toBe(2)
      expect(result.edgesCount).toBe(1)
      expect(result.lint.fieldIssues).toEqual([])
      expect(mocks.replace).toHaveBeenCalledTimes(dryRun ? 0 : 1)
      if (!dryRun) {
        const persisted = mocks.replace.mock.calls[0][0].state
        expect(persisted.blocks.worker.subBlocks['input-text']).toMatchObject({
          value: 'hello',
          type: 'short-input',
        })
        expect(persisted.edges).toEqual(graph(true).edges)
      }
    }
  )

  it('keeps disabled custom blocks resolvable in existing graphs', async () => {
    mocks.customBlocks.mockResolvedValue([{ ...customBlock, enabled: false }])
    await expect(
      replaceWorkflowState.execute({
        principal: session,
        input: { workflowId: context.workflowId, ...graph(true) },
      })
    ).resolves.toMatchObject({ blocksCount: 2, edgesCount: 1 })
  })

  it.each(['another-organization', null])(
    'cannot inherit another org’s block definitions (%s)',
    async (workspaceOrganizationId) => {
      mocks.resolveContext.mockResolvedValue({ ...context, workspaceOrganizationId })
      mocks.customBlocks.mockResolvedValue([])
      await withCustomBlockOverlay([customBlock], async () => {
        await expect(
          replaceWorkflowState.execute({
            principal: session,
            input: { workflowId: context.workflowId, ...graph(true) },
          })
        ).rejects.toThrow('unknown block type')
        expect(getBlock(customBlock.type)).toBeDefined()
      })
      expect(mocks.replace).not.toHaveBeenCalled()
    }
  )

  it('does not load custom schemas before workflow authorization', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(
      applyWorkflowOperations.execute({
        principal: session,
        input: { workflowId: context.workflowId, operations: [add] },
      })
    ).rejects.toThrow()
    expect(mocks.customBlocks).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
