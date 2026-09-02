/**
 * @vitest-environment node
 *
 * What a caller can learn about a workflow run whose result the secret-egress boundary
 * withholds.
 *
 * The registry is latched the way production latches one — a child run that returned no
 * provenance envelope — rather than by asserting an "unsafe" flag, so these fail for the
 * same reason the incident did. Every outcome the copilot run path can produce is driven
 * through the real handler and the real projection and asserted on two axes: the retry
 * decision a caller can reach, which is the point of the disclosure, and that no run
 * content crosses, which is the point of the boundary.
 *
 * The phases are deliberately coarse. `attempted` and `performed` both mean "an execution
 * exists under this id". Separating "ran no blocks" from "ran some" would take a callback
 * on every block of every execution in the product, and buys a caller nothing it cannot get
 * by resolving the id it was handed.
 */
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import { attachAttemptedExecutionId } from '@/executor/utils/errors'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mocks } = vi.hoisted(() => ({ mocks: { executeWorkflowUseCase: vi.fn() } }))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: mocks.executeWorkflowUseCase,
  /** Passthrough, so a masked message reads as masking rather than as a fallback. */
  messageForCopilotWorkflowError: (error: unknown, fallback = 'Workflow operation failed') =>
    getErrorMessage(error, fallback),
}))

vi.mock('@/lib/workflows/sanitization/json-sanitizer', () => ({
  sanitizeForCopilot: vi.fn((state) => state),
}))

/**
 * The use cases these handlers dispatch are only passed through to the mocked
 * use-case executor above, so their execution-side leaves — the workflow
 * executor, the paused-run manager, and deployment orchestration — are stubbed
 * rather than loaded.
 */
vi.mock('@/lib/workflows/executor/execute-workflow', () => ({ executeWorkflow: vi.fn() }))
vi.mock('@/lib/execution/cancel-workflow-execution', () => ({
  cancelWorkflowExecution: vi.fn(),
  WorkflowExecutionNotFoundError: class WorkflowExecutionNotFoundError extends Error {},
}))
vi.mock('@/lib/workflows/orchestration', () => ({ performCreateWorkflowTransition: vi.fn() }))

vi.mock('@/lib/core/telemetry', () => ({ PlatformEvents: { apiKeyGenerated: vi.fn() } }))

import { executeRunWorkflow } from '@/lib/copilot/tools/handlers/workflow/mutations'

const EXECUTION_ID = '0f4d5a4c-6a1e-4c2f-9b7d-2c8f1a3e5d90'
/**
 * Above the eight-character substitution floor, and deliberately not shaped like a real
 * provider credential — a realistic fixture makes secret scanners flag this file.
 */
const SECRET = 'fake-secret-for-test-only'

const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  toolCallId: 'tool-call-1',
} as ExecutionContext

/** A registry latched exactly as `importCrossingProvenance` latches one in production. */
async function latchedRegistry(): Promise<ResolvedSecretTraceRegistry> {
  const registry = new ResolvedSecretTraceRegistry([
    { name: 'API_KEY', plaintext: SECRET, encryptedValue: 'ciphertext' },
  ])
  registry.recordResolved('API_KEY', SECRET, { propagated: true })
  await registry.importCrossingProvenance(
    undefined,
    { output: {} },
    { trusted: true, origin: 'copilotWorkflowMutation.runCrossing' }
  )
  expect(registry.isPermanentlyIncomplete()).toBe(true)
  return registry
}

/** A run dense with the active secret, so a leak cannot pass unnoticed. */
function secretBearingResult(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    output: { report: `PASS ${SECRET}`, nested: { key: SECRET } },
    logs: [{ blockName: 'report', output: SECRET }],
    metadata: { executionId: EXECUTION_ID, duration: 2800 },
    ...extra,
  }
}

function dispatchFailure(): Error {
  const error = new Error(`crashed reading ${SECRET}`)
  // What `executeCopilotRun` does once the run has been handed to the executor.
  attachAttemptedExecutionId(error, EXECUTION_ID)
  return error
}

interface Outcome {
  label: string
  arrange: () => void
  effect: string
  /** Whether the caller may re-issue the call without resolving anything first. */
  safeToRetry: boolean
  succeeded: boolean
}

