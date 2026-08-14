/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableConflictError } = vi.hoisted(() => {
  class MockTableConflictError extends Error {
    constructor(name: string) {
      super(`A table named "${name}" already exists in this workspace`)
      this.name = 'TableConflictError'
    }
  }

  return {
    mocks: {
      checkRateLimit: vi.fn(),
      validateWorkspaceAccess: vi.fn(),
      createTable: vi.fn(),
      getWorkspaceTableLimits: vi.fn(),
      orchestrationErrorResponse: vi.fn(),
    },
    MockTableConflictError,
  }
})

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mocks.checkRateLimit,
  createRateLimitResponse: () => NextResponse.json({ error: 'Rate limited' }, { status: 429 }),
  validateWorkspaceAccess: mocks.validateWorkspaceAccess,
  v1ValidationErrorResponse: (error: { issues: unknown[] }) =>
    NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 }),
  v1ValidationErrorResponseFromError: vi.fn(() => null),
}))

vi.mock('@/app/api/table/utils', () => ({
  orchestrationErrorResponse: mocks.orchestrationErrorResponse,
}))
vi.mock('@/lib/table/wire', () => ({
  normalizeColumn: (column: unknown) => column,
}))

vi.mock('@/lib/table', () => ({
  createTable: mocks.createTable,
  getWorkspaceTableLimits: mocks.getWorkspaceTableLimits,
  listTables: vi.fn(),
  TableConflictError: MockTableConflictError,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_CREATED: 'table.created' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: vi.fn(),
}))

import { POST } from '@/app/api/v1/tables/route'

describe('POST /api/v1/tables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mocks.validateWorkspaceAccess.mockResolvedValue(null)
    mocks.getWorkspaceTableLimits.mockResolvedValue({ maxTables: 10 })
  })

  it('preserves the legacy 400 response for a duplicate table name', async () => {
    mocks.createTable.mockRejectedValue(new MockTableConflictError('Reports'))

    const response = await POST(
      createMockRequest('POST', {
        workspaceId: 'workspace-1',
        name: 'Reports',
        schema: { columns: [{ name: 'Name', type: 'string' }] },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'A table named "Reports" already exists in this workspace',
    })
    expect(mocks.orchestrationErrorResponse).not.toHaveBeenCalled()
  })
})
