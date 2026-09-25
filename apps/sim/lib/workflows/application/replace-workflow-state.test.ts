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
  loadNormalized: vi.fn(),
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
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadNormalized,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'
import { validateInputsForBlock } from '@/lib/workflows/editing/validation'
import { AgentBlock } from '@/blocks/blocks/agent'
import { ExaBlock } from '@/blocks/blocks/exa'
import { getBlock } from '@/blocks/registry'

const defaultGetBlock = vi.mocked(getBlock).getMockImplementation()

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
    vi.mocked(getBlock).mockImplementation((type) =>
      type === 'exa' ? ExaBlock : type === 'agent' ? AgentBlock : defaultGetBlock?.(type)
    )
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
    mocks.loadNormalized.mockResolvedValue({ blocks: {}, edges: [], loops: {}, parallels: {} })
  })

  it.each([true, false])(
    'reports binding removals before/after save (dryRun=%s)',
    async (dryRun) => {
      vi.mocked(getBlock).mockImplementation((type) =>
        type === 'bound-test'
          ? ({
              type: 'bound-test',
              subBlocks: [{ id: 'credential', type: 'oauth-input' }],
              outputs: {},
            } as never)
          : defaultGetBlock?.(type)
      )
      const bound = {
        ...BLOCK,
        type: 'bound-test',
        subBlocks: {
          credential: { id: 'credential', type: 'oauth-input' as const, value: 'credential-1' },
        },
      }
      mocks.loadNormalized.mockResolvedValue({
        blocks: { [BLOCK.id]: bound },
        edges: [],
        loops: {},
        parallels: {},
      })
      const result = await replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: { ...input, dryRun },
      })
      expect(result.removedBindings).toEqual([
        expect.objectContaining({
          blockId: BLOCK.id,
          resourceId: 'credential-1',
          kind: 'credential',
          field: 'credential',
        }),
      ])
      expect(result.warnings.join(' ')).toContain('removes 1 credential/table binding')
      expect(mocks.loadNormalized).toHaveBeenCalledTimes(1)
      expect(mocks.loadNormalized).toHaveBeenCalledWith(context.workflowId, undefined, {
        persistMigrations: false,
      })
      expect(mocks.replace).toHaveBeenCalledTimes(dryRun ? 0 : 1)
    }
  )

  it('does not read saved bindings before access is authorized', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toThrow()
    expect(mocks.loadNormalized).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
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
  })

  describe('registry input validation', () => {
    for (const dryRun of [true, false]) {
      it.each(['type', 'category', 'text', 'highlights', 'summary'])(
        `rejects the same dynamic %s value as operations apply (dryRun=${dryRun})`,
        async (field) => {
          const value = `<start.${field}>`
          const { errors } = validateInputsForBlock('exa', { [field]: value }, BLOCK.id)
          expect(errors).toHaveLength(1)
          await expect(
            replaceWorkflowState.execute({
              principal: sessionPrincipal,
              input: {
                ...input,
                dryRun,
                blocks: {
                  [BLOCK.id]: {
                    ...BLOCK,
                    type: 'exa',
                    advancedMode: true,
                    subBlocks: { [field]: { id: field, type: 'short-input', value } },
                  },
                },
              },
            })
          ).rejects.toThrow(errors[0].error)
          expect(mocks.replace).not.toHaveBeenCalled()
          expect(mocks.notify).not.toHaveBeenCalled()
          expect(mocks.recordAudit).not.toHaveBeenCalled()
        }
      )
    }
  })

  describe('Mothership attachment identity on state replacement', () => {
    const copilotPrincipal = {
      kind: 'delegated' as const,
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'tool-call-1',
      audience: 'sim:workflows',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }
    const block = {
      ...BLOCK,
      type: 'agent',
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input' as const,
          value: [{ type: 'exa', operation: 'exa_search', title: 'Existing label' }],
        },
      },
    }
    const replacement = { ...input, blocks: { [BLOCK.id]: block } }

    it.each([false, true])('rejects new aliases before persistence (dryRun=%s)', async (dryRun) => {
      await expect(
        replaceWorkflowState.execute({
          principal: copilotPrincipal,
          input: { ...replacement, dryRun },
        })
      ).rejects.toThrow('attachment names are read-only')
      expect(mocks.replace).not.toHaveBeenCalled()
      expect(mocks.notify).not.toHaveBeenCalled()
    })

    it('preserves an existing label when replacing the graph and editing other fields', async () => {
      mocks.loadNormalized.mockResolvedValue({
        blocks: { [BLOCK.id]: block },
        edges: [],
        loops: {},
        parallels: {},
      })
      await expect(
        replaceWorkflowState.execute({
          principal: copilotPrincipal,
          input: { ...replacement, blocks: { [BLOCK.id]: { ...block, name: 'Updated Agent' } } },
        })
      ).resolves.toMatchObject({ dryRun: false })
      expect(mocks.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({
            blocks: { [BLOCK.id]: { ...block, name: 'Updated Agent' } },
          }),
        })
      )
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
  })
})
