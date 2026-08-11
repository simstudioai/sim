/**
 * @vitest-environment node
 *
 * DELETE /api/v1/tables/[tableId] projects an orchestration failure onto the
 * wire. Two properties of that projection are load-bearing and have regressed
 * before, so they are pinned here rather than left to the helper's own unit
 * test: an UNCLASSIFIED failure must never reach an API-key holder (its message
 * is whatever the fault happened to carry — a driver's failed SQL and its bound
 * parameters), and a `locked` failure must carry `lock` so the client knows
 * which lock to clear.
 */
import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockCheckWorkspaceScope,
  mockGetTableById,
  mockGetUserEntityPermissions,
  mockPerformDeleteTable,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockCheckWorkspaceScope: vi.fn(),
  mockGetTableById: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockPerformDeleteTable: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  checkWorkspaceScope: mockCheckWorkspaceScope,
  createRateLimitResponse: () => NextResponse.json({ error: 'Rate limited' }, { status: 429 }),
}))

vi.mock('@/lib/table', () => ({
  buildFilterClause: vi.fn(),
  getTableById: mockGetTableById,
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceOrganizationId: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/table/orchestration', () => ({
  performDeleteTable: mockPerformDeleteTable,
}))

import { DELETE } from '@/app/api/v1/tables/[tableId]/route'

const TABLE_ID = '22222222-2222-4222-8222-222222222222'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

/**
 * Stands in for a driver fault surfacing verbatim. Shaped like a real one —
 * a statement plus its bound parameters — so the assertions can prove none of
 * it reaches the response body.
 */
const LEAKY_INTERNAL_MESSAGE =
  'Failed query: delete from "user_table" where "user_table"."id" = $1 params: 22222222-2222-4222-8222-222222222222'

function makeRequest() {
  return createMockRequest(
    'DELETE',
    undefined,
    {},
    `http://localhost:3000/api/v1/tables/${TABLE_ID}?workspaceId=${WORKSPACE_ID}`
  )
}

function makeContext() {
  return { params: Promise.resolve({ tableId: TABLE_ID }) }
}

describe('DELETE /api/v1/tables/[tableId] — orchestration failure projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockCheckWorkspaceScope.mockResolvedValue(null)
    mockGetTableById.mockResolvedValue({
      id: TABLE_ID,
      name: 'Table',
      workspaceId: WORKSPACE_ID,
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('renders an unclassified internal failure as a fixed generic message', async () => {
    mockPerformDeleteTable.mockResolvedValue({
      success: false,
      error: LEAKY_INTERNAL_MESSAGE,
      errorCode: 'internal',
    })

    const response = await DELETE(makeRequest(), makeContext())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to delete table' })
    expect(JSON.stringify(body)).not.toContain('Failed query')
    expect(JSON.stringify(body)).not.toContain('params:')
    expect(JSON.stringify(body)).not.toContain('$1')
  })

  it('renders an unclassified failure with no error code as the same generic message', async () => {
    mockPerformDeleteTable.mockResolvedValue({ success: false, error: LEAKY_INTERNAL_MESSAGE })

    const response = await DELETE(makeRequest(), makeContext())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to delete table' })
  })

  it('keeps the specific message of a classified failure', async () => {
    mockPerformDeleteTable.mockResolvedValue({
      success: false,
      error: 'Table not found',
      errorCode: 'not_found',
    })

    const response = await DELETE(makeRequest(), makeContext())

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Table not found' })
  })

  it('returns 423 with the rejecting lock kind', async () => {
    mockPerformDeleteTable.mockResolvedValue({
      success: false,
      error: 'Table is locked against deletion',
      errorCode: 'locked',
      lock: 'delete',
    })

    const response = await DELETE(makeRequest(), makeContext())

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({
      error: 'Table is locked against deletion',
      lock: 'delete',
    })
  })
})
