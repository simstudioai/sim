/**
 * @vitest-environment node
 */
import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  notify: vi.fn(),
  replace: vi.fn(),
  validate: vi.fn(),
  needsRedeployment: vi.fn(),
  applyOperations: vi.fn(),
  loadNormalized: vi.fn(),
  normalizeState: vi.fn(),
  sandboxAccess: vi.fn(),
  blockVisibility: vi.fn(),
  permissionConfig: vi.fn(),
  preValidate: vi.fn(),
  collectReferences: vi.fn(),
  collectToolReferences: vi.fn(),
  assertIdsUnclaimed: vi.fn(),
  collectGraphIds: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_UPDATED: 'workflow.updated' },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowUpdated: mocks.notify }))
vi.mock('@/lib/workflows/persistence/replace-normalized-state', () => ({
  replaceWorkflowNormalizedState: mocks.replace,
  assertWorkflowGraphIdsUnclaimed: mocks.assertIdsUnclaimed,
  collectWorkflowGraphIds: mocks.collectGraphIds,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadNormalized,
}))
vi.mock('@/lib/workflows/sanitization/validation', () => ({
  validateWorkflowState: mocks.validate,
  sanitizeAgentToolsInBlocks: (blocks: Record<string, unknown>) => ({ blocks, warnings: [] }),
}))
vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: mocks.needsRedeployment,
}))
vi.mock('@/lib/workflows/editing/engine', () => ({
  applyOperationsToWorkflowState: mocks.applyOperations,
}))
vi.mock('@/lib/workflows/editing/validation', () => ({
  collectUnresolvedAgentToolReferences: mocks.collectToolReferences,
  collectUnresolvedReferences: mocks.collectReferences,
  preValidateCredentialInputs: mocks.preValidate,
  UNRESOLVABLE_AT_LINT_NOTE: 'lint note',
}))
vi.mock('@/lib/workflows/editing/lint', () => ({
  collectWorkflowFieldIssues: () => [],
  collectDanglingBlockOutputReferences: () => [],
  lintEditedWorkflowState: () => ({
    sources: [],
    sinks: [],
    orphanBlocks: [],
    emptyOutgoingPorts: [],
    invalidBranchPorts: [],
    invalidConnectionTargets: [],
  }),
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: mocks.sandboxAccess,
}))
vi.mock('@/lib/core/config/block-visibility', () => ({ getBlockVisibility: mocks.blockVisibility }))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: mocks.permissionConfig,
}))
vi.mock('@/blocks/visibility/server-context', () => ({
  withBlockVisibility: (_state: unknown, run: () => unknown) => run(),
}))
vi.mock('@/stores/workflows/workflow/utils', () => ({
  generateLoopBlocks: () => ({}),
  generateParallelBlocks: () => ({}),
}))
vi.mock('@/stores/workflows/workflow/validation', () => ({
  normalizeWorkflowState: mocks.normalizeState,
}))
vi.mock('@/lib/workflows/autolayout', () => ({
  applyTargetedLayout: vi.fn(),
  getTargetedLayoutImpact: () => ({
    layoutBlockIds: [],
    resizedBlockIds: [],
    shiftSourceBlockIds: [],
  }),
  transferBlockHeights: vi.fn(),
}))

import { ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import { WorkflowOperationsNotAppliedError } from '@/lib/workflows/application/workflow-operations-error'

const BLOCK = {
  id: 'block-1',
  type: 'starter',
  name: 'Start',
  position: { x: 0, y: 0 },
  subBlocks: {},
  outputs: {},
  enabled: true,
}

const context = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Daily digest', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'org-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const sessionPrincipal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const copilotPrincipal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'tool-call-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
}

const operations = [
  {
    operation_type: 'add' as const,
    block_id: 'block-2',
    params: { type: 'agent', name: 'Triage' },
  },
]

function graph(blocks: Record<string, unknown> = { 'block-1': BLOCK }) {
  return { blocks, edges: [], loops: {}, parallels: {} }
}

