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

import {
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
} from '@/lib/mothership/tools/handlers/workflow/mutations'

const EXECUTION_ID = '0f4d5a4c-6a1e-4c2f-9b7d-2c8f1a3e5d90'
const SECRET = 'fake-secret-for-test-only'

/** The handler and the projection share the call's registry, as the tool executor wires them. */
function callContext(registry: ResolvedSecretTraceRegistry) {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    toolCallId: 'tool-call-1',
    resolvedSecretTraceRegistry: registry,
  } as ExecutionContext
}

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

/** A configured secret; `active` records that the run resolved it into its result. */
function secretRegistry({ active = true } = {}) {
  const registry = new ResolvedSecretTraceRegistry([
    { name: 'API_KEY', plaintext: SECRET, encryptedValue: 'ciphertext' },
  ])
  if (active) registry.recordResolved('API_KEY', SECRET, { propagated: true })
  return registry
}

/** Row-shaped output of about 27.5k values: past the log budget, under the projection's cap. */
function wideRows() {
  return Array.from({ length: 2_500 }, (_, index) =>
    Object.fromEntries(Array.from({ length: 10 }, (_, column) => [`c${column}`, `r${index}`]))
  )
}

describe('run_workflow model-facing result budget', () => {
  let registry: ResolvedSecretTraceRegistry
  let context: ExecutionContext

  beforeEach(() => {
    mocks.executeWorkflowUseCase.mockReset()
    registry = secretRegistry()
    context = callContext(registry)
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
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

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
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

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
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

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
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

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

  /** run_workflow_until_block lifts the stopping block's output into `output`; that copy is bounded too. */
  it('bounds a lifted terminal block output instead of withholding the run', async () => {
    const narrow = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `r${index}`, data: { a: 'x', b: 'y' } }))
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      logs: [
        { blockId: 'start', blockName: 'Start', success: true, output: { ok: true } },
        { blockId: 'query', blockName: 'Query', success: true, output: { rows: narrow(25_000) } },
      ],
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflowUntilBlock(
      { workflowId: 'wf-1', stopAfterBlockId: 'query' },
      context
    )
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

    expect(projection.safe).toBe(true)
    const output = projection.result.output as Record<string, unknown>
    expect(output.output).toEqual(expect.stringContaining(`logs get ${EXECUTION_ID} --trace`))
    expect(output.outputFrom).toEqual({ blockId: 'query', blockName: 'Query' })
    expect(output.stoppedAfterBlockId).toBe('query')
  })

  /** The truncation marker is written before secret projection, so it must not carry a length. */
  it('marks a truncated block input without disclosing its length', async () => {
    async function inputFor(secret: string) {
      mocks.executeWorkflowUseCase.mockResolvedValue({
        success: true,
        output: { done: true },
        logs: [
          {
            blockId: 'fn',
            blockName: 'Function',
            success: true,
            input: { code: `${'a'.repeat(300)}${secret}${'b'.repeat(3_000)}` },
            output: { ok: true },
          },
        ],
        metadata: { executionId: EXECUTION_ID },
      })
      const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
      return (settled.output as { logs: Array<{ input: { code: string } }> }).logs[0]?.input.code
    }

    const short = await inputFor('short-secret-1')
    const long = await inputFor('a-considerably-longer-secret-value-for-the-same-slot')
    expect(short).toEqual(expect.stringContaining(`logs get ${EXECUTION_ID} --trace`))
    expect(long).toBe(short)
  })

  /** The projection refuses content past its depth limit however few values it holds. */
  it('replaces a block output nested past the projection depth limit', async () => {
    let deep: Record<string, unknown> = { leaf: true }
    for (let level = 0; level < 150; level += 1) deep = { next: deep }
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: { done: true },
      logs: [
        { blockId: 'small', blockName: 'Small', success: true, output: { ok: true } },
        { blockId: 'deep', blockName: 'Deep', success: true, output: deep },
      ],
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

    expect(projection.safe).toBe(true)
    const logs = (projection.result.output as { logs: Array<Record<string, unknown>> }).logs
    expect(logs[0]?.output).toEqual({ ok: true })
    expect(logs[1]?.output).toEqual(expect.stringContaining(`logs get ${EXECUTION_ID} --trace`))
  })

  /** A cut through a secret leaves a fragment no whole-literal redaction can match. */
  it('never exposes part of a secret that straddles an input truncation point', async () => {
    const straddling = `${'a'.repeat(190)}${SECRET}${'b'.repeat(3_000)}`
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: { done: true },
      logs: [
        {
          blockId: 'fn',
          blockName: 'Function',
          success: true,
          input: { code: straddling, note: straddling },
          output: { ok: true },
        },
      ],
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

    expect(projection.safe).toBe(true)
    const serialized = JSON.stringify(projection.result)
    expect(serialized).toContain(`logs get ${EXECUTION_ID} --trace`)
    for (let length = 4; length <= SECRET.length; length += 1) {
      expect(serialized).not.toContain(SECRET.slice(0, length))
    }
  })

  /**
   * Without an active secret the projection passes JSON through under its byte cap alone, so
   * nothing is bounded: a lifted output is the whole point of run_block and reaches the worker in
   * full, which spills an oversized one to storage for the model to read.
   */
  it('returns a large lifted output and its logs in full when no secret is active', async () => {
    const rows = wideRows()
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      logs: [
        { blockId: 'start', blockName: 'Start', success: true, output: { ok: true } },
        { blockId: 'query', blockName: 'Query', success: true, output: { rows } },
      ],
      metadata: { executionId: EXECUTION_ID },
    })
    const inactive = secretRegistry({ active: false })

    const settled = await executeRunWorkflowUntilBlock(
      { workflowId: 'wf-1', stopAfterBlockId: 'query' },
      callContext(inactive)
    )
    const projection = inspectToolResultForCopilot(settled, inactive, 'run_workflow')

    expect(projection.safe).toBe(true)
    const output = projection.result.output as Record<string, unknown>
    expect(output.output).toEqual({ rows })
    expect((output.logs as Array<Record<string, unknown>>)[1]?.output).toEqual({ rows })
  })

  /** A lifted output is the run's final output, so it keeps the final output's larger share. */
  it('returns a lifted output within the final share in full while a secret is active', async () => {
    const rows = wideRows()
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      logs: [{ blockId: 'query', blockName: 'Query', success: true, output: { rows } }],
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflowUntilBlock(
      { workflowId: 'wf-1', stopAfterBlockId: 'query' },
      context
    )
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

    expect(projection.safe).toBe(true)
    const output = projection.result.output as Record<string, unknown>
    expect(output.output).toEqual({ rows })
    // Its log copy is still bounded, so the two together stay under the projection's caps.
    expect((output.logs as Array<Record<string, unknown>>)[0]?.output).toEqual(
      expect.stringContaining(`logs get ${EXECUTION_ID} --trace`)
    )
  })

  /** A Response block's output is the final output too, so it is replaced rather than voiding the run. */
  it('replaces a final output past the projection cap instead of withholding the run', async () => {
    const narrow = Array.from({ length: 25_000 }, (_, index) => ({
      id: `r${index}`,
      data: { a: 'x' },
    }))
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: { rows: narrow },
      logs: [{ blockId: 'small', blockName: 'Small', success: true, output: { ok: true } }],
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflow({ workflowId: 'wf-1' }, context)
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

    expect(projection.safe).toBe(true)
    const output = projection.result.output as Record<string, unknown>
    expect(output.output).toEqual(expect.stringContaining(`logs get ${EXECUTION_ID} --trace`))
    expect((output.logs as Array<Record<string, unknown>>)[0]?.output).toEqual({ ok: true })
  })

  /**
   * Each part can sit just inside its own share while the whole result, envelope included, passes
   * the projection's value cap, so the result is measured whole.
   */
  it('replaces the final output when the whole result passes the cap at the share limits', async () => {
    // Five values per row, two for the wrapping object and array.
    const rows = (values: number) =>
      Array.from({ length: Math.floor((values - 2) / 5) }, (_, index) => ({
        id: `r${index}`,
        data: { a: 'x', b: 'y' },
      }))
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      logs: [
        { blockId: 'other', blockName: 'Other', success: true, output: { rows: rows(25_000) } },
        { blockId: 'query', blockName: 'Query', success: true, output: { rows: rows(75_000) } },
      ],
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflowUntilBlock(
      { workflowId: 'wf-1', stopAfterBlockId: 'query' },
      context
    )
    const projection = inspectToolResultForCopilot(settled, registry, 'run_workflow')

    expect(projection.safe).toBe(true)
    const output = projection.result.output as Record<string, unknown>
    expect(output.output).toEqual(expect.stringContaining(`logs get ${EXECUTION_ID} --trace`))
    expect(output.outputFrom).toEqual({ blockId: 'query', blockName: 'Query' })
  })

  /**
   * The bound only handles size. An output JSON cannot encode cannot be checked, so the run is still
   * refused rather than the value being hidden behind a pointer.
   */
  it('still refuses a run with an unencodable block output while bounding bulky ones', async () => {
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      logs: [
        {
          blockId: 'big',
          blockName: 'Big',
          success: true,
          output: { rows: tableRows(4_800, 3_200_000) },
        },
        { blockId: 'odd', blockName: 'Odd', success: true, output: { count: 1n } },
      ],
      metadata: { executionId: EXECUTION_ID },
    })

    const settled = await executeRunWorkflowUntilBlock(
      { workflowId: 'wf-1', stopAfterBlockId: 'odd' },
      context
    )
    const presented = settled.output as { output: unknown; logs: Array<{ output: unknown }> }
    expect(presented.output).toEqual({ count: 1n })
    expect(presented.logs[1]?.output).toEqual({ count: 1n })
    expect(inspectToolResultForCopilot(settled, registry, 'run_workflow').safe).toBe(false)
  })
})
