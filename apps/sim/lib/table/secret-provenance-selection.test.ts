/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { selectTableRowSecretProvenance } from '@/lib/table/secret-provenance-selection'
import {
  EMPTY_NON_SECRET_NAMES,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
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
    const selections = selectTableRowSecretProvenance([
      { email: 'user@example.com', status: null, processed_at: undefined },
      { email: 'other@example.com', processed_at: '2026-08-06T10:00:00.000Z' },
    ])

    expect(selections).toEqual([
      { key: '[0,"email"]', value: 'user@example.com' },
      { key: '[0,"status"]', value: null },
      { key: '[1,"email"]', value: 'other@example.com' },
      { key: '[1,"processed_at"]', value: '2026-08-06T10:00:00.000Z' },
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
      new ResolvedSecretTraceRegistry(
        [],
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
        EMPTY_NON_SECRET_NAMES
      )
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
