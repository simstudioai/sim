/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    admission: vi.fn(),
    executeWorkflow: vi.fn(),
    latestState: vi.fn(),
    loadDeployed: vi.fn(),
    loadDraft: vi.fn(),
    permission: vi.fn(),
    resolveContext: vi.fn(),
    resolveOptions: vi.fn(),
    sourceState: vi.fn(),
    validateInput: vi.fn(),
  },
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/workflows/execution-admission', () => ({
  prepareWorkflowExecutionAdmission: mocks.admission,
}))

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getExecutionInputForWorkflow: vi.fn(),
  getExecutionStateForWorkflow: mocks.sourceState,
  getLatestExecutionStateWithExecutionId: mocks.latestState,
}))

vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: mocks.executeWorkflow,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mocks.loadDeployed,
  loadWorkflowFromNormalizedTables: mocks.loadDraft,
  NoActiveDeploymentError: class NoActiveDeploymentError extends Error {},
}))

vi.mock('@/lib/workflows/triggers/run-options', () => ({
  resolveTriggerRunOptions: mocks.resolveOptions,
  validateTriggerInput: mocks.validateInput,
}))

vi.mock('@sim/workflow-persistence/subblocks', () => ({
  mergeSubblockStateWithValues: vi.fn((blocks) => blocks),
}))

vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'child-execution-1') }))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: vi.fn(() => 'request-1') }))

import {
  runFromBlockFromCopilot,
  runWorkflowFromCopilot,
} from '@/lib/workflows/application/run-workflow-from-copilot'
import { readAttemptedExecutionId } from '@/executor/utils/errors'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'tool-call-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
}

