/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const mocks = vi.hoisted(() => ({
  executeReplace: vi.fn(),
  spanAddEvent: vi.fn(),
}))

vi.mock('@/lib/copilot/application/table-commands', () => ({
  executeCopilotReplaceProjectedWireRows: mocks.executeReplace,
}))
vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotSpan: (
    _name: string,
    _attrs: Record<string, unknown> | undefined,
    run: (span: unknown) => Promise<unknown>
  ) =>
    run({
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      addEvent: mocks.spanAddEvent,
    }),
}))
vi.mock('@/lib/table/application/rows', () => ({
  ProjectedWireRowsValidationError: class ProjectedWireRowsValidationError extends Error {},
}))

import { Read as ReadTool, RunFunction } from '@/lib/copilot/generated/tool-catalog-v1'
import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import {
  maybeWriteOutputToTable,
  maybeWriteReadCsvToTable,
} from '@/lib/copilot/request/tools/tables'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import { ProjectedWireRowsValidationError } from '@/lib/table/application/rows'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' }] },
  metadata: null,
  rowCount: 0,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}

const tableLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi
    .mocked(loggerMock.createLogger)
    .mock.calls.findIndex(([name]) => name === 'CopilotToolResultTables')
]?.value

function buildContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    userId: 'user-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    userPermission: 'write',
    copilotToolExecution: true,
    toolCallId: 'tool-call-1',
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    ...overrides,
  }
}

