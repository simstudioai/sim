/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { selectTableRowSecretProvenance } from '@/lib/table/secret-provenance-selection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { prepareToolRequest } from '@/tools/request-transport'
import { tableBatchInsertRowsTool } from '@/tools/table/batch_insert_rows'

interface TableWriteRequestBody {
  rows: Record<string, unknown>[]
  [PRIVATE_SECRET_PROVENANCE_FIELD]: {
    selections: Array<{ key: string }>
  }
}

describe('selectTableRowSecretProvenance', () => {
  it('omits undefined properties that JSON object serialization drops', () => {
    const selections = selectTableRowSecretProvenance(
      [
        { email: 'user@example.com', status: null, processed_at: undefined },
        { email: 'other@example.com', processed_at: '2026-08-06T10:00:00.000Z' },
      ],
      'rows'
    )

    expect(selections).toEqual([
      { key: '[0,"email"]', inputPaths: [['rows', '0', 'email']] },
      { key: '[0,"status"]', inputPaths: [['rows', '0', 'status']] },
      { key: '[1,"email"]', inputPaths: [['rows', '1', 'email']] },
      { key: '[1,"processed_at"]', inputPaths: [['rows', '1', 'processed_at']] },
    ])
  })

  it('keeps selection keys aligned with the serialized request body', () => {
    const request = prepareToolRequest(
      tableBatchInsertRowsTool,
      {
        tableId: 'table-1',
        rows: [{ email: 'user@example.com', status: 'queued', processed_at: undefined }],
        _context: { workspaceId: 'workspace-1' },
      },
      new ResolvedSecretTraceRegistry([], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    )
    const body = JSON.parse(request.body ?? '') as TableWriteRequestBody
    const wireSelectionKeys = body.rows.flatMap((row, rowIndex) =>
      Object.keys(row).map((columnKey) => JSON.stringify([rowIndex, columnKey]))
    )

    expect(body.rows).toEqual([{ email: 'user@example.com', status: 'queued' }])
    expect(
      body[PRIVATE_SECRET_PROVENANCE_FIELD].selections.map((selection) => selection.key)
    ).toEqual(wireSelectionKeys)
  })
})