const context = {
  workflowId: 'workflow-1',
  workflow: {
    id: 'workflow-1',
    userId: 'owner-1',
    workspaceId: 'workspace-1',
    variables: {},
  },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const lifecycle = {}

describe('Copilot workflow run application commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.permission.mockResolvedValue('write')
    mocks.loadDraft.mockResolvedValue({ blocks: { trigger: {} }, edges: [] })
    mocks.resolveOptions.mockReturnValue([
      { triggerBlockId: 'trigger', blockName: 'Start', mockPayload: { source: 'mock' } },
    ])
    mocks.validateInput.mockReturnValue({ ok: true })
    mocks.admission.mockResolvedValue({ billingAttribution: undefined, targetReservation: false })
    mocks.executeWorkflow.mockResolvedValue({ success: true, output: { ok: true }, logs: [] })
  })

  it('owns canonical authorization, trigger selection, admission, and execution', async () => {
    const result = await runWorkflowFromCopilot.execute({
      principal,
      input: {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        useDraftState: true,
        lifecycle,
        hasWorkflowInput: false,
        useMockPayload: true,
      },
    })

    expect(result).toMatchObject({ success: true, output: { ok: true } })
    expect(mocks.resolveContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      assertedWorkspaceId: undefined,
    })
    expect(mocks.permission).toHaveBeenCalledBefore(mocks.loadDraft)
    expect(mocks.admission).toHaveBeenCalledWith(
      { userId: 'user-1', billingAttribution: undefined },
      'workspace-1',
      'child-execution-1'
    )
    expect(mocks.executeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workflow-1' }),
      'request-1',
      { source: 'mock' },
      'user-1',
      expect.objectContaining({
        useDraftState: true,
        workflowTriggerType: 'copilot',
        triggerBlockId: 'trigger',
      }),
      'child-execution-1'
    )
  })

  it('runs under a caller-claimed execution id and stamps its copilot correlation', async () => {
    // Set when the request handler wins the workflow-tool claim and runs the
    // tool server-side. The claimed id must BE the child execution id, and the
    // log row must carry the tool-call correlation, or a server-run tool call
    // is unattributable where a browser-run one is not.
    await runWorkflowFromCopilot.execute({
      principal,
      input: {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        useDraftState: true,
        lifecycle: {
          ...lifecycle,
          boundExecution: {
            executionId: 'claimed-execution-1',
            copilotToolCallId: 'tool-call-1',
          },
        },
        hasWorkflowInput: false,
        useMockPayload: true,
      },
    })

    expect(mocks.admission).toHaveBeenCalledWith(
      { userId: 'user-1', billingAttribution: undefined },
      'workspace-1',
      'claimed-execution-1'
    )
    expect(mocks.executeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workflow-1' }),
      'request-1',
      { source: 'mock' },
      'user-1',
      expect.objectContaining({
        trustedExecutionCorrelation: {
          executionId: 'claimed-execution-1',
          requestId: 'request-1',
          source: 'workflow',
          workflowId: 'workflow-1',
          triggerType: 'copilot',
          copilotToolCallId: 'tool-call-1',
        },
      }),
      'claimed-execution-1'
    )
  })

  it('does not stamp a correlation for an ordinary browser-routed run', async () => {
    await runWorkflowFromCopilot.execute({
      principal,
      input: {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        useDraftState: true,
        lifecycle,
        hasWorkflowInput: false,
        useMockPayload: true,
      },
    })

    expect(mocks.executeWorkflow.mock.calls.at(-1)?.[4]).not.toHaveProperty(
      'trustedExecutionCorrelation'
    )
  })

  it('rechecks current permission before loading execution state', async () => {
    mocks.permission.mockResolvedValueOnce(null)

    await expect(
      runWorkflowFromCopilot.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          useDraftState: true,
          lifecycle,
          hasWorkflowInput: false,
          useMockPayload: true,
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadDraft).not.toHaveBeenCalled()
    expect(mocks.executeWorkflow).not.toHaveBeenCalled()
  })

  it('fails before execution when the selected durable definition is absent', async () => {
    mocks.loadDraft.mockResolvedValueOnce(null)

    await expect(
      runWorkflowFromCopilot.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          useDraftState: true,
          lifecycle,
          hasWorkflowInput: false,
          useMockPayload: true,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.admission).not.toHaveBeenCalled()
  })

  it('owns canonical source snapshot lineage for run-from-block', async () => {
    const snapshot = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: {},
      completedLoops: [],
      activeExecutionPath: [],
    }
    mocks.sourceState.mockResolvedValueOnce(snapshot)

    await runFromBlockFromCopilot.execute({
      principal,
      input: {
        workflowId: 'workflow-1',
        useDraftState: true,
        lifecycle,
        blockId: 'agent-1',
        sourceExecutionId: 'source-execution-1',
      },
    })

    expect(mocks.executeWorkflow).toHaveBeenCalledWith(
      expect.any(Object),
      'request-1',
      undefined,
      'user-1',
      expect.objectContaining({
        runFromBlock: {
          startBlockId: 'agent-1',
          sourceSnapshot: snapshot,
          sourceExecutionId: 'source-execution-1',
        },
      }),
      'child-execution-1'
    )
  })

  it('propagates unexpected execution infrastructure failures', async () => {
    mocks.executeWorkflow.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      runWorkflowFromCopilot.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          useDraftState: true,
          lifecycle,
          hasWorkflowInput: false,
          useMockPayload: true,
        },
      })
    ).rejects.toThrow('database unavailable')
  })

  /**
   * A caller whose result was withheld decides about retry from one fact: whether a run
   * exists. This layer owns that answer, because it is the last place that can distinguish
   * "we never handed the work to the executor" from "we did".
   *
   * Deliberately coarse. A preflight refusal inside `executeWorkflow` also names the run,
   * costing the caller one lookup; establishing anything finer would take a callback on
   * every block of every execution in the product.
   */
  describe('naming the run a failure belongs to', () => {
    const runInput = {
      workflowId: 'workflow-1',
      useDraftState: true,
      lifecycle,
      hasWorkflowInput: false,
      useMockPayload: true,
    }

    const failWith = (input = runInput) =>
      runWorkflowFromCopilot.execute({ principal, input }).catch((thrown) => thrown)

    it('names the run once it has been handed to the executor', async () => {
      mocks.executeWorkflow.mockRejectedValueOnce(new Error('database unavailable'))

      expect(readAttemptedExecutionId(await failWith())).toBe('child-execution-1')
    })

    /**
     * Deliberate, and the one place this contract is deliberately coarse: `executeWorkflow`
     * validates its own arguments before creating anything, and those failures still name
     * the run. `attempted` means "zero or one executions exist under this id, resolve it",
     * so the caller resolves, finds nothing, and retries — correct, at the cost of a lookup.
     *
     * Paying to avoid that lookup means an executor-side dispatch marker, which is a
     * callback on every block of every execution in the product. It would also buy nothing:
     * all four preflight throws are invariant violations — no workspace id, no billing
     * attribution, no principal, attribution mismatch — so a retry fails identically.
     */
    it('names the run for a failure inside the executor call, whatever its cause', async () => {
      mocks.executeWorkflow.mockRejectedValueOnce(
        new Error('Billing attribution is required for workspace execution')
      )

      expect(readAttemptedExecutionId(await failWith())).toBe('child-execution-1')
    })

    it('names the run when the crossing threw after it already returned', async () => {
      // Only the post-run crossing throws; the catch re-enters this same method to record
      // the failed crossing, and throwing again there would replace the error the id is on.
      let crossings = 0
      const registry = {
        exportProvenanceForValue: () => undefined,
        beginPendingActivation: () => () => {},
        importCrossingProvenance: () => {
          if (crossings++ === 0) throw new Error('crossing import failed')
        },
      }

      const error = await failWith({
        ...runInput,
        lifecycle: { resolvedSecretTraceRegistry: registry },
      } as typeof runInput)

      expect(readAttemptedExecutionId(error)).toBe('child-execution-1')
    })

    it('names nothing when admission refused the run before it could start', async () => {
      mocks.admission.mockRejectedValueOnce(new Error('Usage limit exceeded'))

      const error = await failWith()

      expect(mocks.executeWorkflow).not.toHaveBeenCalled()
      expect(readAttemptedExecutionId(error)).toBeUndefined()
    })

    it('names nothing when authorization refused the run', async () => {
      mocks.permission.mockResolvedValue('read')

      const error = await failWith()

      expect(mocks.admission).not.toHaveBeenCalled()
      expect(readAttemptedExecutionId(error)).toBeUndefined()
    })
  })

  describe('failed-run provenance crossing', () => {
    function trackingLifecycle() {
      const importCrossingProvenance = vi.fn().mockResolvedValue(true)
      return {
        importCrossingProvenance,
        lifecycle: {
          resolvedSecretTraceRegistry: {
            exportProvenanceForValue: vi.fn(() => undefined),
            beginPendingActivation: vi.fn(() => vi.fn()),
            importCrossingProvenance,
          },
        },
      }
    }

    async function runExpectingFailure(input: { lifecycle: unknown }) {
      await expect(
        runWorkflowFromCopilot.execute({
          principal,
          input: {
            workflowId: 'workflow-1',
            useDraftState: true,
            lifecycle: input.lifecycle,
            hasWorkflowInput: false,
            useMockPayload: true,
          },
        })
      ).rejects.toThrow()
    }

    /**
     * The executor attaches its result to every throw, so a failure without one never reached a
     * block. Nothing crossed, and saying so keeps the caller's tool result — and the reason its
     * run could not start — instead of reducing it to "result unavailable".
     */
    it('vouches for a failure that never reached the engine', async () => {
      const { importCrossingProvenance, lifecycle: tracked } = trackingLifecycle()
      mocks.executeWorkflow.mockRejectedValueOnce(new Error('workflow is not deployed'))

      await runExpectingFailure({ lifecycle: tracked })

      expect(importCrossingProvenance).toHaveBeenCalledWith(
        { version: 1, complete: true, entries: [] },
        expect.objectContaining({ thrownMessage: 'workflow is not deployed' }),
        expect.objectContaining({ origin: 'copilotWorkflowMutation.failedRunCrossing' })
      )
    })

    /**
     * The post-run crossing is inside the same try, so its failure reaches the catch with no
     * execution result — the same evidence a never-started run leaves. An execution exists and
     * its provenance was never imported, so this must not be vouched for.
     */
    it('does not vouch when the crossing threw after the run returned', async () => {
      const importCrossingProvenance = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('crossing import failed')
        })
        .mockResolvedValue(true)

      await runExpectingFailure({
        lifecycle: {
          resolvedSecretTraceRegistry: {
            exportProvenanceForValue: vi.fn(() => undefined),
            beginPendingActivation: vi.fn(() => vi.fn()),
            importCrossingProvenance,
          },
        },
      })

      expect(importCrossingProvenance).toHaveBeenNthCalledWith(
        2,
        undefined,
        expect.objectContaining({ thrownMessage: 'crossing import failed' }),
        expect.objectContaining({ origin: 'copilotWorkflowMutation.failedRunCrossing' })
      )
    })

    /**
     * The executor's post-execution work can throw after a run has already produced a result.
     * `executeWorkflow` carries it on that throw, so this reaches the catch with a result and
     * must not be claimed as never-started.
     */
    it('does not vouch when post-execution work threw after the engine ran', async () => {
      const { importCrossingProvenance, lifecycle: tracked } = trackingLifecycle()
      const incomplete = { version: 1 as const, complete: false, entries: [] }
      mocks.executeWorkflow.mockRejectedValueOnce(
        Object.assign(new Error('post-execution persistence failed'), {
          executionResult: {
            success: true,
            output: { ran: true },
            executionState: { resolvedSecretTraceProvenance: incomplete },
          },
        })
      )

      await runExpectingFailure({ lifecycle: tracked })

      expect(importCrossingProvenance).toHaveBeenCalledWith(
        incomplete,
        expect.objectContaining({ output: { ran: true } }),
        expect.objectContaining({ origin: 'copilotWorkflowMutation.failedRunCrossing' })
      )
    })

    /** A run that did execute and could not vouch still hands back its incomplete envelope. */
    it('passes through an incomplete envelope from a run that did execute', async () => {
      const { importCrossingProvenance, lifecycle: tracked } = trackingLifecycle()
      const incomplete = { version: 1 as const, complete: false, entries: [] }
      const failure = Object.assign(new Error('block failed'), {
        executionResult: {
          success: false,
          output: { partial: true },
          executionState: { resolvedSecretTraceProvenance: incomplete },
        },
      })
      mocks.executeWorkflow.mockRejectedValueOnce(failure)

      await runExpectingFailure({ lifecycle: tracked })

      expect(importCrossingProvenance).toHaveBeenCalledWith(
        incomplete,
        expect.objectContaining({ output: { partial: true } }),
        expect.objectContaining({ origin: 'copilotWorkflowMutation.failedRunCrossing' })
      )
    })
  })
})
