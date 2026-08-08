/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  presentV2CreateTableImport,
  presentV2TableExport,
  presentV2TableImport,
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
