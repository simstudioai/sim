/**
 * @vitest-environment node
 *
 * The column-update guards. These used to live in four callers (UI route, v1,
 * v2, copilot tool) and had drifted apart; they are asserted here once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const {
  mockRenameColumn,
  mockUpdateColumnType,
  mockUpdateColumnOptions,
  mockUpdateColumnConstraints,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockRenameColumn: vi.fn(),
  mockUpdateColumnType: vi.fn(),
  mockUpdateColumnOptions: vi.fn(),
  mockUpdateColumnConstraints: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_UPDATED: 'table.updated' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/table/columns/service', () => ({
  renameColumn: mockRenameColumn,
  updateColumnConstraints: mockUpdateColumnConstraints,
  updateColumnOptions: mockUpdateColumnOptions,
  updateColumnType: mockUpdateColumnType,
}))

import { TableLockedError } from '@/lib/table/mutation-locks'
import { performUpdateTableColumn } from '@/lib/table/orchestration/columns'

const SELECT_COLUMN = {
  id: 'col-1',
  name: 'Status',
  type: 'select' as const,
  options: [{ id: 'opt_open', name: 'Open' }],
}
const TEXT_COLUMN = { id: 'col-2', name: 'Priority', type: 'text' as const }

const TABLE = {
  id: 'table-1',
  name: 'Tasks',
  workspaceId: 'ws-1',
  schema: { columns: [SELECT_COLUMN, TEXT_COLUMN] },
} as unknown as TableDefinition

const UPDATED = { schema: { columns: [SELECT_COLUMN] } } as unknown as TableDefinition

function run(updates: Record<string, unknown>, columnName = 'Status') {
  return performUpdateTableColumn({
    table: TABLE,
    columnName,
    userId: 'user-1',
    updates,
    requestId: 'req-1',
  })
}

describe('performUpdateTableColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRenameColumn.mockResolvedValue(UPDATED)
    mockUpdateColumnType.mockResolvedValue(UPDATED)
    mockUpdateColumnOptions.mockResolvedValue(UPDATED)
    mockUpdateColumnConstraints.mockResolvedValue(UPDATED)
  })

  it('refuses to make a select column unique before writing anything', async () => {
    // Each write is its own locked transaction, so an un-gated constraint write
    // commits the earlier writes and then throws, half-applying the change.
    const result = await run({ unique: true })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockUpdateColumnConstraints).not.toHaveBeenCalled()
  })

  it('refuses a conversion to select that is also made unique', async () => {
    const result = await run({ type: 'select', options: ['Done'], unique: true }, 'Priority')

    expect(result.errorCode).toBe('validation')
    expect(mockUpdateColumnType).not.toHaveBeenCalled()
  })

  it('routes an unchanged type with options to the options update', async () => {
    // updateColumnType early-returns on an unchanged type and would drop them.
    await run({ type: 'select', options: ['Open', 'Closed'] })

    expect(mockUpdateColumnType).not.toHaveBeenCalled()
    expect(mockUpdateColumnOptions).toHaveBeenCalledWith(
      expect.objectContaining({ columnName: 'Status' }),
      'req-1'
    )
  })

  it('reuses the id of an option resent by name so its cells survive', async () => {
    await run({ options: ['Open', 'Blocked'] })

    const [{ options }] = mockUpdateColumnOptions.mock.calls[0]
    expect(options[0]).toEqual({ id: 'opt_open', name: 'Open' })
    expect(options[1].id).not.toBe('opt_open')
  })

  it('carries options and required through a real type change', async () => {
    await run({ type: 'select', options: ['Done'], required: true }, 'Priority')

    expect(mockUpdateColumnOptions).not.toHaveBeenCalled()
    expect(mockUpdateColumnType).toHaveBeenCalledWith(
      expect.objectContaining({ newType: 'select', required: true }),
      'req-1'
    )
  })

  it('applies a rename before the later writes and targets the new name', async () => {
    await run({ name: 'State', required: true })

    expect(mockRenameColumn).toHaveBeenCalledWith(
      { tableId: 'table-1', oldName: 'Status', newName: 'State' },
      'req-1'
    )
    expect(mockUpdateColumnConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ columnName: 'State' }),
      'req-1'
    )
  })

  it('rejects an options edit on a column that is not a select', async () => {
    const result = await run({ multiple: true }, 'Priority')

    expect(result.errorCode).toBe('validation')
    expect(mockUpdateColumnOptions).not.toHaveBeenCalled()
  })

  it('reports an empty payload as a validation failure', async () => {
    const result = await run({})

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('classifies a table lock as locked and does not audit', async () => {
    mockUpdateColumnConstraints.mockRejectedValue(new TableLockedError('update'))

    const result = await run({ required: true })

    expect(result.errorCode).toBe('locked')
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('classifies a caller-fixable service error as validation', async () => {
    mockUpdateColumnConstraints.mockRejectedValue(new Error('Column "State" already exists'))

    expect((await run({ required: true })).errorCode).toBe('validation')
  })

  it('classifies a missing column as not_found', async () => {
    mockUpdateColumnConstraints.mockRejectedValue(new Error('Column "Nope" not found'))

    expect((await run({ required: true })).errorCode).toBe('not_found')
  })

  it('audits a successful update on every caller', async () => {
    // The UI route and the copilot tool previously emitted no audit at all.
    await run({ required: true })

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', actorId: 'user-1', resourceId: 'table-1' })
    )
  })
})