const GRAPH_IDS = { blockIds: ['block-1'], edgeIds: [], subflowIds: [] }

describe('applyWorkflowOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.sandboxAccess.mockResolvedValue(true)
    mocks.blockVisibility.mockResolvedValue({ revealed: [], disabled: [], previewTagged: [] })
    mocks.permissionConfig.mockResolvedValue(null)
    mocks.loadNormalized.mockResolvedValue(graph())
    mocks.normalizeState.mockReturnValue({ state: graph(), warnings: [] })
    mocks.preValidate.mockResolvedValue({ filteredOperations: operations, errors: [] })
    mocks.applyOperations.mockReturnValue({
      state: graph(),
      validationErrors: [],
      skippedItems: [],
    })
    mocks.collectReferences.mockResolvedValue([])
    mocks.collectToolReferences.mockResolvedValue([])
    mocks.validate.mockReturnValue({ valid: true, errors: [], warnings: [] })
    mocks.replace.mockResolvedValue({ warnings: [], state: graph() })
    mocks.needsRedeployment.mockResolvedValue(true)
    mocks.collectGraphIds.mockReturnValue(GRAPH_IDS)
    mocks.assertIdsUnclaimed.mockResolvedValue(undefined)
  })

  it('writes once, through the shared persistence primitive', async () => {
    const result = await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: { workflowId: 'workflow-1', operations },
    })

    expect(mocks.replace).toHaveBeenCalledTimes(1)
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'workflow-1', workspaceId: 'workspace-1' })
    )
    expect(result.applied).toBe(1)
    expect(result.needsRedeployment).toBe(true)
  })

  /**
   * Replacing a draft with `{ blocks: {}, edges: [] }` legitimately deletes
   * every normalized block row. The workflow row still exists, so the next add
   * must initialize that empty canvas rather than treating it as missing state.
   */
  it('adds the first block to a blockless workflow', async () => {
    const emptyGraph = graph({})
    const graphWithAddedBlock = graph({
      'block-2': { ...BLOCK, id: 'block-2', type: 'agent', name: 'Triage' },
    })
    mocks.loadNormalized.mockResolvedValue(emptyGraph)
    mocks.normalizeState.mockImplementation((state) => ({ state, warnings: [] }))
    mocks.applyOperations.mockReturnValue({
      state: graphWithAddedBlock,
      validationErrors: [],
      skippedItems: [],
      mintedBlockIds: {},
    })

    const result = await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: { workflowId: 'workflow-1', operations, atomic: true },
    })

    expect(mocks.normalizeState).toHaveBeenCalledWith(emptyGraph)
    expect(mocks.applyOperations).toHaveBeenCalledWith(emptyGraph, operations, null)
    expect(mocks.replace).toHaveBeenCalledTimes(1)
    expect(result.graph.blocks).toEqual(graphWithAddedBlock.blocks)
  })

  describe('dry run', () => {
    it('runs the whole engine and stops at the write', async () => {
      const result = await applyWorkflowOperations.execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations, dryRun: true },
      })

      expect(result.dryRun).toBe(true)
      expect(result.applied).toBe(1)
      expect(mocks.replace).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
      expect(mocks.notify).not.toHaveBeenCalled()
    })

    /**
     * The commit goes through `replaceWorkflowNormalizedState`, whose in-
     * transaction pre-check refuses a graph id another workflow already owns.
     * A dry run that skips it reports success for a body whose commit is a 409.
     */
    it('checks the ids the commit would insert before reporting success', async () => {
      await applyWorkflowOperations.execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations, dryRun: true },
      })

      expect(mocks.collectGraphIds).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: { 'block-1': { ...BLOCK, height: 0, horizontalHandles: true } },
          edges: [],
        })
      )
      expect(mocks.assertIdsUnclaimed).toHaveBeenCalledWith(
        expect.anything(),
        'workflow-1',
        GRAPH_IDS
      )
    })

    it('refuses a dry run whose commit would conflict on a claimed id', async () => {
      const conflict = new OrchestrationError(
        'conflict',
        'Block ids already used by another workflow: block-1'
      )
      mocks.assertIdsUnclaimed.mockRejectedValue(conflict)

      await expect(
        applyWorkflowOperations.execute({
          principal: sessionPrincipal,
          input: { workflowId: 'workflow-1', operations, dryRun: true },
        })
      ).rejects.toBe(conflict)
    })

    /**
     * A committed apply reports `[...validation.warnings, ...persisted.warnings]`,
     * the second half raised by the preparation step inside the write. A dry run
     * that dropped that half would not tell a caller its dangling edge is about
     * to disappear — the one thing a preview exists to say.
     */
    it('reports the preparation warnings the committed apply would', async () => {
      mocks.applyOperations.mockReturnValue({
        state: {
          blocks: { 'block-1': BLOCK },
          edges: [{ id: 'edge-9', source: 'block-1', target: 'block-missing' }],
          loops: {},
          parallels: {},
        },
        validationErrors: [],
        skippedItems: [],
      })
      mocks.validate.mockReturnValue({ valid: true, errors: [], warnings: ['validation note'] })

      const dry = await applyWorkflowOperations.execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations, dryRun: true },
      })

      expect(dry.warnings).toEqual([
        'validation note',
        'Dropped edge "edge-9": edge references a missing block',
      ])
    })

    /** The preview is worthless if it does not carry the findings. */
    it('reports the same lint a committed apply would', async () => {
      const dry = await applyWorkflowOperations.execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations, dryRun: true },
      })
      const committed = await applyWorkflowOperations.execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations },
      })

      expect(dry.lint).toEqual(committed.lint)
      expect(committed.dryRun).toBe(false)
    })
  })

  it('reports declined operations rather than failing the batch', async () => {
    mocks.applyOperations.mockReturnValue({
      state: graph(),
      validationErrors: [],
      skippedItems: [
        {
          type: 'duplicate_block_name',
          operationType: 'add',
          blockId: 'block-2',
          reason: 'Name taken',
        },
      ],
    })

    const result = await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: { workflowId: 'workflow-1', operations },
    })

    expect(result.skipped).toHaveLength(1)
    expect(result.applied).toBe(0)
    expect(mocks.replace).toHaveBeenCalledTimes(1)
  })

  it('separates self-healing deferrals from genuine failures', async () => {
    mocks.applyOperations.mockReturnValue({
      state: graph(),
      validationErrors: [],
      skippedItems: [
        {
          type: 'invalid_edge_target',
          operationType: 'add',
          blockId: 'block-2',
          reason: 'Target not created yet',
        },
      ],
    })

    const result = await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: { workflowId: 'workflow-1', operations },
    })

    expect(result.skipped).toHaveLength(0)
    expect(result.deferred).toHaveLength(1)
  })

  it('aborts an atomic batch before the write and carries the declined operations', async () => {
    mocks.applyOperations.mockReturnValue({
      state: graph(),
      validationErrors: [],
      skippedItems: [
        {
          type: 'block_locked',
          operationType: 'edit',
          blockId: 'block-1',
          reason: 'Block is locked',
        },
      ],
    })

    const failure = await applyWorkflowOperations
      .execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations, atomic: true },
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WorkflowOperationsNotAppliedError)
    expect((failure as WorkflowOperationsNotAppliedError).code).toBe('conflict')
    expect((failure as WorkflowOperationsNotAppliedError).skipped).toHaveLength(1)
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  /**
   * The legacy tool threw a bare `Error(MAX_PLAN_REQUIRED)`, which on a public
   * surface is an unclassified 500.
   */
  it('names the plan capability when the workspace cannot use sandboxes', async () => {
    mocks.sandboxAccess.mockResolvedValue(false)

    const failure = await applyWorkflowOperations
      .execute({
        principal: sessionPrincipal,
        input: {
          workflowId: 'workflow-1',
          operations: [
            {
              operation_type: 'edit',
              block_id: 'block-1',
              params: { inputs: { sandboxId: 'sandbox-1' } },
            },
          ],
        },
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ForbiddenOperationError)
    expect((failure as ForbiddenOperationError).detailCode).toBe(
      'WORKSPACE_PLAN_CAPABILITY_REQUIRED'
    )
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('honours a caller-supplied base graph only for a delegated principal', async () => {
    const baseGraph = graph({ 'block-9': { ...BLOCK, id: 'block-9' } })

    await applyWorkflowOperations.execute({
      principal: copilotPrincipal,
      input: { workflowId: 'workflow-1', operations, baseGraph },
    })
    expect(mocks.loadNormalized).not.toHaveBeenCalled()
    expect(mocks.applyOperations).toHaveBeenCalledWith(baseGraph, operations, null)

    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.sandboxAccess.mockResolvedValue(true)
    mocks.blockVisibility.mockResolvedValue({ revealed: [], disabled: [], previewTagged: [] })
    mocks.permissionConfig.mockResolvedValue(null)
    mocks.loadNormalized.mockResolvedValue(graph())
    mocks.normalizeState.mockReturnValue({ state: graph(), warnings: [] })
    mocks.preValidate.mockResolvedValue({ filteredOperations: operations, errors: [] })
    mocks.applyOperations.mockReturnValue({
      state: graph(),
      validationErrors: [],
      skippedItems: [],
    })
    mocks.collectReferences.mockResolvedValue([])
    mocks.collectToolReferences.mockResolvedValue([])
    mocks.validate.mockReturnValue({ valid: true, errors: [], warnings: [] })
    mocks.replace.mockResolvedValue({ warnings: [], state: graph() })
    mocks.needsRedeployment.mockResolvedValue(true)

    await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: { workflowId: 'workflow-1', operations, baseGraph },
    })
    expect(mocks.loadNormalized).toHaveBeenCalledWith('workflow-1')
    expect(mocks.applyOperations).not.toHaveBeenCalledWith(baseGraph, operations, null)
  })

  it('applies the block enablement slice and declines a locked block as a skipped item', async () => {
    mocks.applyOperations.mockReturnValue({
      state: graph({ 'block-1': { ...BLOCK, locked: true } }),
      validationErrors: [],
      skippedItems: [],
    })

    const result = await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: {
        workflowId: 'workflow-1',
        operations,
        blockEnabledChanges: [{ blockId: 'block-1', enabled: false }],
      },
    })

    expect(result.skipped).toEqual([
      expect.objectContaining({ type: 'block_locked', operationType: 'set_block_enabled' }),
    ])
  })

  it('projects audit from the authoritative result and notifies after it', async () => {
    await applyWorkflowOperations.execute({
      principal: copilotPrincipal,
      input: { workflowId: 'workflow-1', operations },
    })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.updated',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({
          operation: 'workflows.operations.apply',
          op: 'apply_operations',
          operationCount: 1,
          appliedCount: 1,
          skippedCount: 0,
          source: 'copilot',
        }),
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledBefore(mocks.notify)
  })

  it('refuses a locked workflow before loading the graph', async () => {
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValue(
      new WorkflowLockedError('Workflow is locked')
    )

    await expect(
      applyWorkflowOperations.execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations },
      })
    ).rejects.toMatchObject({ code: 'locked' })

    expect(mocks.loadNormalized).not.toHaveBeenCalled()
  })

  it('rejects a workspace API key, which this operation denies, before canonical loading', async () => {
    await expect(
      applyWorkflowOperations.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'ws-key-1' },
        input: { workflowId: 'workflow-1', operations },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('rejects a graph the engine produced that does not validate, without writing', async () => {
    mocks.validate.mockReturnValue({
      valid: false,
      errors: ['Dangling edge'],
      warnings: [],
    })

    await expect(
      applyWorkflowOperations.execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  /**
   * The enablement slice appends its refusals to the same `skippedItems` array
   * the engine uses, so subtracting that array from the operation count charged
   * enablement refusals against operations — and could go negative, which
   * `Math.max` then hid.
   */
  it('does not charge enablement refusals against the operation count', async () => {
    mocks.applyOperations.mockReturnValue({
      state: graph({
        'block-1': { ...BLOCK, locked: true },
        'block-2': { ...BLOCK, id: 'block-2', locked: true },
      }),
      validationErrors: [],
      skippedItems: [],
    })

    const result = await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: {
        workflowId: 'workflow-1',
        operations,
        blockEnabledChanges: [
          { blockId: 'block-1', enabled: false },
          { blockId: 'block-2', enabled: false },
        ],
      },
    })

    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(2)
  })

  /**
   * `disabled_ancestor` is one of the three protection rules and has its own
   * member of the published skip enum; reporting it as `block_locked` told a
   * client to unlock a block that was never locked.
   */
  it('names a disabled container as the reason rather than calling the block locked', async () => {
    mocks.applyOperations.mockReturnValue({
      state: graph({
        'loop-1': { ...BLOCK, id: 'loop-1', type: 'loop', enabled: false },
        'block-1': { ...BLOCK, enabled: false, data: { parentId: 'loop-1' } },
      }),
      validationErrors: [],
      skippedItems: [],
    })

    const result = await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: {
        workflowId: 'workflow-1',
        operations,
        blockEnabledChanges: [{ blockId: 'block-1', enabled: true }],
      },
    })

    expect(result.skipped).toEqual([
      expect.objectContaining({ type: 'disabled_ancestor', operationType: 'set_block_enabled' }),
    ])
  })

  /**
   * A stripped credential is a refusal too. `preValidateCredentialInputs`
   * deletes the field rather than failing, so an atomic gate that only reads
   * `skipped` would commit a block whose credential silently vanished.
   */
  it('refuses an atomic batch whose credential was stripped, and carries the dropped input', async () => {
    const dropped = {
      blockId: 'block-2',
      blockType: 'agent',
      field: 'credential',
      value: 'cred-9',
      error: 'Invalid credential ID',
    }
    mocks.preValidate.mockResolvedValue({ filteredOperations: operations, errors: [dropped] })

    const failure = await applyWorkflowOperations
      .execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations, atomic: true },
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WorkflowOperationsNotAppliedError)
    expect((failure as WorkflowOperationsNotAppliedError).droppedInputs).toEqual([dropped])
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  /**
   * `collectUnresolvedReferences` is read-only: the values it flags stay
   * persisted. Reporting them as `inputValidationErrors` — documented as inputs
   * "dropped rather than persisted" — double-reported them, and falsely.
   */
  it('reports an unresolved reference only in lint, never as a dropped input', async () => {
    const reference = {
      blockId: 'block-2',
      blockType: 'agent',
      field: 'credential',
      value: 'cred-9',
      kind: 'credential' as const,
      reason: 'Credential not accessible',
    }
    mocks.collectReferences.mockResolvedValue([reference])

    const result = await applyWorkflowOperations.execute({
      principal: sessionPrincipal,
      input: { workflowId: 'workflow-1', operations },
    })

    expect(result.lint.unresolvedReferences).toEqual([reference])
    expect(result.inputValidationErrors).toEqual([])
    expect(mocks.replace).toHaveBeenCalledTimes(1)
  })

  it('does not refuse an atomic batch for a reference that stays persisted', async () => {
    mocks.collectReferences.mockResolvedValue([
      {
        blockId: 'block-2',
        blockType: 'agent',
        field: 'credential',
        value: 'cred-9',
        kind: 'credential' as const,
        reason: 'Credential not accessible',
      },
    ])

    await expect(
      applyWorkflowOperations.execute({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', operations, atomic: true },
      })
    ).resolves.toMatchObject({ applied: 1 })
  })
})
