/**
 * @vitest-environment node
 *
 * The PATCH handler performs several writes, each in its own locked
 * transaction, so one that fails leaves the earlier ones committed. Two things
 * keep that from producing a partial update the caller cannot see or undo: the
 * guards reject the knowable cases before any write, and the rename — the only
 * write that is purely cosmetic — goes LAST, so a failed typed write leaves the
 * column entirely untouched. These pin both.
 */
import { hybridAuthMockFns } from '@sim/testing'
import { getErrorMessage } from '@sim/utils/errors'
import { NextRequest, NextResponse } from 'next/server'
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
vi.mock('@/lib/table/columns/service', () => ({
  renameColumn: mockRenameColumn,
  updateColumnConstraints: mockUpdateColumnConstraints,
  updateColumnCurrency: mockUpdateColumnCurrency,
  updateColumnOptions: mockUpdateColumnOptions,
  updateColumnType: mockUpdateColumnType,
}))
vi.mock('@/lib/table/wire', () => ({
  normalizeColumn: (c: unknown) => c,
}))
vi.mock('@/app/api/table/utils', () => ({
  accessError: () => new Response('denied', { status: 403 }),
  checkAccess: mockCheckAccess,
  orchestrationOutcomeErrorResponse: (
    outcome: { error?: string; errorCode?: OrchestrationErrorCode },
    fallback: string
  ) =>
    NextResponse.json(
      { error: messageForOrchestrationError(outcome, fallback) },
      { status: statusForOrchestrationError(outcome.errorCode) }
    ),
  rootErrorMessage: (e: unknown) => getErrorMessage(e),
  tableLockErrorResponse: () => null,
}))

import {
  messageForOrchestrationError,
  OrchestrationError,
  type OrchestrationErrorCode,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
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

  it('still applies a rename when the currency it rides on is unchanged', async () => {
    // `updateColumnCurrency` no-ops on an unchanged code. The rename folded into
    // the same request must not be dropped with it.
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: {
          columns: [{ id: 'col_a', name: 'amount', type: 'currency', currencyCode: 'USD' }],
        },
      },
    })
    mockUpdateColumnCurrency.mockResolvedValue({ schema: { columns: [] } })

    const response = await patch({ name: 'renamed', currencyCode: 'USD' })

    expect(response.status).toBe(200)
    expect(mockUpdateColumnCurrency).toHaveBeenCalledWith(
      expect.objectContaining({ currencyCode: 'USD', newName: 'renamed' }),
      expect.any(String)
    )
  })

  it('renames standalone when there is no other write to ride on', async () => {
    mockRenameColumn.mockResolvedValue({ schema: { columns: [] } })

    const response = await patch({ name: 'renamed' })

    expect(response.status).toBe(200)
    expect(mockRenameColumn).toHaveBeenCalledWith(
      expect.objectContaining({ oldName: 'col_a', newName: 'renamed' }),
      expect.any(String)
    )
  })

  it('leaves the column untouched when a typed write fails', async () => {
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: { columns: [{ id: 'col_a', name: 'amount', type: 'currency' }] },
      },
    })
    // Stands in for the race the guards cannot close: the column stopped being
    // a currency between the snapshot the guards read and this write.
    mockUpdateColumnCurrency.mockRejectedValue(
      new OrchestrationError(
        'validation',
        'Cannot set currency on column "amount" of type "string"'
      )
    )

    const response = await patch({ name: 'renamed', currencyCode: 'USD' })

    expect(response.status).toBe(400)
    expect(mockRenameColumn).not.toHaveBeenCalled()
  })

  it('rejects a name already taken before any write runs', async () => {
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: {
          columns: [
            { id: 'col_a', name: 'amount', type: 'currency' },
            { id: 'col_b', name: 'taken', type: 'string' },
          ],
        },
      },
    })

    const response = await patch({ name: 'taken', currencyCode: 'EUR' })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('already exists'),
    })
    // The typed write would otherwise have committed under a rename that fails.
    expect(mockUpdateColumnCurrency).not.toHaveBeenCalled()
    expect(mockRenameColumn).not.toHaveBeenCalled()
  })

  it('forwards unique to the retype so it validates post-conversion values', async () => {
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: { columns: [{ id: 'col_a', name: 'amount', type: 'string' }] },
      },
    })
    mockUpdateColumnType.mockResolvedValue({ schema: { columns: [] } })
    mockUpdateColumnConstraints.mockResolvedValue({ schema: { columns: [] } })

    const response = await patch({ type: 'number', unique: true })

    expect(response.status).toBe(200)
    // The conversion itself can manufacture duplicates ("5" and "5.0" both
    // coerce to 5), so the retype has to see `unique` — discovering it in the
    // separate constraint write would report an error with the conversion
    // already committed and the original text irrecoverably rewritten.
    expect(mockUpdateColumnType).toHaveBeenCalledWith(
      expect.objectContaining({ newType: 'number', unique: true }),
      expect.any(String)
    )
  })

  it('applies a rename, retype and constraints in a single write', async () => {
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: { columns: [{ id: 'col_a', name: 'amount', type: 'string' }] },
      },
    })
    mockUpdateColumnType.mockResolvedValue({ schema: { columns: [] } })

    const response = await patch({ name: 'total', type: 'number', required: true, unique: true })

    expect(response.status).toBe(200)
    // One transaction for the whole request: no separate rename, no separate
    // constraint write, so no half of it can commit without the others.
    expect(mockRenameColumn).not.toHaveBeenCalled()
    expect(mockUpdateColumnConstraints).not.toHaveBeenCalled()
    expect(mockUpdateColumnType).toHaveBeenCalledTimes(1)
    expect(mockUpdateColumnType).toHaveBeenCalledWith(
      expect.objectContaining({
        newType: 'number',
        required: true,
        unique: true,
        newName: 'total',
      }),
      expect.any(String)
    )
  })

  it('still runs the constraint write when the type is unchanged', async () => {
    mockUpdateColumnConstraints.mockResolvedValue({ schema: { columns: [] } })

    const response = await patch({ required: true })

    expect(response.status).toBe(200)
    expect(mockUpdateColumnConstraints).toHaveBeenCalledTimes(1)
    expect(mockUpdateColumnType).not.toHaveBeenCalled()
  })

  it('rejects constraint changes on a workflow-output column before any write', async () => {
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        workspaceId: WORKSPACE_ID,
        schema: {
          columns: [{ id: 'col_a', name: 'amount', type: 'number', workflowGroupId: 'g1' }],
        },
      },
    })

    const response = await patch({ type: 'string', required: true })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('workflow-output column'),
    })
    expect(mockUpdateColumnType).not.toHaveBeenCalled()
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

  it('folds a rename into the typed write instead of running it separately', async () => {
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
    // One transaction, not two: the rename rides along with the currency write,
    // so neither half can commit without the other.
    expect(mockRenameColumn).not.toHaveBeenCalled()
    expect(mockUpdateColumnCurrency).toHaveBeenCalledWith(
      // Addressed by stable id; the contract upper-cases the code on the way in.
      expect.objectContaining({ columnName: 'col_a', currencyCode: 'EUR', newName: 'renamed' }),
      expect.any(String)
    )
  })
})
