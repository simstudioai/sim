import { auditMock } from '@sim/testing/mocks/audit.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableRouteUtilsMock,
  tableRouteUtilsMockFns,
} from '@sim/testing/mocks/table-route-utils.mock'
import { MockTableConflictError } from '@sim/testing/mocks/table-service.mock'
import { tableWireMock } from '@sim/testing/mocks/table-wire.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/app/api/table/utils', () => tableRouteUtilsMock)
vi.mock('@/lib/table/wire', () => tableWireMock)
vi.mock('@/lib/table', () => tableMock)

vi.mock('@sim/audit', () => auditMock)

import { POST } from '@/app/api/v1/tables/route'

const { mockCheckRateLimit, mockValidateWorkspaceAccess } = v1MiddlewareMockFns
v1MiddlewareMockFns.mockV1ValidationErrorResponseFromError.mockReturnValue(null)

const mockCreateTable = tableMockFns.mockCreateTable
const mockGetWorkspaceTableLimits = tableMockFns.mockGetWorkspaceTableLimits
const mockOrchestrationErrorResponse = tableRouteUtilsMockFns.mockOrchestrationErrorResponse

describe('POST /api/v1/tables', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceTableLimits.mockResolvedValue({ maxTables: 10 })
  })

  it('preserves the legacy 400 response for a duplicate table name', async () => {
    mockCreateTable.mockRejectedValue(new MockTableConflictError('Reports'))

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
    expect(mockOrchestrationErrorResponse).not.toHaveBeenCalled()
  })
})
