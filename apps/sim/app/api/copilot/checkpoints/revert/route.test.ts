/**
 * Tests for copilot checkpoints revert API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockAuth,
  mockCryptoUuid,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

describe('Copilot Checkpoints Revert API Route', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockThen = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ then: mockThen })
    mockThen.mockResolvedValue(null) // Default: no data found

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
      },
    }))

    vi.doMock('@/db/schema', () => ({
      workflowCheckpoints: {
        id: 'id',
        userId: 'userId',
        workflowId: 'workflowId',
        workflowState: 'workflowState',
      },
      workflow: {
        id: 'id',
        userId: 'userId',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    }))

    global.fetch = vi.fn()

    vi.spyOn(Date, 'now').mockReturnValue(1640995200000)

    const originalDate = Date
    vi.spyOn(global, 'Date').mockImplementation(((...args: any[]) => {
      if (args.length === 0) {
        const mockDate = new originalDate('2024-01-01T00:00:00.000Z')
        return mockDate
      }
      if (args.length === 1) {
        return new originalDate(args[0])
      }
      return new originalDate(args[0], args[1], args[2], args[3], args[4], args[5], args[6])
    }) as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      const authMocks = mockAuth()
      authMocks.setUnauthenticated()

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-123',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 500 for invalid request body - missing checkpointId', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        // Missing checkpointId
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should return 500 for empty checkpointId', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const req = createMockRequest('POST', {
        checkpointId: '',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should return 404 when checkpoint is not found', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock checkpoint not found
      mockThen.mockResolvedValueOnce(undefined)

      const req = createMockRequest('POST', {
        checkpointId: 'non-existent-checkpoint',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Checkpoint not found or access denied')
    })

    it('should return 404 when checkpoint belongs to different user', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock checkpoint not found (due to user mismatch in query)
      mockThen.mockResolvedValueOnce(undefined)

      const req = createMockRequest('POST', {
        checkpointId: 'other-user-checkpoint',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Checkpoint not found or access denied')
    })

    it('should return 404 when workflow is not found', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock checkpoint found but workflow not found
      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      mockThen
        .mockResolvedValueOnce(mockCheckpoint) // Checkpoint found
        .mockResolvedValueOnce(undefined) // Workflow not found

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-123',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Workflow not found')
    })

    it('should return 401 when workflow belongs to different user', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock checkpoint found but workflow belongs to different user
      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'different-user',
      }

      mockThen
        .mockResolvedValueOnce(mockCheckpoint) // Checkpoint found
        .mockResolvedValueOnce(mockWorkflow) // Workflow found but different user

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-123',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should successfully revert checkpoint with basic workflow state', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: {
          blocks: { block1: { type: 'start' } },
          edges: [{ from: 'block1', to: 'block2' }],
          loops: {},
          parallels: {},
          isDeployed: true,
          deploymentStatuses: { production: 'deployed' },
          hasActiveWebhook: false,
        },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen
        .mockResolvedValueOnce(mockCheckpoint) // Checkpoint found
        .mockResolvedValueOnce(mockWorkflow) // Workflow found

      // Mock successful state API call

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=test-session',
        },
        body: JSON.stringify({
          checkpointId: 'checkpoint-123',
        }),
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        workflowId: 'workflow-456',
        checkpointId: 'checkpoint-123',
        revertedAt: '2024-01-01T00:00:00.000Z',
        checkpoint: {
          id: 'checkpoint-123',
          workflowState: {
            blocks: { block1: { type: 'start' } },
            edges: [{ from: 'block1', to: 'block2' }],
            loops: {},
            parallels: {},
            isDeployed: true,
            deploymentStatuses: { production: 'deployed' },
            hasActiveWebhook: false,
            lastSaved: 1640995200000,
          },
        },
      })

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/workflows/workflow-456/state',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'session=test-session',
          },
          body: JSON.stringify({
            blocks: { block1: { type: 'start' } },
            edges: [{ from: 'block1', to: 'block2' }],
            loops: {},
            parallels: {},
            isDeployed: true,
            deploymentStatuses: { production: 'deployed' },
            hasActiveWebhook: false,
            lastSaved: 1640995200000,
          }),
        }
      )
    })

    it('should handle checkpoint state with valid deployedAt date', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-with-date',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: {
          blocks: {},
          edges: [],
          deployedAt: '2024-01-01T12:00:00.000Z',
          isDeployed: true,
        },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen.mockResolvedValueOnce(mockCheckpoint).mockResolvedValueOnce(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-with-date',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.checkpoint.workflowState.deployedAt).toBeDefined()
      expect(responseData.checkpoint.workflowState.deployedAt).toEqual('2024-01-01T12:00:00.000Z')
    })

    it('should handle checkpoint state with invalid deployedAt date', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-invalid-date',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: {
          blocks: {},
          edges: [],
          deployedAt: 'invalid-date',
          isDeployed: true,
        },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen.mockResolvedValueOnce(mockCheckpoint).mockResolvedValueOnce(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-invalid-date',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      // Invalid date should be filtered out
      expect(responseData.checkpoint.workflowState.deployedAt).toBeUndefined()
    })

    it('should handle checkpoint state with null/undefined values', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-null-values',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: {
          blocks: null,
          edges: undefined,
          loops: null,
          parallels: undefined,
          deploymentStatuses: null,
        },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen.mockResolvedValueOnce(mockCheckpoint).mockResolvedValueOnce(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-null-values',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()

      // Null/undefined values should be replaced with defaults
      expect(responseData.checkpoint.workflowState).toEqual({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isDeployed: false,
        deploymentStatuses: {},
        hasActiveWebhook: false,
        lastSaved: 1640995200000,
      })
    })

    it('should return 500 when state API call fails', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen
        .mockResolvedValueOnce(mockCheckpoint)
        .mockResolvedValueOnce(mockWorkflow)

      // Mock failed state API call

      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('State validation failed'),
      })

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-123',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert workflow to checkpoint')
    })

    it('should handle database errors during checkpoint lookup', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Mock database error
      mockThen.mockRejectedValueOnce(new Error('Database connection failed'))

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-123',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should handle database errors during workflow lookup', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      mockThen
        .mockResolvedValueOnce(mockCheckpoint) // Checkpoint found
        .mockRejectedValueOnce(new Error('Database error during workflow lookup')) // Workflow lookup fails

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-123',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should handle fetch network errors', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen
        .mockResolvedValueOnce(mockCheckpoint)
        .mockResolvedValueOnce(mockWorkflow)

      // Mock fetch network error

      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-123',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should handle JSON parsing errors in request body', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      // Create a request with invalid JSON
      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should forward cookies to state API call', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen.mockResolvedValueOnce(mockCheckpoint).mockResolvedValueOnce(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=test-session; auth=token123',
        },
        body: JSON.stringify({
          checkpointId: 'checkpoint-123',
        }),
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      await POST(req)

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/workflows/workflow-456/state',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'session=test-session; auth=token123',
          },
          body: expect.any(String),
        }
      )
    })

    it('should handle missing cookies gracefully', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen.mockResolvedValueOnce(mockCheckpoint).mockResolvedValueOnce(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // No Cookie header
        },
        body: JSON.stringify({
          checkpointId: 'checkpoint-123',
        }),
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/workflows/workflow-456/state',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: '', // Empty string when no cookies
          },
          body: expect.any(String),
        }
      )
    })

    it('should handle complex checkpoint state with all fields', async () => {
      const authMocks = mockAuth()
      authMocks.setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-complex',
        workflowId: 'workflow-456',
        userId: 'user-123',
        workflowState: {
          blocks: {
            start: { type: 'start', config: {} },
            http: { type: 'http', config: { url: 'https://api.example.com' } },
            end: { type: 'end', config: {} },
          },
          edges: [
            { from: 'start', to: 'http' },
            { from: 'http', to: 'end' },
          ],
          loops: {
            loop1: { condition: 'true', iterations: 3 },
          },
          parallels: {
            parallel1: { branches: ['branch1', 'branch2'] },
          },
          isDeployed: true,
          deploymentStatuses: {
            production: 'deployed',
            staging: 'pending',
          },
          hasActiveWebhook: true,
          deployedAt: '2024-01-01T10:00:00.000Z',
        },
      }

      const mockWorkflow = {
        id: 'workflow-456',
        userId: 'user-123',
      }

      mockThen.mockResolvedValueOnce(mockCheckpoint).mockResolvedValueOnce(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = createMockRequest('POST', {
        checkpointId: 'checkpoint-complex',
      })

      const { POST } = await import('@/app/api/copilot/checkpoints/revert/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.checkpoint.workflowState).toEqual({
        blocks: {
          start: { type: 'start', config: {} },
          http: { type: 'http', config: { url: 'https://api.example.com' } },
          end: { type: 'end', config: {} },
        },
        edges: [
          { from: 'start', to: 'http' },
          { from: 'http', to: 'end' },
        ],
        loops: {
          loop1: { condition: 'true', iterations: 3 },
        },
        parallels: {
          parallel1: { branches: ['branch1', 'branch2'] },
        },
        isDeployed: true,
        deploymentStatuses: {
          production: 'deployed',
          staging: 'pending',
        },
        hasActiveWebhook: true,
        deployedAt: '2024-01-01T10:00:00.000Z',
        lastSaved: 1640995200000,
      })
    })
  })
})
