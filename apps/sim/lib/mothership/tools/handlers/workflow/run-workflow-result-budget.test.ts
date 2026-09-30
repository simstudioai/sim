/**
 * A synthetic trace-shaped run_workflow result: about a dozen table-query blocks whose outputs
 * exceed the projection's 100k-value traversal cap while staying under its byte cap. With one
 * active secret the projection refused the whole result, leaving the model a bare success. The
 * model-facing result is now bounded before it reaches the projection.
 */
import { executeWorkflowMock } from '@sim/testing/mocks/execute-workflow.mock'
import { telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { workflowsOrchestrationMock } from '@sim/testing/mocks/workflows-orchestration.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import type { ExecutionContext } from '@/lib/mothership/request/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mocks } = vi.hoisted(() => ({ mocks: { executeWorkflowUseCase: vi.fn() } }))

vi.mock('@/lib/mothership/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: mocks.executeWorkflowUseCase,
  messageForCopilotWorkflowError: (error: unknown, fallback = 'Workflow operation failed') =>
    getErrorMessage(error, fallback),
}))
vi.mock('@/lib/workflows/sanitization/json-sanitizer', () => ({
  sanitizeForCopilot: vi.fn((state) => state),
}))
vi.mock('@/lib/workflows/executor/execute-workflow', () => executeWorkflowMock)
vi.mock('@/lib/execution/cancel-workflow-execution', () => ({
  cancelWorkflowExecution: vi.fn(),
  WorkflowExecutionNotFoundError: class WorkflowExecutionNotFoundError extends Error {},
}))
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/core/telemetry', () => telemetryMock)

import { executeRunWorkflow } from '@/lib/mothership/tools/handlers/workflow/mutations'

const EXECUTION_ID = '0f4d5a4c-6a1e-4c2f-9b7d-2c8f1a3e5d90'
const SECRET = 'fake-secret-for-test-only'
const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  toolCallId: 'tool-call-1',
} as ExecutionContext

/** Rows and approximate encoded bytes per block of a synthetic trace-shaped run. */
const TABLE_QUERIES: ReadonlyArray<readonly [rows: number, bytes: number]> = [
  [30, 10_000],
  [2, 3_000],
  [1_850, 2_100_000],
  [2_500, 1_700_000],
  [4_800, 3_200_000],
  [1_300, 1_500_000],
  [30, 6_000],
  [10, 3_000],
  [850, 700_000],
  [30, 50_000],
  [30, 8_000],
  [10, 10_000],
  [30, 300_000],
]

function tableRows(count: number, bytes: number) {
  const columns = 8
  const width = Math.max(1, Math.floor(bytes / count / columns) - 12)
  return Array.from({ length: count }, (_, index) => ({
    id: `row_${index}`,
    data: Object.fromEntries(
      Array.from({ length: columns }, (_, column) => [`col_${column}`, 'x'.repeat(width)])
    ),
    createdAt: '2026-09-24T00:00:00.000Z',
  }))
}

function traceShapedLogs() {
  return TABLE_QUERIES.map(([rows, bytes], index) => {
    const result = tableRows(rows, bytes)
    return {
      blockId: `query-${index}`,
      blockName: `Query ${index}`,
      success: true,
      output: { rows: result, rowCount: result.length },
    }
  })
}

function secretRegistry() {
  const registry = new ResolvedSecretTraceRegistry([
    { name: 'API_KEY', plaintext: SECRET, encryptedValue: 'ciphertext' },
  ])
  registry.recordResolved('API_KEY', SECRET, { propagated: true })
  return registry
}