describe('automatic Copilot tool-output table persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeReplace.mockImplementation(
      async (_context: ExecutionContext, input: { sourceRows: unknown[] }) => ({
        table,
        deletedCount: 0,
        insertedCount: input.sourceRows.length,
      })
    )
  })

  it('maps tool rows into one authorized schema-locked replacement command', async () => {
    const context = buildContext()
    const rows = [
      { name: 'Ada', age: 30 },
      { name: 'Grace', age: 40 },
    ]

    const result = await maybeWriteOutputToTable(
      RunFunction.id,
      { outputTable: 'table-1' },
      { success: true, output: { result: rows } },
      context
    )

    expect(result).toEqual({
      success: true,
      output: {
        message: 'Wrote 2 rows to table table-1',
        tableId: 'table-1',
        rowCount: 2,
      },
    })
    expect(mocks.executeReplace).toHaveBeenCalledTimes(1)
    expect(mocks.executeReplace).toHaveBeenCalledWith(context, {
      tableId: 'table-1',
      assertedWorkspaceId: 'workspace-1',
      sourceRows: rows,
      projectedRows: rows,
      secretProvenance: {
        mode: 'resolved_output',
        registry: context.resolvedSecretTraceRegistry,
      },
    })
  })

  it('hands raw rows and their trace registry to the authorized application command', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'OUTPUT_SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret' },
    ])
    registry.recordResolved('OUTPUT_SECRET', 'secret-value')
    const runtimeRows = [{ name: 'secret-value', status: 'literal' }]

    const result = await maybeWriteOutputToTable(
      RunFunction.id,
      { outputTable: 'table-1' },
      { success: true, output: { result: runtimeRows } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mocks.executeReplace).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceRows: runtimeRows,
        projectedRows: runtimeRows,
        secretProvenance: { mode: 'resolved_output', registry },
      })
    )
    expect(runtimeRows).toEqual([{ name: 'secret-value', status: 'literal' }])

    const projectedRows = mocks.executeReplace.mock.calls[0][1].projectedRows
    const laterRead = projectToolResultForCopilot(
      { success: true, output: { data: { rows: projectedRows } } },
      new ResolvedSecretTraceRegistry()
    )
    expect(laterRead.output).toEqual({ data: { rows: projectedRows } })
  })

  it('delegates unavailable provenance handling to the application command', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('unspecified')

    await maybeWriteOutputToTable(
      RunFunction.id,
      { outputTable: 'table-1' },
      { success: true, output: { result: [{ name: 'unknown' }] } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(mocks.executeReplace).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        secretProvenance: { mode: 'resolved_output', registry },
      })
    )
  })

  it('preserves typed application validation for a correctable tool error', async () => {
    mocks.executeReplace.mockRejectedValueOnce(
      new ProjectedWireRowsValidationError('Row 1 has no keys matching table columns')
    )

    const result = await maybeWriteOutputToTable(
      RunFunction.id,
      { outputTable: 'table-1' },
      { success: true, output: { result: [{ wrong: true }] } },
      buildContext()
    )

    expect(result).toEqual({
      success: false,
      error: 'Row 1 has no keys matching table columns',
    })
  })

  it('conceals unknown application failures in results, logs, and trace events', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret' },
    ])
    registry.recordResolved('SECRET', 'secret-value')
    mocks.executeReplace.mockRejectedValueOnce(new Error('database duplicate: secret-value'))

    const result = await maybeWriteOutputToTable(
      RunFunction.id,
      { outputTable: 'table-1' },
      { success: true, output: { result: [{ name: 'secret-value' }] } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result).toEqual({
      success: false,
      error: 'Failed to write to table: Table operation failed',
    })
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).toContain('Table operation failed')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).not.toContain('secret-value')
    expect(JSON.stringify(mocks.spanAddEvent.mock.calls)).toContain('Table operation failed')
    expect(JSON.stringify(mocks.spanAddEvent.mock.calls)).not.toContain('secret-value')
  })

  it('rejects read-only Copilot execution before any application command', async () => {
    const result = await maybeWriteOutputToTable(
      RunFunction.id,
      { outputTable: 'table-1' },
      { success: true, output: { result: [{ name: 'Ada' }] } },
      buildContext({ userPermission: 'read' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires write access')
    expect(mocks.executeReplace).not.toHaveBeenCalled()
  })

  it('fails closed when the authoritative inserted count is inconsistent', async () => {
    mocks.executeReplace.mockResolvedValueOnce({ table, deletedCount: 1, insertedCount: 1 })

    const result = await maybeWriteOutputToTable(
      RunFunction.id,
      { outputTable: 'table-1' },
      { success: true, output: { result: [{ name: 'Ada' }, { name: 'Grace' }] } },
      buildContext()
    )

    expect(result).toEqual({
      success: false,
      error: 'Failed to write to table: Table operation failed',
    })
  })
})

describe('automatic Copilot file-read table persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeReplace.mockImplementation(
      async (_context: ExecutionContext, input: { sourceRows: unknown[] }) => ({
        table,
        deletedCount: 1,
        insertedCount: input.sourceRows.length,
      })
    )
  })

  it('keeps CSV parsing and presentation in the adapter and performs one application command', async () => {
    const context = buildContext()
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'table-1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age\nAda,30\nGrace,40' } },
      context
    )

    expect(result).toEqual({
      success: true,
      output: {
        message: 'Imported 2 rows from "files/people.csv" into table "People"',
        tableId: 'table-1',
        tableName: 'People',
        rowCount: 2,
      },
    })
    expect(mocks.executeReplace).toHaveBeenCalledTimes(1)
    expect(mocks.executeReplace).toHaveBeenCalledWith(context, {
      tableId: 'table-1',
      assertedWorkspaceId: 'workspace-1',
      sourceRows: [
        { name: 'Ada', age: '30' },
        { name: 'Grace', age: '40' },
      ],
      projectedRows: [
        { name: 'Ada', age: '30' },
        { name: 'Grace', age: '40' },
      ],
      secretProvenance: {
        mode: 'resolved_output',
        registry: context.resolvedSecretTraceRegistry,
      },
    })
  })

  it('keeps JSON shape validation in the adapter', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'table-1', path: 'files/people.json' },
      { success: true, output: { content: '{"name":"Ada"}' } },
      buildContext()
    )

    expect(result).toEqual({
      success: false,
      error: 'JSON file must contain an array of objects for table import',
    })
    expect(mocks.executeReplace).not.toHaveBeenCalled()
  })

  it('preserves safe unknown-error projection for CSV persistence', async () => {
    mocks.executeReplace.mockRejectedValueOnce(new Error('database unavailable'))

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'table-1', path: 'files/people.csv' },
      { success: true, output: { content: 'name\nAda' } },
      buildContext()
    )

    expect(result).toEqual({
      success: false,
      error: 'Failed to import into table: Table operation failed',
    })
  })
})
