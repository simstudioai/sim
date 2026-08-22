/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import type { TableSchema, WorkflowGroup } from '@/lib/table/types'
import {
  presentV2CreateTableImport,
  presentV2TableExport,
  presentV2TableImport,
  presentV2WorkflowGroup,
} from '@/app/api/v2/tables/presenters'

const createdAt = new Date('2026-08-01T00:00:00.000Z')
const importRecord = {
  id: 'import-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  source: { type: 'workspace_file' as const, fileId: 'file-1' },
  target: { type: 'new' as const, name: 'People' },
  options: {},
  tableId: 'table-1',
  status: 'running' as const,
  rowsProcessed: 2,
  error: null,
  createdAt,
  updatedAt: createdAt,
  completedAt: null,
}
const exportRecord = {
  id: 'export-1',
  tableId: 'table-1',
  workspaceId: 'workspace-1',
  type: 'export',
  status: 'running',
  payload: { format: 'csv' as const },
  rowsProcessed: 0,
  error: null,
  startedAt: createdAt,
  updatedAt: createdAt,
  completedAt: null,
}

describe('v2 table presenters', () => {
  it('converts domain import records at the v2 boundary', () => {
    expect(presentV2CreateTableImport({ record: importRecord, upload: null })).toEqual({
      data: {
        session: {
          id: 'import-1',
          workspaceId: 'workspace-1',
          status: 'processing',
          source: importRecord.source,
          target: importRecord.target,
          tableId: 'table-1',
          rowsProcessed: 2,
          error: null,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          completedAt: null,
        },
        uploadToken: null,
        transfer: null,
      },
    })
    expect(presentV2TableImport(importRecord).data.createdAt).toBe(createdAt.toISOString())
  })

  it('converts domain export records and preserves queued create presentation', () => {
    expect(presentV2TableExport(exportRecord, true)).toEqual({
      data: {
        id: 'export-1',
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        format: 'csv',
        status: 'queued',
        rowsProcessed: 0,
        error: null,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        completedAt: null,
      },
    })
  })
})

/**
 * A group is created with column **names** and was read back with stored column
 * **ids** under the same `columnName` field, on a surface every other row/data
 * endpoint keys by name. The value could not be round-tripped into another
 * create, and named nothing the caller could see elsewhere.
 */
describe('presentV2WorkflowGroup', () => {
  const schema: TableSchema = {
    columns: [
      { id: 'col_score', name: 'score', type: 'number' },
      { id: 'col_input', name: 'website', type: 'string' },
    ],
  }

  const stored = {
    id: 'group-1',
    workflowId: 'workflow-1',
    outputs: [{ blockId: 'block-1', path: 'result', columnName: 'col_score' }],
    dependencies: { columns: ['col_input'] },
    inputMappings: [{ inputName: 'url', columnName: 'col_input' }],
  } as WorkflowGroup

  it('presents every column reference as the column name', () => {
    const presented = presentV2WorkflowGroup(stored, schema)

    expect(presented.outputs[0].columnName).toBe('score')
    expect(presented.dependencies?.columns).toEqual(['website'])
    expect(presented.inputMappings?.[0].columnName).toBe('website')
  })

  it('leaves the stored group untouched', () => {
    presentV2WorkflowGroup(stored, schema)
    expect(stored.outputs[0].columnName).toBe('col_score')
  })

  it('passes a reference naming no current column through unchanged', () => {
    const orphaned = {
      ...stored,
      outputs: [{ blockId: 'block-1', path: 'result', columnName: 'col_deleted' }],
    } as WorkflowGroup

    expect(presentV2WorkflowGroup(orphaned, schema).outputs[0].columnName).toBe('col_deleted')
  })

  it('leaves a legacy name-keyed group alone', () => {
    const legacy = {
      ...stored,
      outputs: [{ blockId: 'block-1', path: 'result', columnName: 'score' }],
      dependencies: undefined,
      inputMappings: undefined,
    } as unknown as WorkflowGroup

    expect(presentV2WorkflowGroup(legacy, schema).outputs[0].columnName).toBe('score')
  })
})