describe('run_workflow model-facing result budget', () => {
  beforeEach(() => {
    mocks.executeWorkflowUseCase.mockReset()
  })

  it('projects a trace-shaped result with an active secret instead of withholding it', async () => {
    const logs = traceShapedLogs()
    const finalOutput = { summary: `report for ${SECRET}`, rowCount: 11_500 }
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: false,
      error: `Report block failed after reading ${SECRET}`,
      output: finalOutput,
      logs,
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    const projection = inspectToolResultForCopilot(settled, secretRegistry(), 'run_workflow')

    expect(projection.safe).toBe(true)
    const output = projection.result.output as Record<string, unknown>
    expect(output.executionId).toBe(EXECUTION_ID)
    expect(output.success).toBe(false)
    expect(output.output).toEqual({ summary: 'report for {{API_KEY}}', rowCount: 11_500 })
    expect(projection.result.error).toBe('Report block failed after reading {{API_KEY}}')
    const presented = output.logs as Array<Record<string, unknown>>
    expect(presented.map((log) => log.blockName)).toEqual(logs.map((log) => log.blockName))
    const omitted = presented.filter((log) => typeof log.output === 'string')
    expect(omitted.length).toBeGreaterThan(0)
    for (const log of omitted) {
      expect(log.output).toContain(`logs get ${EXECUTION_ID} --trace`)
    }
    // Small outputs still arrive in full; only the bulky ones are replaced.
    expect(presented.find((log) => log.blockName === 'Query 1')?.output).toEqual(logs[1].output)
  })

  /** The final output is what the run was for, so it is never compacted and needs the headroom. */
  it('leaves room for a large final output beside the bounded logs', async () => {
    const finalOutput = { rows: tableRows(4_800, 3_200_000) }
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: finalOutput,
      logs: traceShapedLogs(),
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    const projection = inspectToolResultForCopilot(settled, secretRegistry(), 'run_workflow')

    expect(projection.safe).toBe(true)
    expect((projection.result.output as Record<string, unknown>).output).toEqual(finalOutput)
  })

  /** Narrow rows reach the traversal cap while staying far under every byte budget. */
  it('bounds narrow row outputs by value count alone', async () => {
    const logs = Array.from({ length: 6 }, (_, index) => ({
      blockId: `narrow-${index}`,
      blockName: `Narrow ${index}`,
      success: true,
      output: { rows: tableRows(2_500, 2_500 * 8 * 13) },
    }))
    const finalOutput = { rows: tableRows(2_000, 2_000 * 8 * 13) }
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: finalOutput,
      logs,
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    expect(Buffer.byteLength(JSON.stringify(settled.output))).toBeLessThan(4 * 1024 * 1024)
    const projection = inspectToolResultForCopilot(settled, secretRegistry(), 'run_workflow')

    expect(projection.safe).toBe(true)
    expect((projection.result.output as Record<string, unknown>).output).toEqual(finalOutput)
  })

  it('returns selected values in full, bypassing the log budget', async () => {
    const logs = traceShapedLogs()
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      logs,
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflow(
      { workflowId: 'wf-1', select: ['Query 4.rows'] },
      context
    )
    const projection = inspectToolResultForCopilot(settled, secretRegistry(), 'run_workflow')

    expect(projection.safe).toBe(true)
    const output = projection.result.output as Record<string, unknown>
    expect(output.logsOmitted).toBe(true)
    expect(output.selected).toEqual({ 'Query 4.rows': logs[4].output.rows })
  })

  /** The pointer is written before secret projection, so it must not vary with a secret's length. */
  it('reports nothing about an omitted output that depends on secret length', async () => {
    async function pointerFor(secret: string) {
      mocks.executeWorkflowUseCase.mockResolvedValue({
        success: true,
        output: {},
        logs: [
          {
            blockId: 'query',
            blockName: 'Query',
            success: true,
            output: { rows: tableRows(4_800, 3_200_000), token: secret },
          },
        ],
        metadata: { executionId: EXECUTION_ID },
      })
      const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
      return (settled.output as { logs: Array<{ output: unknown }> }).logs[0]?.output
    }

    const short = await pointerFor('short-secret-1')
    const long = await pointerFor('a-considerably-longer-secret-value-for-the-same-slot')
    expect(short).toEqual(expect.stringContaining(`logs get ${EXECUTION_ID} --trace`))
    expect(long).toBe(short)
  })
})
