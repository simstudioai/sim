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
  prepare: vi.fn(),
  collectGraphIds: vi.fn(),
  assertIdsUnclaimed: vi.fn(),
  validate: vi.fn(),
  needsRedeployment: vi.fn(),
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
vi.mock('@/lib/workflows/persistence/prepare-state', () => ({
  prepareWorkflowStateForPersistence: mocks.prepare,
}))
vi.mock('@/lib/workflows/persistence/replace-normalized-state', () => ({
  replaceWorkflowNormalizedState: mocks.replace,
  collectWorkflowGraphIds: mocks.collectGraphIds,
  assertWorkflowGraphIdsUnclaimed: mocks.assertIdsUnclaimed,
}))
vi.mock('@/lib/workflows/sanitization/validation', () => ({
  validateWorkflowState: mocks.validate,
}))
vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: mocks.needsRedeployment,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'
import { REFERENCES_UNCHECKED_NOTE } from '@/lib/workflows/editing/lint-report'

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
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const sessionPrincipal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}

const input = { workflowId: 'workflow-1', blocks: { 'block-1': BLOCK }, edges: [] }

describe('replaceWorkflowState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.validate.mockReturnValue({ valid: true, errors: [], warnings: [] })
    mocks.replace.mockResolvedValue({
      warnings: [],
      state: { blocks: { 'block-1': BLOCK }, edges: [], loops: {}, parallels: {} },
    })
    mocks.needsRedeployment.mockResolvedValue(true)
    mocks.prepare.mockReturnValue({
      state: { blocks: { 'block-1': BLOCK }, edges: [], loops: {}, parallels: {} },
      warnings: [],
    })
    mocks.collectGraphIds.mockReturnValue({ blockIds: ['block-1'], edgeIds: [], subflowIds: [] })
    mocks.assertIdsUnclaimed.mockResolvedValue(undefined)
  })

  /**
   * Two things this pins that a same-shape input and output cannot: the write
   * carries the **sanitized** graph, not the caller's body, and the reported
   * counts come from what was persisted, not from what was asked for. The
   * fixture deliberately makes the two differ.
   */
  it('writes the sanitized graph and counts what was persisted, not what was sent', async () => {
    const DROPPED_BLOCK = { ...BLOCK, id: 'block-2', name: 'Dropped' }
    const DROPPED_EDGE = { id: 'edge-9', source: 'block-1', target: 'block-2' }
    mocks.validate.mockReturnValue({
      valid: true,
      errors: [],
      warnings: ['Dropped block "block-2"'],
      sanitizedState: { blocks: { 'block-1': BLOCK }, edges: [], loops: {}, parallels: {} },
    })

    await expect(
      replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: {
          workflowId: 'workflow-1',
          blocks: { 'block-1': BLOCK, 'block-2': DROPPED_BLOCK },
          edges: [DROPPED_EDGE],
        },
      })
    ).resolves.toMatchObject({
      workflowId: 'workflow-1',
      blocksCount: 1,
      edgesCount: 0,
      needsRedeployment: true,
    })

    expect(mocks.replace).toHaveBeenCalledWith({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      attributedUserId: 'user-1',
      state: { blocks: { 'block-1': BLOCK }, edges: [], variables: undefined },
    })
  })

  /**
   * `PUT /state` used to pass `variables` through verbatim while
   * `PATCH /variables` re-keyed by variable id and coerced each value onto its
   * declared type, so the same column held two shapes depending on which write
   * reached it last — which is why the read side carries defensive parsing.
   * Both writes now share one normalizer.
   */
  it('re-keys variables by their own id and coerces each value onto its declared type', async () => {
    await replaceWorkflowState.execute({
      principal: sessionPrincipal,
      input: {
        ...input,
        variables: {
          'stale-key': { id: 'var-1', name: 'retries', type: 'number', value: '42' },
          'another-stale-key': { id: 'var-2', name: 'enabled', type: 'boolean', value: 'true' },
          'json-key': { id: 'var-3', name: 'tags', type: 'array', value: '["a","b"]' },
        },
      },
    })

    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          variables: {
            'var-1': { id: 'var-1', name: 'retries', type: 'number', value: 42 },
            'var-2': { id: 'var-2', name: 'enabled', type: 'boolean', value: true },
            'var-3': { id: 'var-3', name: 'tags', type: 'array', value: ['a', 'b'] },
          },
        }),
      })
    )
  })

  it('derives the audit source from the acting principal and notifies after it', async () => {
    await replaceWorkflowState.execute({ principal: sessionPrincipal, input })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.updated',
        resourceId: 'workflow-1',
        resourceName: 'Daily digest',
        metadata: expect.objectContaining({
          operation: 'workflows.state.replace',
          op: 'replace_state',
          blocksCount: 1,
          source: 'session',
        }),
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledBefore(mocks.notify)
    expect(mocks.notify).toHaveBeenCalledWith('workflow-1')
  })

  it('names the delegated service rather than the principal kind', async () => {
    await replaceWorkflowState.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'tool-call-1',
        audience: 'sim:workflows',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      },
      input,
    })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ source: 'copilot' }) })
    )
  })

  it('refuses a role below the operation floor', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('rejects a principal kind the operation does not accept before canonical loading', async () => {
    await expect(
      replaceWorkflowState.execute({
        principal: {
          kind: 'credential_group_enrollment',
          workspaceId: 'workspace-1',
          credentialGroupId: 'group-1',
          enrollmentId: 'enrollment-1',
          email: 'someone@example.com',
          invitationTokenHash: 'hash',
        },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('conceals an asserted-workspace mismatch as not found', async () => {
    mocks.resolveContext.mockRejectedValue(
      new OrchestrationError('not_found', 'Workflow not found')
    )

    await expect(
      replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: { ...input, assertedWorkspaceId: 'other-workspace' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses a locked workflow before validating or writing', async () => {
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValue(
      new WorkflowLockedError('Workflow is locked')
    )

    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toMatchObject({ code: 'locked' })

    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('rejects a semantically invalid graph without writing', async () => {
    mocks.validate.mockReturnValue({
      valid: false,
      errors: ['Edge references an unknown block'],
      warnings: [],
    })

    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('records neither audit nor notification when the write fails', async () => {
    mocks.replace.mockRejectedValue(new Error('constraint violation'))

    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toThrow('constraint violation')

    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  /**
   * The report is the whole point of the endpoint for a headless builder: an
   * agent that authors a graph from scratch needs the same findings as one that
   * edits it incrementally through `POST /operations`.
   */
  it('reports lint findings alongside a committed write', async () => {
    const result = await replaceWorkflowState.execute({
      principal: sessionPrincipal,
      input,
    })

    expect(result.dryRun).toBe(false)
    expect(result.lint).toMatchObject({
      sources: expect.any(Array),
      sinks: expect.any(Array),
      orphanBlocks: expect.any(Array),
      fieldIssues: expect.any(Array),
      unresolvedReferences: expect.any(Array),
      notes: expect.any(Array),
    })
  })

  describe('dry run', () => {
    it('persists nothing, audits nothing, and notifies nobody', async () => {
      const result = await replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: { ...input, dryRun: true },
      })

      expect(result.dryRun).toBe(true)
      expect(mocks.replace).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
      expect(mocks.notify).not.toHaveBeenCalled()
    })

    /** A preview a caller cannot act on is worthless; it must carry the findings. */
    it('still reports the findings a committed write would produce', async () => {
      const dry = await replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: { ...input, dryRun: true },
      })
      const committed = await replaceWorkflowState.execute({ principal: sessionPrincipal, input })

      expect(dry.lint).toEqual(committed.lint)
      expect(dry.blocksCount).toBe(committed.blocksCount)
      expect(dry.edgesCount).toBe(committed.edgesCount)
    })

    /**
     * The preview promised in {@link ReplaceWorkflowStateInput.dryRun} is
     * byte-identical to the committed write of the same body, and preparation
     * is where a dropped edge or a stripped inline secret is noted. Reporting
     * only the validation half made the dry run quietly less informative than
     * the write it previews.
     */
    it('merges the preparation warnings a committed write would report', async () => {
      mocks.validate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: ['Dropped block "block-2"'],
      })
      mocks.prepare.mockReturnValue({
        state: { blocks: { 'block-1': BLOCK }, edges: [], loops: {}, parallels: {} },
        warnings: ['Dropped edge "edge-9": target block does not exist'],
      })
      mocks.replace.mockResolvedValue({
        warnings: ['Dropped edge "edge-9": target block does not exist'],
        state: { blocks: { 'block-1': BLOCK }, edges: [], loops: {}, parallels: {} },
      })

      const dry = await replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: { ...input, dryRun: true },
      })
      const committed = await replaceWorkflowState.execute({ principal: sessionPrincipal, input })

      expect(dry.warnings).toEqual([
        'Dropped block "block-2"',
        'Dropped edge "edge-9": target block does not exist',
      ])
      expect(dry.warnings).toEqual(committed.warnings)
    })

    /**
     * A dry run that reports clean for a body that cannot commit is worse than
     * the fault it hides. It checks the ids the write would actually insert —
     * the prepared graph's, not the caller's body's.
     */
    it('refuses a graph whose ids another workflow already owns', async () => {
      mocks.assertIdsUnclaimed.mockRejectedValueOnce(
        new OrchestrationError('conflict', 'Block ids already used by another workflow: block-1')
      )

      await expect(
        replaceWorkflowState.execute({
          principal: sessionPrincipal,
          input: { ...input, dryRun: true },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(mocks.replace).not.toHaveBeenCalled()
    })

    it('checks the ids the prepared graph would insert, not the ids sent', async () => {
      const prepared = { blocks: { 'block-1': BLOCK }, edges: [], loops: {}, parallels: {} }
      mocks.prepare.mockReturnValue({ state: prepared, warnings: [] })

      await replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: { ...input, dryRun: true },
      })

      expect(mocks.collectGraphIds).toHaveBeenCalledWith(prepared)
      expect(mocks.assertIdsUnclaimed).toHaveBeenCalledWith(expect.anything(), 'workflow-1', {
        blockIds: ['block-1'],
        edgeIds: [],
        subflowIds: [],
      })
    })

    /** A locked workflow refuses the preview too, or the preview would lie. */
    it('refuses when the workflow cannot be mutated', async () => {
      workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValueOnce(
        new WorkflowLockedError('workflow-1')
      )

      await expect(
        replaceWorkflowState.execute({
          principal: sessionPrincipal,
          input: { ...input, dryRun: true },
        })
      ).rejects.toThrow()
    })
  })

  /**
   * A replace stores blocks and their tool wiring wholesale, and the policies
   * deciding which of those a member may add take a human subject. A workspace
   * API key has none, and both substitutes fail open — the billing owner is a
   * different, typically less-constrained person — so the operation refuses one
   * outright rather than writing a graph it cannot evaluate. Without this,
   * `PUT …/state` stored what `POST …/operations` refuses.
   */
  describe('reference resolution identity', () => {
    it('refuses a workspace API key, which names no human to evaluate', async () => {
      await expect(
        replaceWorkflowState.execute({
          principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
          input,
        })
      ).rejects.toThrow()
    })

    it('runs the reference pass for a human principal', async () => {
      const result = await replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input,
      })

      expect(result.lint.notes).not.toContain(REFERENCES_UNCHECKED_NOTE)
    })
  })
})
