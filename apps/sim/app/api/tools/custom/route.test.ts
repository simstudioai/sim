/**
 * Tests for custom tools API routes
 */
import {
  authMockFns,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpsertCustomTools } = vi.hoisted(() => ({
  mockUpsertCustomTools: vi.fn(),
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

const sampleTools = [
  {
    id: 'tool-1',
    workspaceId: 'workspace-123',
    userId: 'user-123',
    title: 'Weather Tool',
    schema: {
      type: 'function',
      function: {
        name: 'getWeather',
        description: 'Get weather information for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
          },
          required: ['location'],
        },
      },
    },
    code: 'return { temperature: 72, conditions: "sunny" };',
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-02T00:00:00.000Z',
  },
  {
    id: 'tool-2',
    workspaceId: 'workspace-123',
    userId: 'user-123',
    title: 'Calculator Tool',
    schema: {
      type: 'function',
      function: {
        name: 'calculator',
        description: 'Perform basic calculations',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              description: 'The operation to perform (add, subtract, multiply, divide)',
            },
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['operation', 'a', 'b'],
        },
      },
    },
    code: 'const { operation, a, b } = params; if (operation === "add") return a + b;',
    createdAt: '2023-02-01T00:00:00.000Z',
    updatedAt: '2023-02-02T00:00:00.000Z',
  },
]

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  upsertCustomTools: (...args: unknown[]) => mockUpsertCustomTools(...args),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

import { DELETE } from '@/app/api/tools/custom/route'

describe('Custom Tools API Routes', () => {
  const mockSession = { user: { id: 'user-123' } }

  beforeEach(() => {
    resetDbChainMock()

    authMockFns.mockGetSession.mockResolvedValue(mockSession)
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockUpsertCustomTools.mockResolvedValue(sampleTools)
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { workspaceId: 'workspace-123' },
    })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  /**
   * Test DELETE endpoint
   */
  describe('DELETE /api/tools/custom', () => {
    it('should prevent unauthorized deletion of user-scoped tool', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-456',
        authType: 'session',
      })

      const userScopedTool = { ...sampleTools[0], workspaceId: null, userId: 'user-123' }
      queueTableRows(schemaMock.customTools, [userScopedTool])

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Access denied')
    })
  })
})
