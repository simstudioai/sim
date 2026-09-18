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
  mockUpdateColumnCurrency,
  mockUpdateColumnReference,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockRenameColumn: vi.fn(),
  mockUpdateColumnType: vi.fn(),
  mockUpdateColumnOptions: vi.fn(),
  mockUpdateColumnConstraints: vi.fn(),
  mockUpdateColumnCurrency: vi.fn(),
  mockUpdateColumnReference: vi.fn(),
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
  updateColumnReference: mockUpdateColumnReference,
  updateColumnOptions: mockUpdateColumnOptions,
  updateColumnType: mockUpdateColumnType,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { performUpdateTableColumn } from '@/lib/table/orchestration/columns'

const SELECT_COLUMN = {
  id: 'col-1',
  name: 'Status',
  type: 'select' as const,
  options: [{ id: 'opt_open', name: 'Open' }],
}
const TEXT_COLUMN = { id: 'col-2', name: 'Priority', type: 'text' as const }
const REFERENCE_COLUMN = {
  id: 'col-3',
  name: 'Account',
  type: 'reference' as const,
  referenceTableId: 'tbl_accounts',
}

const TABLE = {
  id: 'table-1',
  name: 'Tasks',
  workspaceId: 'ws-1',
  schema: { columns: [SELECT_COLUMN, TEXT_COLUMN, REFERENCE_COLUMN] },
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

function expectNoServiceWrite() {
  expect(mockRenameColumn).not.toHaveBeenCalled()
  expect(mockUpdateColumnType).not.toHaveBeenCalled()
  expect(mockUpdateColumnOptions).not.toHaveBeenCalled()
  expect(mockUpdateColumnConstraints).not.toHaveBeenCalled()
  expect(mockUpdateColumnCurrency).not.toHaveBeenCalled()
  expect(mockUpdateColumnReference).not.toHaveBeenCalled()
}

describe('performUpdateTableColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRenameColumn.mockResolvedValue(UPDATED)
    mockUpdateColumnType.mockResolvedValue(UPDATED)
    mockUpdateColumnOptions.mockResolvedValue(UPDATED)
    mockUpdateColumnConstraints.mockResolvedValue(UPDATED)
    mockUpdateColumnCurrency.mockResolvedValue(UPDATED)
    mockUpdateColumnReference.mockResolvedValue(UPDATED)
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
    // Addressed by stable id so a rename folded into the write can't break it.
    expect(mockUpdateColumnOptions).toHaveBeenCalledWith(
      expect.objectContaining({ columnName: 'col-1' }),
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

  it('runs a rename standalone when there is no write to ride on', async () => {
    mockRenameColumn.mockResolvedValue(UPDATED)

    await run({ name: 'State' })

    expect(mockRenameColumn).toHaveBeenCalledWith(
      { tableId: 'table-1', oldName: 'col-1', newName: 'State' },
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

  it('carries the target through a conversion to reference', async () => {
    await run({ type: 'reference', referenceTableId: 'tbl_accounts' }, 'Priority')

    expect(mockUpdateColumnReference).not.toHaveBeenCalled()
    expect(mockUpdateColumnType).toHaveBeenCalledWith(
      expect.objectContaining({
        newType: 'reference',
        referenceTableId: 'tbl_accounts',
      }),
      'req-1'
    )
  })

  it('routes a target-only reference update through the schema-only service', async () => {
    await run({ referenceTableId: 'tbl_companies' }, 'Account')

    expect(mockUpdateColumnType).not.toHaveBeenCalled()
    expect(mockUpdateColumnReference).toHaveBeenCalledWith(
      expect.objectContaining({
        columnName: 'col-3',
        referenceTableId: 'tbl_companies',
      }),
      'req-1'
    )
  })

  it('folds reference metadata, constraints, and rename into one schema write', async () => {
    await run({ referenceTableId: 'tbl_companies', required: true, name: 'Company' }, 'Account')

    expect(mockRenameColumn).not.toHaveBeenCalled()
    expect(mockUpdateColumnConstraints).not.toHaveBeenCalled()
    expect(mockUpdateColumnReference).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceTableId: 'tbl_companies',
        required: true,
        newName: 'Company',
      }),
      'req-1'
    )
  })

  it('rejects reference metadata when the resulting type is not reference', async () => {
    const result = await run({ referenceTableId: 'tbl_accounts' }, 'Priority')

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockUpdateColumnReference).not.toHaveBeenCalled()
  })

  it('rejects select options when converting a column to reference', async () => {
    const result = await run(
      { type: 'reference', referenceTableId: 'tbl_accounts', options: ['Open'] },
      'Priority'
    )

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expectNoServiceWrite()
  })

  it('rejects select multiple metadata when updating a reference column', async () => {
    const result = await run({ referenceTableId: 'tbl_companies', multiple: true }, 'Account')

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expectNoServiceWrite()
  })

  it('reports an empty payload as a validation failure', async () => {
    const result = await run({})

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.error).toBe('No updates specified')
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("names the type when a payload only restates the column's current type", async () => {
    const result = await run({ type: 'select' })

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.error).toContain('is already type "select"')
    expect(mockUpdateColumnType).not.toHaveBeenCalled()
  })

  it('classifies a table lock as locked and does not audit', async () => {
    mockUpdateColumnConstraints.mockRejectedValue(new TableLockedError('update'))

    const result = await run({ required: true })

    expect(result.errorCode).toBe('locked')
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('reports the code the service failure carries', async () => {
    mockUpdateColumnConstraints.mockRejectedValue(
      new OrchestrationError('validation', 'Column "State" already exists')
    )

    expect((await run({ required: true })).errorCode).toBe('validation')
  })

  it('classifies a missing column as not_found', async () => {
    mockUpdateColumnConstraints.mockRejectedValue(
      new OrchestrationError('not_found', 'Column "Nope" not found')
    )

    expect((await run({ required: true })).errorCode).toBe('not_found')
  })

  it('keeps an unclassified fault internal and hides its message', async () => {
    // Wording alone must never buy a status: this reads exactly like the
    // caller-fixable failure above but carries no classification.
    mockUpdateColumnConstraints.mockRejectedValue(new Error('Column "State" already exists'))

    const result = await run({ required: true })

    expect(result.errorCode).toBe('internal')
    expect(result.error).toBe('Failed to update column')
  })

  it('audits a successful update on every caller', async () => {
    // The UI route and the copilot tool previously emitted no audit at all.
    await run({ required: true })

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', actorId: 'user-1', resourceId: 'table-1' })
    )
  })
})
