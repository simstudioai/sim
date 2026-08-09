/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockExecuteCopilotTableUseCase, mockReadTable, mockReplaceTableRows, mockSpanAddEvent } =
  vi.hoisted(() => ({
    mockExecuteCopilotTableUseCase: vi.fn(
      (_context: unknown, useCase: { execute: (args: unknown) => unknown }, input: unknown) =>
        useCase.execute({ input })
    ),
    mockReadTable: vi.fn(),
    mockReplaceTableRows: vi.fn(),
    mockSpanAddEvent: vi.fn(),
  }))

vi.mock('@/lib/copilot/application/execute-table-use-case', () => ({
  executeCopilotTableUseCase: mockExecuteCopilotTableUseCase,
}))

vi.mock('@/lib/table/application/tables', () => ({
  readTableUseCase: { execute: mockReadTable },
}))

vi.mock('@/lib/table/application/rows', () => ({
  replaceTableRows: { execute: mockReplaceTableRows },
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotSpan: (
    _name: string,
    _attrs: Record<string, unknown> | undefined,
    fn: (span: unknown) => Promise<unknown>
  ) => fn({ setAttribute: vi.fn(), setAttributes: vi.fn(), addEvent: mockSpanAddEvent }),
}))

import { FunctionExecute, Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import {
  maybeWriteOutputToTable,
  maybeWriteReadCsvToTable,
} from '@/lib/copilot/request/tools/tables'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const tableLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi
    .mocked(loggerMock.createLogger)
    .mock.calls.findIndex(([name]) => name === 'CopilotToolResultTables')
]?.value

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: {
      columns: [
        { id: 'col_name', name: 'name', type: 'string' },
        { id: 'col_age', name: 'age', type: 'number' },
        { id: 'col_status', name: 'status', type: 'string' },
        { id: 'col_active', name: 'active', type: 'boolean' },
        { id: 'col_metadata', name: 'metadata', type: 'json' },
      ],
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    locks: { schemaLocked: false, insertLocked: false, updateLocked: false, deleteLocked: false },
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  } as TableDefinition
}

function buildContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    userId: 'user-1',
    workflowId: 'wf-1',
    workspaceId: 'workspace-1',
    userPermission: 'write',
    copilotToolExecution: true,
    toolCallId: 'tool-call-1',
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    ...overrides,
  }
}

describe('maybeWriteOutputToTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadTable.mockResolvedValue({ table: buildTable(), folderPath: '/' })
    mockReplaceTableRows.mockImplementation(async ({ input }: { input: { rows: unknown[] } }) => ({
      deletedCount: 0,
      insertedCount: input.rows.length,
    }))
  })

  it('rejects a table from another workspace without touching it', async () => {
    mockReadTable.mockRejectedValue(new Error('Table not found'))

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'Alice' }] } },
      buildContext()
    )

    expect(result).toEqual({
      success: false,
      error: 'Failed to write to table: Table operation failed',
    })
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('denies a read-only principal without touching the table', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'Alice' }] } },
      buildContext({ userPermission: 'read' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires write access')
    expect(mockReadTable).not.toHaveBeenCalled()
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('replaces rows through the service with name keys remapped to column ids', async () => {
    const context = buildContext()
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      {
        success: true,
        output: {
          result: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 40 },
          ],
        },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(mockExecuteCopilotTableUseCase).toHaveBeenNthCalledWith(
      1,
      context,
      expect.objectContaining({ execute: mockReadTable }),
      { tableId: 'tbl_1', workspaceId: 'workspace-1' }
    )
    expect(mockExecuteCopilotTableUseCase).toHaveBeenNthCalledWith(
      2,
      context,
      expect.objectContaining({ execute: mockReplaceTableRows }),
      expect.objectContaining({
        tableId: 'tbl_1',
        assertedWorkspaceId: 'workspace-1',
      })
    )
    expect(mockReplaceTableRows).toHaveBeenCalledTimes(1)
    const [{ input }] = mockReplaceTableRows.mock.calls[0]
    expect(input).toMatchObject({
      tableId: 'tbl_1',
      assertedWorkspaceId: 'workspace-1',
      rows: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 40 },
      ],
    })
  })

  it('projects activated secrets before persistence without rewriting sibling literals', async () => {
    const parentRegistry = new ResolvedSecretTraceRegistry([
      {
        name: 'OUTPUT_SECRET',
        plaintext: 'secret-value',
        encryptedValue: 'encrypted-output-secret',
      },
      {
        name: 'UNRELATED',
        plaintext: 'true',
        encryptedValue: 'encrypted-unrelated',
      },
    ])
    parentRegistry.recordResolved('UNRELATED', 'true')
    const toolRegistry = parentRegistry.forkForToolInput({ code: 'return {{OUTPUT_SECRET}}' })
    toolRegistry.recordResolved('OUTPUT_SECRET', 'secret-value')
    const runtimeRows = [{ name: 'secret-value', age: '123', status: 'true' }]

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: runtimeRows } },
      buildContext({ resolvedSecretTraceRegistry: toolRegistry })
    )

    expect(result.success).toBe(true)
    const persistedRows = mockReplaceTableRows.mock.calls[0][0].input.rows
    expect(persistedRows).toEqual([{ name: '{{OUTPUT_SECRET}}', age: '123', status: 'true' }])
    expect(runtimeRows).toEqual([{ name: 'secret-value', age: '123', status: 'true' }])

    const modelFacing = projectToolResultForCopilot(
      { success: true, output: { data: { rows: persistedRows } } },
      toolRegistry
    )
    expect(modelFacing.output).toEqual({
      data: {
        rows: [{ name: '{{OUTPUT_SECRET}}', age: '123', status: 'true' }],
      },
    })

    const laterRead = projectToolResultForCopilot(
      { success: true, output: { data: { rows: persistedRows } } },
      new ResolvedSecretTraceRegistry()
    )
    expect(laterRead.output).toEqual({ data: { rows: persistedRows } })
  })

  it('does not write when table persistence provenance is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete()

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'unknown' }] } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result).toEqual({
      success: false,
      error: 'Tool output could not be persisted safely because secret provenance was unavailable.',
    })
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('preserves legacy table writes when execution provenance is unavailable', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'unknown' }] } },
      buildContext({ resolvedSecretTraceRegistry: undefined })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ rows: [{ name: 'unknown' }] }) })
    )
  })

  it('fails fast when no row keys match the table columns', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ wrong: 1 }, { keys: 2 }] } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Row 1 has no keys matching columns')
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('fails fast when only some rows match instead of writing empty rows', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'Alice' }, { wrong: 'x' }] } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Row 2 has no keys matching columns')
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('surfaces service validation failures as tool errors', async () => {
    mockReplaceTableRows.mockRejectedValue(new Error('Row 1: name is required'))

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ age: 30 }] } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Table operation failed')
  })

  it('fails fast when authoritative inserted count differs from the requested rows', async () => {
    mockReplaceTableRows.mockResolvedValue({ deletedCount: 1, insertedCount: 1 })

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'Alice' }, { name: 'Bob' }] } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Table operation failed')
  })

  it('keeps raw errors for terminal projection but projects application logs and OTel events', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret-value' },
    ])
    registry.recordResolved('SECRET', 'secret-value')
    mockReplaceTableRows.mockRejectedValue(new Error('Duplicate value "secret-value"'))

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'secret-value' }] } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.error).not.toContain('secret-value')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).toContain('Table operation failed')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).not.toContain('secret-value')
    expect(JSON.stringify(mockSpanAddEvent.mock.calls)).toContain('Table operation failed')
    expect(JSON.stringify(mockSpanAddEvent.mock.calls)).not.toContain('secret-value')
  })
})

describe('maybeWriteReadCsvToTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadTable.mockResolvedValue({ table: buildTable(), folderPath: '/' })
    mockReplaceTableRows.mockImplementation(async ({ input }: { input: { rows: unknown[] } }) => ({
      deletedCount: 0,
      insertedCount: input.rows.length,
    }))
  })

  it('rejects a table from another workspace without touching it', async () => {
    mockReadTable.mockRejectedValue(new Error('Table not found'))

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age\nAlice,30' } },
      buildContext()
    )

    expect(result).toEqual({
      success: false,
      error: 'Failed to import into table: Table operation failed',
    })
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('denies a read-only principal without touching the table', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age\nAlice,30' } },
      buildContext({ userPermission: 'read' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires write access')
    expect(mockReadTable).not.toHaveBeenCalled()
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('imports CSV content through the service with id-keyed rows', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age\nAlice,30\nBob,40' } },
      buildContext()
    )

    expect(result.success).toBe(true)
    const [{ input }] = mockReplaceTableRows.mock.calls[0]
    expect(input.rows).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '40' },
    ])
  })

  it('projects active secret literals into string-compatible CSV columns', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'NUMBER', plaintext: '123', encryptedValue: 'encrypted-number' },
      { name: 'BOOLEAN', plaintext: 'true', encryptedValue: 'encrypted-boolean' },
    ])
    registry.recordResolved('NUMBER', '123')
    registry.recordResolved('BOOLEAN', 'true')

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,status\n123,true' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          rows: [
            {
              name: '{{NUMBER}}',
              status: '{{BOOLEAN}}',
            },
          ],
        }),
      })
    )
  })

  it('rejects active secret literals in number and boolean columns before mutation', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'NUMBER', plaintext: '123', encryptedValue: 'encrypted-number' },
      { name: 'BOOLEAN', plaintext: 'true', encryptedValue: 'encrypted-boolean' },
    ])
    registry.recordResolved('NUMBER', '123')
    registry.recordResolved('BOOLEAN', 'true')

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age,active\nAlice,123,true' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result).toEqual({
      success: false,
      error:
        'Tool output could not be persisted safely because a resolved secret is incompatible with the target column type.',
    })
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('123')
    expect(JSON.stringify(result)).not.toContain('true')
  })

  it('does not import CSV rows when persistence provenance is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete()

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name\nAlice' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result).toEqual({
      success: false,
      error: 'Tool output could not be persisted safely because secret provenance was unavailable.',
    })
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('preserves legacy CSV imports when execution provenance is unavailable', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age,active\nlegacy-value,123,true' } },
      buildContext({ resolvedSecretTraceRegistry: undefined })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          rows: [{ name: 'legacy-value', age: '123', active: 'true' }],
        }),
      })
    )
  })

  it('fails fast when the file headers match no table columns', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'wrong,headers\n1,2' } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Row 1 has no keys matching columns')
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('surfaces service validation failures as tool errors', async () => {
    mockReplaceTableRows.mockRejectedValue(new Error('Row 1: name is required'))

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'age\n30' } },
      buildContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Table operation failed')
  })

  it('projects active secret literals in CSV-import log and OTel errors', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret-value' },
    ])
    registry.recordResolved('SECRET', 'secret-value')
    mockReplaceTableRows.mockRejectedValue(new Error('Duplicate value "secret-value"'))

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name\nsecret-value' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.error).not.toContain('secret-value')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).toContain('Table operation failed')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).not.toContain('secret-value')
    expect(JSON.stringify(mockSpanAddEvent.mock.calls)).toContain('Table operation failed')
    expect(JSON.stringify(mockSpanAddEvent.mock.calls)).not.toContain('secret-value')
  })
})
