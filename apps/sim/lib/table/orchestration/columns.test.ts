/**
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
  mockUpdateColumnCurrency,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockRenameColumn: vi.fn(),
  mockUpdateColumnType: vi.fn(),
  mockUpdateColumnOptions: vi.fn(),
  mockUpdateColumnConstraints: vi.fn(),
  mockUpdateColumnCurrency: vi.fn(),
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
  updateColumnCurrency: mockUpdateColumnCurrency,
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
    mockRenameColumn.mockResolvedValue(UPDATED)
    mockUpdateColumnType.mockResolvedValue(UPDATED)
    mockUpdateColumnOptions.mockResolvedValue(UPDATED)
    mockUpdateColumnConstraints.mockResolvedValue(UPDATED)
    mockUpdateColumnCurrency.mockResolvedValue(UPDATED)
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

  it('reuses the id of an option resent by name so its cells survive', async () => {
    await run({ options: ['Open', 'Blocked'] })

    const [{ options }] = mockUpdateColumnOptions.mock.calls[0]
    expect(options[0]).toEqual({ id: 'opt_open', name: 'Open' })
    expect(options[1].id).not.toBe('opt_open')
  })

  it('folds a rename into the write it rides on rather than running it separately', async () => {
    // A rename is metadata-only, so folding it into the last write's transaction
    // is what stops a combined request committing one half and failing the other.
    await run({ name: 'State', required: true })

    expect(mockRenameColumn).not.toHaveBeenCalled()
    expect(mockUpdateColumnConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ columnName: 'col-1', newName: 'State' }),
      'req-1'
    )
  })

  it('rejects setting a currency code on a non-currency column', async () => {
    const result = await run({ currencyCode: 'USD' })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockUpdateColumnCurrency).not.toHaveBeenCalled()
  })

  it('rejects an unsupported currency code before any write', async () => {
    const result = await run({ type: 'currency', currencyCode: 'XX' }, 'Priority')

    expect(result.errorCode).toBe('validation')
    expect(mockUpdateColumnType).not.toHaveBeenCalled()
  })

  it('classifies a table lock as locked and does not audit', async () => {
    mockUpdateColumnConstraints.mockRejectedValue(new TableLockedError('update'))

    const result = await run({ required: true })

    expect(result.errorCode).toBe('locked')
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('keeps an unclassified fault internal and hides its message', async () => {
    // Wording alone must never buy a status: this reads exactly like the
    // caller-fixable failure above but carries no classification.
    mockUpdateColumnConstraints.mockRejectedValue(new Error('Column "State" already exists'))

    const result = await run({ required: true })

    expect(result.errorCode).toBe('internal')
    expect(result.error).toBe('Failed to update column')
  })
})