const OUTCOMES: Outcome[] = [
  {
    label: 'refused before the executor was handed the run',
    arrange: () => mocks.executeWorkflowUseCase.mockRejectedValue(new Error('Access denied')),
    effect: 'not_attempted',
    safeToRetry: true,
    succeeded: false,
  },
  {
    label: 'failed after the executor was handed the run',
    arrange: () => mocks.executeWorkflowUseCase.mockRejectedValue(dispatchFailure()),
    effect: 'attempted',
    safeToRetry: false,
    succeeded: false,
  },
  {
    label: 'cancelled partway',
    arrange: () =>
      mocks.executeWorkflowUseCase.mockResolvedValue(
        secretBearingResult({ success: false, status: 'cancelled' })
      ),
    effect: 'attempted',
    safeToRetry: false,
    succeeded: false,
  },
  {
    label: 'paused partway',
    arrange: () =>
      mocks.executeWorkflowUseCase.mockResolvedValue(
        secretBearingResult({ success: false, status: 'paused' })
      ),
    effect: 'attempted',
    safeToRetry: false,
    succeeded: false,
  },
  {
    label: 'ran and failed',
    arrange: () =>
      mocks.executeWorkflowUseCase.mockResolvedValue(
        secretBearingResult({ success: false, error: `Block failed with ${SECRET}` })
      ),
    effect: 'performed',
    safeToRetry: false,
    succeeded: false,
  },
  {
    label: 'ran and completed',
    arrange: () => mocks.executeWorkflowUseCase.mockResolvedValue(secretBearingResult()),
    effect: 'performed',
    safeToRetry: false,
    succeeded: true,
  },
]

async function withhold(): Promise<ToolExecutionResult> {
  const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
  const projection = inspectToolResultForCopilot(settled, await latchedRegistry(), 'run_workflow')
  expect(projection.safe).toBe(false)
  return projection.result
}

describe('a withheld run_workflow result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeWorkflowUseCase.mockReset()
  })

  it('says nothing was created when the call never reached the use case', async () => {
    const rejected = await executeRunWorkflow({}, { ...context, workflowId: undefined })
    expect(mocks.executeWorkflowUseCase).not.toHaveBeenCalled()

    const { result } = inspectToolResultForCopilot(
      rejected,
      await latchedRegistry(),
      'run_workflow'
    )

    expect(result.output).toEqual({ resultWithheld: true, effect: 'not_attempted' })
    expect(result.error).toContain('nothing was created')
  })

  it.each(OUTCOMES)('discloses a run that was $label', async ({ arrange, effect, succeeded }) => {
    arrange()
    const result = await withhold()

    expect(result.success).toBe(succeeded)
    expect(result.output).toEqual({
      resultWithheld: true,
      effect,
      // An id is present exactly when there is something to resolve.
      ...(effect === 'not_attempted' ? {} : { executionId: EXECUTION_ID }),
    })
  })

  it.each(OUTCOMES)('never leaks run content for a run that was $label', async ({ arrange }) => {
    arrange()
    const serialized = JSON.stringify(await withhold())

    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain('PASS')
    expect(serialized).not.toContain('Block failed')
    expect(serialized).not.toContain('crashed')
  })

  /**
   * The property the disclosure exists for: a caller can decide about retry from the
   * response alone, and can never conclude "nothing happened" about a run that exists.
   */
  it('lets a caller decide retry safety without resolving anything', async () => {
    for (const outcome of OUTCOMES) {
      mocks.executeWorkflowUseCase.mockReset()
      outcome.arrange()
      const output = (await withhold()).output as Record<string, unknown>

      expect(output.effect === 'not_attempted', outcome.label).toBe(outcome.safeToRetry)
      expect(Object.hasOwn(output, 'executionId'), outcome.label).toBe(!outcome.safeToRetry)
    }
  })

  /** The defect this replaced: every one of these arrived as the same sentence. */
  it('distinguishes outcomes that need different decisions', async () => {
    const seen = new Set<string>()
    for (const outcome of OUTCOMES) {
      mocks.executeWorkflowUseCase.mockReset()
      outcome.arrange()
      seen.add(JSON.stringify(await withhold()))
    }
    // Retry, resolve-then-decide, and read-the-result are the three distinct answers.
    expect(seen.size).toBeGreaterThanOrEqual(3)
  })
})
