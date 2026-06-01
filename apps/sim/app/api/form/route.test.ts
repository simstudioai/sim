/**
 * @vitest-environment node
 */
import {
  authMockFns,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckWorkflowAccessForFormCreation } = vi.hoisted(() => ({
  mockCheckWorkflowAccessForFormCreation: vi.fn(),
}))

const mockCreateErrorResponse = workflowsApiUtilsMockFns.mockCreateErrorResponse
const mockPerformFullDeploy = workflowsOrchestrationMockFns.mockPerformFullDeploy

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'form-123'),
}))

vi.mock('@/app/api/form/utils', () => ({
  checkWorkflowAccessForFormCreation: mockCheckWorkflowAccessForFormCreation,
  DEFAULT_FORM_CUSTOMIZATIONS: {},
}))

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/core/config/feature-flags', () => ({
  isDev: true,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getEmailDomain: vi.fn(() => 'localhost:3000'),
}))

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

import { POST } from '@/app/api/form/route'

describe('Form API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    authMockFns.mockGetSession.mockResolvedValue({
      user: {
        id: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
      },
    })
    mockCreateErrorResponse.mockImplementation((message, status = 500) => {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    mockCheckWorkflowAccessForFormCreation.mockResolvedValue({
      hasAccess: true,
      workflow: {
        id: 'workflow-123',
        isDeployed: false,
        workspaceId: 'workspace-123',
      },
    })
    dbChainMockFns.limit.mockResolvedValue([])
  })

  it('cleans up inserted form when deploy throws', async () => {
    mockPerformFullDeploy.mockRejectedValue(new Error('Deploy exploded'))

    const request = new NextRequest('http://localhost:3000/api/form', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'workflow-123',
        identifier: 'test-form',
        title: 'Test Form',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(500)
    expect(dbChainMockFns.insert).toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalled()
    expect(mockCreateErrorResponse).toHaveBeenCalledWith('Deploy exploded', 500)
  })
})
