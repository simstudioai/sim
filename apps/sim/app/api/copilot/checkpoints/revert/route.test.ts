/**
 * Tests for copilot checkpoints revert API route
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvMock,
  schemaMock,
  setEnv,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetAccessibleCopilotChat,
  mockParseWorkflowStateForPersistence,
  mockSaveWorkflowNormalizedState,
} = vi.hoisted(() => ({
  mockGetAccessibleCopilotChat: vi.fn(),
  mockParseWorkflowStateForPersistence: vi.fn(),
  mockSaveWorkflowNormalizedState: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workflows/persistence/save-normalized-state', () => ({
  parseWorkflowStateForPersistence: mockParseWorkflowStateForPersistence,
  saveWorkflowNormalizedState: mockSaveWorkflowNormalizedState,
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChat: mockGetAccessibleCopilotChat,
  getAccessibleCopilotChatAuth: mockGetAccessibleCopilotChat,
}))

import { POST } from '@/app/api/copilot/checkpoints/revert/route'

describe('Copilot Checkpoints Revert API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })

    authMockFns.mockGetSession.mockResolvedValue(null)

    /** Authorization is the route's workflow read, so an allowed result always carries one. */
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'b2c3d4e5-f6a7-4b89-a0d1-e2f3a4b5c6d7', workspaceId: 'ws-123' },
    })

    mockGetAccessibleCopilotChat.mockResolvedValue({ id: 'chat-123', userId: 'user-123' })

    mockParseWorkflowStateForPersistence.mockImplementation((value: unknown) => ({
      success: true,
      data: value,
    }))
    mockSaveWorkflowNormalizedState.mockResolvedValue({ success: true, warnings: [] })

    global.fetch = vi.fn()

    vi.spyOn(Date, 'now').mockReturnValue(1640995200000)

    const originalDate = Date
    const buildDate = (args: any[]): Date => {
      if (args.length === 0) {
        return new originalDate('2024-01-01T00:00:00.000Z')
      }
      if (args.length === 1) {
        return new originalDate(args[0])
      }
      return new originalDate(args[0], args[1], args[2], args[3], args[4], args[5], args[6])
    }
    vi.spyOn(global, 'Date').mockImplementation(
      class {
        constructor(...args: any[]) {
          // biome-ignore lint/correctness/noConstructorReturn: vitest 4 constructs mocks via Reflect.construct; returning a real Date overrides the instance so `new Date(...)` yields a genuine Date the route can call .toISOString()/.getTime() on
          return buildDate(args)
        }
      } as any
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    resetDbChainMock()
    resetEnvMock()
  })

  /** Helper to set authenticated state */
  function setAuthenticated(user = { id: 'user-123', email: 'test@example.com' }) {
    authMockFns.mockGetSession.mockResolvedValue({ user })
  }

  /** Helper to set unauthenticated state */
  function setUnauthenticated() {
    authMockFns.mockGetSession.mockResolvedValue(null)
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

    it('should return 400 for invalid request body - missing checkpointId', async () => {
      setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(typeof responseData.error).toBe('string')
    })

    it('should return 400 for empty checkpointId', async () => {
      setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: '' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(typeof responseData.error).toBe('string')
    })

    it('should return 404 when checkpoint is not found', async () => {
      setAuthenticated()

      queueTableRows(schemaMock.workflowCheckpoints, [])

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

      queueTableRows(schemaMock.workflowCheckpoints, [])

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

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      /** Authorization performs the workflow read, so a missing workflow surfaces through it. */
      workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 404,
        workflow: null,
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(404)
      const responseData = await response.json()
      expect(responseData.error).toBe('Workflow not found')
      expect(mockSaveWorkflowNormalizedState).not.toHaveBeenCalled()
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

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

      workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 403,
        workflow: { id: 'b2c3d4e5-f6a7-4b89-a0d1-e2f3a4b5c6d7', workspaceId: 'ws-123' },
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
        },
      }

      const mockWorkflow = {
        id: 'c3d4e5f6-a7b8-4c09-a1e2-f3a4b5c6d7e8',
        userId: 'user-123',
      }

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

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
            lastSaved: 1640995200000,
          },
        },
      })

      expect(mockSaveWorkflowNormalizedState).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'c3d4e5f6-a7b8-4c09-a1e2-f3a4b5c6d7e8',
          userId: 'user-123',
          state: {
            blocks: { block1: { type: 'start' } },
            edges: [{ from: 'block1', to: 'block2' }],
            loops: {},
            parallels: {},
            isDeployed: true,
            lastSaved: 1640995200000,
          },
        })
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

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

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

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

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
        },
      }

      const mockWorkflow = {
        id: 'f6a7b8c9-d0e1-4f23-a4b5-c6d7e8f9a0b1',
        userId: 'user-123',
      }

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

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
        lastSaved: 1640995200000,
      })
    })

    it('should return 500 when the state write fails', async () => {
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

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

      mockSaveWorkflowNormalizedState.mockResolvedValueOnce({
        success: false,
        status: 500,
        error: 'Failed to save workflow state',
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

    it('should return 500 when the checkpoint state fails validation', async () => {
      setAuthenticated()

      const mockCheckpoint = {
        id: 'checkpoint-123',
        workflowId: 'a7b8c9d0-e1f2-4a34-b5c6-d7e8f9a0b1c2',
        userId: 'user-123',
        workflowState: { blocks: {}, edges: [] },
      }

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [{ id: mockCheckpoint.workflowId, userId: 'user-123' }])

      mockParseWorkflowStateForPersistence.mockReturnValueOnce({
        success: false,
        error: { issues: [{ message: 'blocks: invalid' }] },
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/checkpoints/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId: 'checkpoint-123' }),
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      expect(mockSaveWorkflowNormalizedState).not.toHaveBeenCalled()
    })

    it('should handle database errors during checkpoint lookup', async () => {
      setAuthenticated()

      dbChainMockFns.where.mockReturnValueOnce(
        Promise.reject(new Error('Database connection failed'))
      )

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

      dbChainMockFns.where.mockReturnValueOnce(Promise.resolve([mockCheckpoint]))
      /** Authorization performs the workflow read, so a failed lookup surfaces through it. */
      workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockRejectedValueOnce(
        new Error('Database error during workflow lookup')
      )

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

    it('should handle unexpected errors from the state write', async () => {
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

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

      mockSaveWorkflowNormalizedState.mockRejectedValueOnce(new Error('Network error'))

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

    it('should apply the state in-process instead of re-authenticating over HTTP', async () => {
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

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

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

      expect(mockSaveWorkflowNormalizedState).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'd0e1f2a3-b4c5-4d67-a8f9-a0b1c2d3e4f5',
          userId: 'user-123',
        })
      )
      for (const call of (global.fetch as any).mock.calls) {
        expect(String(call[0])).not.toContain('/state')
      }
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

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

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
      expect(mockSaveWorkflowNormalizedState).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'e1f2a3b4-c5d6-4e78-a9a0-b1c2d3e4f5a6',
          userId: 'user-123',
        })
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
          deployedAt: '2024-01-01T10:00:00.000Z',
        },
      }

      const mockWorkflow = {
        id: 'f2a3b4c5-d6e7-4f89-a0b1-c2d3e4f5a6b7',
        userId: 'user-123',
      }

      queueTableRows(schemaMock.workflowCheckpoints, [mockCheckpoint])
      queueTableRows(schemaMock.workflow, [mockWorkflow])

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
        deployedAt: '2024-01-01T10:00:00.000Z',
        lastSaved: 1640995200000,
      })
    })
  })
})
