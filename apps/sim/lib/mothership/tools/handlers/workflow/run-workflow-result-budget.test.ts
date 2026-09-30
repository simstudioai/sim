/**
 * A run_workflow result sized like the production refusals: thirteen table-query blocks,
 * ~11.5k rows, ~9.7 MiB. That is under the 16 MiB byte cap, yet with one active secret the
 * projection walked ~138k values against its 100k traversal cap and withheld the whole result,
 * leaving the model a bare success. The model-facing result is now bounded before it reaches
 * the projection, and the omitted block outputs stay reachable through the run's archived trace.
 */

import { executeWorkflowMock } from '@sim/testing/mocks/execute-workflow.mock'
import {
  largeValueMetadataMock,
  largeValueMetadataMockFns,
} from '@sim/testing/mocks/large-value-metadata.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { workflowsOrchestrationMock } from '@sim/testing/mocks/workflows-orchestration.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import {
  externalizeExecutionData,
  materializeExecutionData,
} from '@/lib/logs/execution/trace-store'
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
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/execution/payloads/large-value-metadata', () => largeValueMetadataMock)

import { executeRunWorkflow } from '@/lib/mothership/tools/handlers/workflow/mutations'

const EXECUTION_ID = '0f4d5a4c-6a1e-4c2f-9b7d-2c8f1a3e5d90'
const SECRET = 'fake-secret-for-test-only'
const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  toolCallId: 'tool-call-1',
} as ExecutionContext

/** Row counts and stored bytes of the table queries in one production refusal. */
const TABLE_QUERIES: ReadonlyArray<readonly [rows: number, bytes: number]> = [
  [32, 9_513],
  [2, 2_590],
  [1_848, 2_079_072],
  [2_533, 1_698_688],
  [4_833, 3_179_855],
  [1_294, 1_517_841],
  [32, 5_563],
  [11, 3_246],
  [835, 721_833],
  [33, 52_482],
  [28, 8_274],
  [13, 9_669],
  [33, 293_266],
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
    const finalOutput = { summary: `report for ${SECRET}`, rowCount: 11_529 }
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
    expect(output.output).toEqual({ summary: 'report for {{API_KEY}}', rowCount: 11_529 })
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
    const finalOutput = { rows: tableRows(4_833, 3_179_855) }
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

  it('keeps every omitted block output reachable through the pointer', async () => {
    const logs = traceShapedLogs()
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      logs,
      metadata: { executionId: EXECUTION_ID },
    })
    const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    const presented = (settled.output as { logs: Array<Record<string, unknown>> }).logs
    const omitted = presented.filter((log) => typeof log.output === 'string')
    expect(omitted.length).toBeGreaterThan(0)

    // `logs get <id> --trace` reads the run's archived execution data; archive and read it back.
    storageServiceMockFns.mockUploadFile.mockImplementation(async ({ customKey, file }) => {
      storageServiceMockFns.mockDownloadFile.mockResolvedValue(file)
      return { key: customKey }
    })
    largeValueMetadataMockFns.mockRegisterLargeValueOwner.mockResolvedValue(true)
    clearLargeValueCacheForTests()
    const archiveContext = {
      workspaceId: 'workspace-1',
      workflowId: 'wf-1',
      executionId: EXECUTION_ID,
      userId: 'user-1',
    }
    const slim = await externalizeExecutionData(
      {
        traceSpans: logs.map((log) => ({
          id: log.blockId,
          name: log.blockName,
          output: log.output,
        })),
      },
      archiveContext,
      { throwOnError: true }
    )
    clearLargeValueCacheForTests()
    const archived = (await materializeExecutionData(slim, archiveContext)) as {
      traceSpans: Array<{ name: string; output: unknown }>
    }

    for (const log of omitted) {
      const original = logs.find((entry) => entry.blockName === log.blockName)
      expect(archived.traceSpans.find((span) => span.name === log.blockName)?.output).toEqual(
        original?.output
      )
    }
  })
})
