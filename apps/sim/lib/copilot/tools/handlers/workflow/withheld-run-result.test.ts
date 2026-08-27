/**
 * @vitest-environment node
 *
 * Pins what a caller can learn about a workflow run whose result the secret-egress
 * boundary withholds.
 *
 * The registry here is latched the way production latches it — a child run that handed
 * back no provenance envelope — rather than by asserting an "unsafe" flag, so the test
 * fails for the same reason the incident did. Three outcomes that need opposite retry
 * decisions are driven through the real handler and the real projection: a call rejected
 * on its arguments, a call that threw after dispatch, and a run that completed. All three
 * used to arrive as the same sentence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import { attachAttemptedExecutionId } from '@/executor/utils/errors'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mocks } = vi.hoisted(() => ({
  mocks: { executeWorkflowUseCase: vi.fn() },
}))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: mocks.executeWorkflowUseCase,
  /** Passthrough, so a masked message is visible as masking rather than as a fallback. */
  messageForCopilotWorkflowError: (error: unknown, fallback = 'Workflow operation failed') =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock('@/lib/workflows/sanitization/json-sanitizer', () => ({
  sanitizeForCopilot: vi.fn((state) => state),
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { apiKeyGenerated: vi.fn() },
}))

import { executeRunWorkflow } from '@/lib/copilot/tools/handlers/workflow/mutations'

const EXECUTION_ID = '0f4d5a4c-6a1e-4c2f-9b7d-2c8f1a3e5d90'
const SECRET = 'sk-live-9Qv2XbTn4LmZa8Rd'

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

async function withheld(result: ToolExecutionResult) {
  const registry = await latchedRegistry()
  const projection = inspectToolResultForCopilot(result, registry, 'run_workflow')
  expect(projection.safe).toBe(false)
  return projection
}

function modelOutput(result: ToolExecutionResult): Record<string, unknown> {
  expect(result.output).toBeTypeOf('object')
  return result.output as Record<string, unknown>
}

describe('a withheld run_workflow result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('says nothing was created when the call never reached dispatch', async () => {
    const rejected = await executeRunWorkflow({}, { ...context, workflowId: undefined })
    expect(mocks.executeWorkflowUseCase).not.toHaveBeenCalled()

    const { result } = await withheld(rejected)

    expect(result.success).toBe(false)
    expect(modelOutput(result)).toEqual({ resultWithheld: true, effect: 'not_attempted' })
    expect(result.error).toContain('nothing was created')
  })

  it('names the run to resolve when the call threw after dispatch', async () => {
    const error = new Error(`Execution crashed reading ${SECRET}`)
    attachAttemptedExecutionId(error, EXECUTION_ID)
    mocks.executeWorkflowUseCase.mockRejectedValue(error)

    const failed = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    const { result } = await withheld(failed)

    expect(result.success).toBe(false)
    expect(modelOutput(result)).toEqual({
      resultWithheld: true,
      effect: 'attempted',
      executionId: EXECUTION_ID,
    })
    expect(result.error).toContain('At most one run exists')
  })

  it('names the run to read when it completed', async () => {
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: { report: `PASS ${SECRET}` },
      logs: [{ blockName: 'report', output: SECRET }],
      metadata: { executionId: EXECUTION_ID, duration: 2800 },
    })

    const completed = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    const { result } = await withheld(completed)

    expect(result.success).toBe(true)
    expect(modelOutput(result)).toEqual({
      resultWithheld: true,
      effect: 'performed',
      executionId: EXECUTION_ID,
    })
  })

  /** The defect itself: these three needed opposite retry decisions and read identically. */
  it('distinguishes the three outcomes from one another', async () => {
    const rejected = await executeRunWorkflow({}, { ...context, workflowId: undefined })

    const thrown = new Error('boom')
    attachAttemptedExecutionId(thrown, EXECUTION_ID)
    mocks.executeWorkflowUseCase.mockRejectedValue(thrown)
    const failed = await executeRunWorkflow({ workflowId: 'wf-1' }, context)

    mocks.executeWorkflowUseCase.mockReset()
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      metadata: { executionId: EXECUTION_ID, duration: 1 },
    })
    const completed = await executeRunWorkflow({ workflowId: 'wf-1' }, context)

    const views = await Promise.all(
      [rejected, failed, completed].map(async (r) => JSON.stringify((await withheld(r)).result))
    )

    expect(new Set(views).size).toBe(3)
    expect(views[0]).not.toContain(EXECUTION_ID)
    expect(views[1]).toContain(EXECUTION_ID)
    expect(views[2]).toContain(EXECUTION_ID)
  })

  it('never lets the withheld payload carry the run content past the boundary', async () => {
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: false,
      output: { report: `FAIL ${SECRET}` },
      logs: [{ output: SECRET }],
      error: `Block failed with ${SECRET}`,
      metadata: { executionId: EXECUTION_ID, duration: 10 },
    })

    const { result } = await withheld(await executeRunWorkflow({ workflowId: 'wf-1' }, context))

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain('FAIL')
    expect(serialized).not.toContain('Block failed')
  })
})
