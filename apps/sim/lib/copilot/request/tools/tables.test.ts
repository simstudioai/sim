/**
 * @vitest-environment node
 */

import { encryptionMock, encryptionMockFns, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockGetTableById, mockReplaceTableRows, mockSpanAddEvent } = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockReplaceTableRows: vi.fn(),
  mockSpanAddEvent: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
}))

vi.mock('@/lib/table/rows/service', () => ({
  replaceTableRows: mockReplaceTableRows,
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

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
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    ...overrides,
  }
}

describe('maybeWriteOutputToTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(buildTable())
    mockReplaceTableRows.mockResolvedValue({ deletedCount: 0, insertedCount: 2 })
  })

  it('rejects a table from another workspace without touching it', async () => {
    mockGetTableById.mockResolvedValue(buildTable({ workspaceId: 'other-workspace' }))

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'Alice' }] } },
      buildContext()
    )

    expect(result).toEqual({ success: false, error: 'Table "tbl_1" not found' })
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
    expect(mockGetTableById).not.toHaveBeenCalled()
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('replaces rows through the service with name keys remapped to column ids', async () => {
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
      buildContext()
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledTimes(1)
    const [data, table] = mockReplaceTableRows.mock.calls[0]
    expect(data).toMatchObject({
      tableId: 'tbl_1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      rows: [
        { col_name: 'Alice', col_age: 30 },
        { col_name: 'Bob', col_age: 40 },
      ],
    })
    expect(table.id).toBe('tbl_1')
  })

  it('persists raw values with per-cell provenance without rewriting sibling literals', async () => {
    const parentRegistry = new ResolvedSecretTraceRegistry(
      [
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
      ],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    parentRegistry.recordResolved('UNRELATED', 'true')
    const toolRegistry = parentRegistry.forkForInputPaths([])
    toolRegistry.recordResolved('OUTPUT_SECRET', 'secret-value', { propagated: true })
    const runtimeRows = [{ name: 'secret-value', age: '123', status: 'true' }]

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: runtimeRows } },
      buildContext({ resolvedSecretTraceRegistry: toolRegistry })
    )

    expect(result.success).toBe(true)
    const persistedWrite = mockReplaceTableRows.mock.calls[0][0]
    const persistedRows = persistedWrite.rows
    expect(persistedRows).toEqual([
      { col_name: 'secret-value', col_age: '123', col_status: 'true' },
    ])
    expect(persistedWrite.secretProvenance).toEqual([
      {
        complete: true,
        columns: {
          col_name: {
            version: 1,
            complete: true,
            entries: [{ name: 'OUTPUT_SECRET', encryptedValue: 'encrypted-output-secret' }],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
          col_age: {
            version: 1,
            complete: true,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
          col_status: {
            version: 1,
            complete: true,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        },
      },
    ])
    expect(runtimeRows).toEqual([{ name: 'secret-value', age: '123', status: 'true' }])

    const modelFacing = projectToolResultForCopilot(
      { success: true, output: { data: { rows: persistedRows } } },
      toolRegistry
    )
    expect(modelFacing.output).toEqual({
      data: {
        rows: [{ col_name: '{{OUTPUT_SECRET}}', col_age: '123', col_status: 'true' }],
      },
    })

    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
    const readRegistry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(
      await readRegistry.importCrossingProvenance(
        persistedWrite.secretProvenance[0].columns.col_name,
        persistedRows,
        { trusted: true }
      )
    ).toBe(true)
    const laterRead = projectToolResultForCopilot(
      { success: true, output: { data: { rows: persistedRows } } },
      readRegistry
    )
    expect(laterRead.output).toEqual({
      data: {
        rows: [{ col_name: '{{OUTPUT_SECRET}}', col_age: '123', col_status: 'true' }],
      },
    })
  })

  it('never rewrites stored public text when an active secret has a common value', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'SHORT_SECRET', plaintext: 'x', encryptedValue: 'encrypted-short-secret' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('SHORT_SECRET', 'x')
    const rows = [{ name: 'Box eSign' }, { name: 'Brex' }, { name: 'hex' }]

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: rows } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows.mock.calls[0][0].rows).toEqual([
      { col_name: 'Box eSign' },
      { col_name: 'Brex' },
      { col_name: 'hex' },
    ])
  })

  it('binds provenance to the values produced by table coercion', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        { name: 'NUMBER_SECRET', plaintext: '123', encryptedValue: 'encrypted-number' },
        { name: 'INVALID_SECRET', plaintext: 'not-a-number', encryptedValue: 'encrypted-invalid' },
      ],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('NUMBER_SECRET', '123')
    registry.recordResolved('INVALID_SECRET', 'not-a-number')

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      {
        success: true,
        output: { result: [{ age: '123' }, { age: 'not-a-number' }] },
      },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows.mock.calls[0][0].secretProvenance).toEqual([
      {
        complete: true,
        columns: {
          col_age: {
            version: 1,
            complete: true,
            entries: [{ name: 'NUMBER_SECRET', encryptedValue: 'encrypted-number' }],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        },
      },
      {
        complete: true,
        columns: {
          col_age: {
            version: 1,
            complete: true,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        },
      },
    ])
  })

  it('accepts same-workspace provenance from a different actor and preserves its source', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'OUTPUT_SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret' }],
      { userId: 'workflow-owner', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('OUTPUT_SECRET', 'secret-value')

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'secret-value' }] } },
      buildContext({ userId: 'billing-actor', resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(
      mockReplaceTableRows.mock.calls[0][0].secretProvenance[0].columns.col_name.scope
    ).toEqual({ userId: 'workflow-owner', workspaceId: 'workspace-1' })
  })

  it('persists raw rows with unknown provenance when the source workspace differs', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'OUTPUT_SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret' }],
      { userId: 'user-1', workspaceId: 'workspace-2' }
    )
    registry.recordResolved('OUTPUT_SECRET', 'secret-value')

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'secret-value' }] } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: [{ complete: false, columns: {} }] }),
      expect.anything(),
      expect.any(String)
    )
  })

  it('persists raw rows with unknown provenance when the source scope is unavailable', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'OUTPUT_SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret' },
    ])
    registry.recordResolved('OUTPUT_SECRET', 'secret-value')

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'secret-value' }] } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: [{ complete: false, columns: {} }] }),
      expect.anything(),
      expect.any(String)
    )
  })

  it('persists raw rows with unknown provenance when lineage is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete()

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'unknown' }] } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: [{ complete: false, columns: {} }] }),
      expect.anything(),
      expect.any(String)
    )
  })

  it('preserves legacy table writes without certifying unavailable provenance', async () => {
    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'unknown' }] } },
      buildContext({ resolvedSecretTraceRegistry: undefined })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [{ col_name: 'unknown' }],
        secretProvenance: [{ complete: false, columns: {} }],
      }),
      expect.anything(),
      expect.any(String)
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
    expect(result.error).toContain('Row 1: name is required')
  })

  it('keeps raw errors for terminal projection but projects application logs and OTel events', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret-value' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('SECRET', 'secret-value', { propagated: true })
    mockReplaceTableRows.mockRejectedValue(new Error('Duplicate value "secret-value"'))

    const result = await maybeWriteOutputToTable(
      FunctionExecute.id,
      { outputTable: 'tbl_1' },
      { success: true, output: { result: [{ name: 'secret-value' }] } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.error).toContain('secret-value')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).toContain('{{SECRET}}')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).not.toContain('secret-value')
    expect(JSON.stringify(mockSpanAddEvent.mock.calls)).toContain('{{SECRET}}')
    expect(JSON.stringify(mockSpanAddEvent.mock.calls)).not.toContain('secret-value')
  })
})

describe('maybeWriteReadCsvToTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(buildTable())
    mockReplaceTableRows.mockResolvedValue({ deletedCount: 0, insertedCount: 2 })
  })

  it('rejects a table from another workspace without touching it', async () => {
    mockGetTableById.mockResolvedValue(buildTable({ workspaceId: 'other-workspace' }))

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age\nAlice,30' } },
      buildContext()
    )

    expect(result).toEqual({ success: false, error: 'Table "tbl_1" not found' })
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
    expect(mockGetTableById).not.toHaveBeenCalled()
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
    const [data] = mockReplaceTableRows.mock.calls[0]
    expect(data.rows).toEqual([
      { col_name: 'Alice', col_age: '30' },
      { col_name: 'Bob', col_age: '40' },
    ])
  })

  it('persists raw CSV cells with per-cell secret provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        { name: 'NUMBER', plaintext: '123', encryptedValue: 'encrypted-number' },
        { name: 'BOOLEAN', plaintext: 'true', encryptedValue: 'encrypted-boolean' },
      ],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
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
        rows: [
          {
            col_name: '123',
            col_status: 'true',
          },
        ],
        secretProvenance: [
          {
            complete: true,
            columns: {
              col_name: {
                version: 1,
                complete: true,
                entries: [{ name: 'NUMBER', encryptedValue: 'encrypted-number' }],
                scope: { userId: 'user-1', workspaceId: 'workspace-1' },
              },
              col_status: {
                version: 1,
                complete: true,
                entries: [],
                scope: { userId: 'user-1', workspaceId: 'workspace-1' },
              },
            },
          },
        ],
      }),
      expect.anything(),
      expect.any(String)
    )
  })

  it('retains original provenance after a quote-escaped CSV round trip', async () => {
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: encryptedValue === 'encrypted-original' ? 'a"b' : '"a""b"',
    }))
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    await expect(
      registry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [
            { name: 'CSV_SECRET', encryptedValue: 'encrypted-original' },
            { name: 'CSV_SECRET', encryptedValue: 'encrypted-representation' },
          ],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
        { trusted: true }
      )
    ).resolves.toBe(true)

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name\n"a""b"' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [{ col_name: 'a"b' }],
        secretProvenance: [
          {
            complete: true,
            columns: {
              col_name: {
                version: 1,
                complete: true,
                entries: [{ name: 'CSV_SECRET', encryptedValue: 'encrypted-original' }],
                scope: { userId: 'user-1', workspaceId: 'workspace-1' },
              },
            },
          },
        ],
      }),
      expect.anything(),
      expect.any(String)
    )
  })

  it('preserves numeric and boolean cells, recording provenance only for the identifying one', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        { name: 'NUMBER', plaintext: '123', encryptedValue: 'encrypted-number' },
        { name: 'BOOLEAN', plaintext: 'true', encryptedValue: 'encrypted-boolean' },
      ],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('NUMBER', '123')
    registry.recordResolved('BOOLEAN', 'true')

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.json' },
      {
        success: true,
        output: { content: '[{"name":"Alice","age":123,"active":true}]' },
      },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [{ col_name: 'Alice', col_age: 123, col_active: true }],
        secretProvenance: [
          expect.objectContaining({
            complete: true,
            columns: expect.objectContaining({
              col_age: expect.objectContaining({
                entries: [{ name: 'NUMBER', encryptedValue: 'encrypted-number' }],
              }),
              col_active: expect.objectContaining({ entries: [] }),
            }),
          }),
        ],
      }),
      expect.anything(),
      expect.any(String)
    )
  })

  it('imports raw CSV rows with unknown provenance when lineage is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete()

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name\nAlice' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: [{ complete: false, columns: {} }] }),
      expect.anything(),
      expect.any(String)
    )
  })

  it('preserves legacy CSV imports without certifying unavailable provenance', async () => {
    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name,age,active\nlegacy-value,123,true' } },
      buildContext({ resolvedSecretTraceRegistry: undefined })
    )

    expect(result.success).toBe(true)
    expect(mockReplaceTableRows).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [{ col_name: 'legacy-value', col_age: '123', col_active: 'true' }],
        secretProvenance: [{ complete: false, columns: {} }],
      }),
      expect.anything(),
      expect.any(String)
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
    expect(result.error).toContain('Row 1: name is required')
  })

  it('projects active secret literals in CSV-import log and OTel errors', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-secret-value' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('SECRET', 'secret-value', { propagated: true })
    mockReplaceTableRows.mockRejectedValue(new Error('Duplicate value "secret-value"'))

    const result = await maybeWriteReadCsvToTable(
      ReadTool.id,
      { outputTable: 'tbl_1', path: 'files/people.csv' },
      { success: true, output: { content: 'name\nsecret-value' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.error).toContain('secret-value')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).toContain('{{SECRET}}')
    expect(JSON.stringify(tableLogger?.warn.mock.calls)).not.toContain('secret-value')
    expect(JSON.stringify(mockSpanAddEvent.mock.calls)).toContain('{{SECRET}}')
    expect(JSON.stringify(mockSpanAddEvent.mock.calls)).not.toContain('secret-value')
  })
})
