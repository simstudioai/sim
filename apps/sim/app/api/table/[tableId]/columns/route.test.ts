/**
 * @vitest-environment node
 *
 * The PATCH handler performs several writes, each in its own locked
 * transaction. `renameColumn` is the first, so any rejection raised after it
 * returns an error with the rename already committed — a partial update the
 * caller cannot see or undo. These pin the pre-flight guards ahead of it.
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckAccess,
  mockRenameColumn,
  mockUpdateColumnType,
  mockUpdateColumnCurrency,
  mockUpdateColumnOptions,
  mockUpdateColumnConstraints,
  mockAddTableColumn,
  mockDeleteColumn,
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockRenameColumn: vi.fn(),
  mockUpdateColumnType: vi.fn(),
  mockUpdateColumnCurrency: vi.fn(),
  mockUpdateColumnOptions: vi.fn(),
  mockUpdateColumnConstraints: vi.fn(),
  mockAddTableColumn: vi.fn(),
  mockDeleteColumn: vi.fn(),
}))

vi.mock('@/lib/table', () => ({
  addTableColumn: mockAddTableColumn,
  deleteColumn: mockDeleteColumn,
  renameColumn: mockRenameColumn,
  updateColumnConstraints: mockUpdateColumnConstraints,
  updateColumnCurrency: mockUpdateColumnCurrency,
  updateColumnOptions: mockUpdateColumnOptions,
  updateColumnType: mockUpdateColumnType,
}))
vi.mock('@/app/api/table/utils', () => ({
  accessError: () => new Response('denied', { status: 403 }),
  checkAccess: mockCheckAccess,
  normalizeColumn: (c: unknown) => c,
  rootErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  tableLockErrorResponse: () => null,
}))

import { PATCH } from '@/app/api/table/[tableId]/columns/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

function patch(updates: Record<string, unknown>) {
  return PATCH(
    new NextRequest('http://localhost/api/table/t1/columns', {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, columnName: 'amount', updates }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ tableId: 't1' }) }
  )
}

describe('PATCH /api/table/[tableId]/columns — pre-flight guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: { columns: [{ id: 'col_a', name: 'amount', type: 'number' }] },
      },
    })
    mockRenameColumn.mockResolvedValue({ schema: { columns: [] } })
  })

  it('rejects a currency code on a non-currency column without renaming first', async () => {
    const response = await patch({ name: 'renamed', currencyCode: 'USD' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Cannot set currency'),
    })
    // The whole point: the rename must not have been committed.
    expect(mockRenameColumn).not.toHaveBeenCalled()
    expect(mockUpdateColumnCurrency).not.toHaveBeenCalled()
  })

  it('rejects an unsupported currency code without renaming first', async () => {
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: { columns: [{ id: 'col_a', name: 'amount', type: 'currency' }] },
      },
    })

    const response = await patch({ name: 'renamed', currencyCode: 'ZZZ' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Invalid currency code'),
    })
    expect(mockRenameColumn).not.toHaveBeenCalled()
  })

  it('rejects unique on a type that cannot carry it without renaming first', async () => {
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: {
          columns: [
            { id: 'col_a', name: 'amount', type: 'select', options: [{ id: 'o', name: 'O' }] },
          ],
        },
      },
    })

    const response = await patch({ name: 'renamed', unique: true })

    expect(response.status).toBe(400)
    expect(mockRenameColumn).not.toHaveBeenCalled()
  })

  it('still performs a valid combined rename + currency change', async () => {
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: { columns: [{ id: 'col_a', name: 'amount', type: 'currency' }] },
      },
    })
    mockUpdateColumnCurrency.mockResolvedValue({ schema: { columns: [] } })

    const response = await patch({ name: 'renamed', currencyCode: 'eur' })

    expect(response.status).toBe(200)
    expect(mockRenameColumn).toHaveBeenCalledTimes(1)
    expect(mockUpdateColumnCurrency).toHaveBeenCalledWith(
      // The contract upper-cases on the way in, and the rename means the
      // currency write must target the NEW name.
      expect.objectContaining({ columnName: 'renamed', currencyCode: 'EUR' }),
      expect.any(String)
    )
  })
})
