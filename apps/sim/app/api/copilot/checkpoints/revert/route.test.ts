/**
 * Tests for copilot checkpoints revert API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockThen,
  mockDelete,
  mockDeleteWhere,
  mockAuthorize,
  mockGetSession,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockThen: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockAuthorize: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
  getInternalApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
  getBaseDomain: vi.fn(() => 'localhost:3000'),
  getEmailDomain: vi.fn(() => 'localhost:3000'),
}))

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorize,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    delete: mockDelete,
  },
}))

vi.mock('@sim/db/schema', () => ({
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

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
}))

import { POST } from '@/app/api/copilot/checkpoints/revert/route'

describe('Copilot Checkpoints Revert API Route', () => {
  /** Queued results for successive `.then()` calls in the db select chain */
  let thenResults: unknown[]

  beforeEach(() => {
    vi.clearAllMocks()

    thenResults = []

    mockGetSession.mockResolvedValue(null)

    mockAuthorize.mockResolvedValue({
      allowed: true,
      status: 200,
    })

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ then: mockThen })

    // Drizzle's .then() is a thenable: it receives a callback like (rows) => rows[0].
    // We invoke the callback with our mock rows array so the route gets the expected value.
    mockThen.mockImplementation((callback: (rows: unknown[]) => unknown) => {
      const result = thenResults.shift()
      if (result instanceof Error) {
        return Promise.reject(result)
      }
      const rows = result === undefined ? [] : [result]
      return Promise.resolve(callback(rows))
    })

    // Mock delete chain
    mockDelete.mockReturnValue({ where: mockDeleteWhere })
    mockDeleteWhere.mockResolvedValue(undefined)

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

  /** Helper to set authenticated state */
  function setAuthenticated(user = { id: 'user-123', email: 'test@example.com' }) {
    mockGetSession.mockResolvedValue({ user })
  }

  /** Helper to set unauthenticated state */
  function setUnauthenticated() {
    mockGetSession.mockResolvedValue(null)
  }

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      setUnauthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 500 for invalid request body - missing checkpointId', async () => {
      setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should return 500 for empty checkpointId', async () => {
      setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: '' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should return 404 when checkpoint is not found', async () => {
      setAuthenticated()

      // Mock checkpoint not found
      thenResults.push(undefined)

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'non-existent-checkpoint' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Checkpoint not found or access denied')
    })

    it('should return 404 when checkpoint belongs to different user', async () => {
      setAuthenticated()

      // Mock checkpoint not found (due to user mismatch in query)
      thenResults.push(undefined)

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'other-user-checkpoint' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Checkpoint not found or access denied')
    })

    it('should return 404 when workflow is not found', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'a1b2c3d4-e5f6-4a78-b9c0-d1e2f3a4b5c6',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      thenResults.push(mockCheckpoint) // Checkpoint found
      thenResults.push(undefined) // Workflow not found

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Workflow not found')
    })

    it('should return 401 when workflow belongs to different user', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'b2c3d4e5-f6a7-4b89-a0d1-e2f3a4b5c6d7',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'b2c3d4e5-f6a7-4b89-a0d1-e2f3a4b5c6d7',
        userId: 'different-user',
      }

      thenResults.push(mockCheckpoint) // Checkpoint found
      thenResults.push(mockWorkflow) // Workflow found but different user

      mockAuthorize.mockResolvedValueOnce({
        allowed: false,
        status: 403,
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should successfully revert checkpoint with basic workflow state', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'c3d4e5f6-a7b8-4c09-a1e2-f3a4b5c6d7e8',
        userId: 'user-123',
        workflowState: {
          blocks: { block1: { type: 'start' } },
          edges: [{ from: 'block1', to: 'block2' }],
          loops: {},
          parallels: {},
          isDeployed: true,
          deploymentStatuses: { production: 'deployed' },
        },
      }

      const mockWorkflow = {
        id: 'c3d4e5f6-a7b8-4c09-a1e2-f3a4b5c6d7e8',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint) // Checkpoint found
      thenResults.push(mockWorkflow) // Workflow found

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

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        workflowId: 'c3d4e5f6-a7b8-4c09-a1e2-f3a4b5c6d7e8',
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
            lastSaved: 1640995200000,
          },
        },
      })

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/workflows/c3d4e5f6-a7b8-4c09-a1e2-f3a4b5c6d7e8/state',
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
            lastSaved: 1640995200000,
          }),
        }
      )
    })

    it('should handle checkpoint state with valid deployedAt date', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-with-date',
        workflowId: 'd4e5f6a7-b8c9-4d10-a2e3-a4b5c6d7e8f9',
        userId: 'user-123',
        workflowState: {
          blocks: {},
          edges: [],
          deployedAt: '2024-01-01T12:00:00.000Z',
          isDeployed: true,
        },
      }

      const mockWorkflow = {
        id: 'd4e5f6a7-b8c9-4d10-a2e3-a4b5c6d7e8f9',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint)
      thenResults.push(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-with-date' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.checkpoint.workflowState.deployedAt).toBeDefined()
      expect(responseData.checkpoint.workflowState.deployedAt).toEqual('2024-01-01T12:00:00.000Z')
    })

    it('should handle checkpoint state with invalid deployedAt date', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-invalid-date',
        workflowId: 'e5f6a7b8-c9d0-4e11-a3f4-b5c6d7e8f9a0',
        userId: 'user-123',
        workflowState: {
          blocks: {},
          edges: [],
          deployedAt: 'invalid-date',
          isDeployed: true,
        },
      }

      const mockWorkflow = {
        id: 'e5f6a7b8-c9d0-4e11-a3f4-b5c6d7e8f9a0',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint)
      thenResults.push(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-invalid-date' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      // Invalid date should be filtered out
      expect(responseData.checkpoint.workflowState.deployedAt).toBeUndefined()
    })

    it('should handle checkpoint state with null/undefined values', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-null-values',
        workflowId: 'f6a7b8c9-d0e1-4f23-a4b5-c6d7e8f9a0b1',
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
        id: 'f6a7b8c9-d0e1-4f23-a4b5-c6d7e8f9a0b1',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint)
      thenResults.push(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-null-values' }),
      })

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
        lastSaved: 1640995200000,
      })
    })

    it('should return 500 when state API call fails', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'a7b8c9d0-e1f2-4a34-b5c6-d7e8f9a0b1c2',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'a7b8c9d0-e1f2-4a34-b5c6-d7e8f9a0b1c2',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint)
      thenResults.push(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('State validation failed'),
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert workflow to checkpoint')
    })

    it('should handle database errors during checkpoint lookup', async () => {
      setAuthenticated()

      // Mock database error
      thenResults.push(new Error('Database connection failed'))

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should handle database errors during workflow lookup', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'b8c9d0e1-f2a3-4b45-a6d7-e8f9a0b1c2d3',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      thenResults.push(mockCheckpoint) // Checkpoint found
      thenResults.push(new Error('Database error during workflow lookup')) // Workflow lookup fails

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should handle fetch network errors', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'c9d0e1f2-a3b4-4c56-a7e8-f9a0b1c2d3e4',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'c9d0e1f2-a3b4-4c56-a7e8-f9a0b1c2d3e4',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint)
      thenResults.push(mockWorkflow)

      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should handle JSON parsing errors in request body', async () => {
      setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to revert to checkpoint')
    })

    it('should forward cookies to state API call', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'd0e1f2a3-b4c5-4d67-a8f9-a0b1c2d3e4f5',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'd0e1f2a3-b4c5-4d67-a8f9-a0b1c2d3e4f5',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint)
      thenResults.push(mockWorkflow)

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

      await POST(req)

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/workflows/d0e1f2a3-b4c5-4d67-a8f9-a0b1c2d3e4f5/state',
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
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'e1f2a3b4-c5d6-4e78-a9a0-b1c2d3e4f5a6',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      const mockWorkflow = {
        id: 'e1f2a3b4-c5d6-4e78-a9a0-b1c2d3e4f5a6',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint)
      thenResults.push(mockWorkflow)

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

      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/workflows/e1f2a3b4-c5d6-4e78-a9a0-b1c2d3e4f5a6/state',
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
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-complex',
        workflowId: 'f2a3b4c5-d6e7-4f89-a0b1-c2d3e4f5a6b7',
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
          deployedAt: '2024-01-01T10:00:00.000Z',
        },
      }

      const mockWorkflow = {
        id: 'f2a3b4c5-d6e7-4f89-a0b1-c2d3e4f5a6b7',
        userId: 'user-123',
      }

      thenResults.push(mockCheckpoint)
      thenResults.push(mockWorkflow)

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-complex' }),
      })

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
        deployedAt: '2024-01-01T10:00:00.000Z',
        lastSaved: 1640995200000,
      })
    })
  })
})
