/**
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
  orchestrationErrorResponse: (error: unknown) =>
    error instanceof OrchestrationError
      ? NextResponse.json(
          { error: error.message },
          { status: statusForOrchestrationError(error.code) }
        )
      : null,
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
})
