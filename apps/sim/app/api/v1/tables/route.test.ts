/**
 * @vitest-environment node
 *
 * POST /api/v1/tables maps the create-table service's classified failures onto
 * status codes. A duplicate name is a `conflict` and answers 409 — the same
 * status every other v1 duplicate-name surface uses (knowledge, files, workflow
 * import) — while bad input stays 400 and a quota ceiling stays 403.
 */
import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockValidateWorkspaceAccess, mockCreateTable, mockGetLimits } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockValidateWorkspaceAccess: vi.fn(),
    mockCreateTable: vi.fn(),
    mockGetLimits: vi.fn(),
  }))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: () => NextResponse.json({ error: 'Rate limited' }, { status: 429 }),
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
  v1ValidationErrorResponse: (error: { issues: unknown[] }) =>
    NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 }),
  v1ValidationErrorResponseFromError: () => null,
}))

vi.mock('@/lib/table', () => ({
  buildFilterClause: vi.fn(),
  createTable: mockCreateTable,
  getTableById: vi.fn(),
  getWorkspaceTableLimits: mockGetLimits,
  listTables: vi.fn(),
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceOrganizationId: vi.fn().mockResolvedValue(null),
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v1/tables/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

function makeRequest() {
  return createMockRequest(
    'POST',
    {
      workspaceId: WORKSPACE_ID,
      name: 'Orders',
      schema: { columns: [{ name: 'amount', type: 'number' }] },
    },
    {},
    'http://localhost:3000/api/v1/tables'
  )
}

describe('POST /api/v1/tables — create failure statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    mockGetLimits.mockResolvedValue({ maxTables: 100 })
  })

  it('answers 409 for a duplicate table name', async () => {
    mockCreateTable.mockRejectedValue(
      new OrchestrationError('conflict', 'A table named "Orders" already exists in this workspace')
    )

    const response = await POST(makeRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'A table named "Orders" already exists in this workspace',
    })
  })

  it('answers 400 for invalid input', async () => {
    mockCreateTable.mockRejectedValue(
      new OrchestrationError('validation', 'Invalid table name: name is reserved')
    )

    const response = await POST(makeRequest())

    expect(response.status).toBe(400)
  })

  it('answers 403 for a workspace at its table limit', async () => {
    mockCreateTable.mockRejectedValue(
      new OrchestrationError('forbidden', 'Workspace has reached maximum table limit (100)')
    )

    const response = await POST(makeRequest())

    expect(response.status).toBe(403)
  })

  it('answers a fixed generic 500 for an unclassified failure', async () => {
    mockCreateTable.mockRejectedValue(
      new Error('Failed query: insert into "user_table" ... params: Orders')
    )

    const response = await POST(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to create table' })
    expect(JSON.stringify(body)).not.toContain('Failed query')
  })
})
