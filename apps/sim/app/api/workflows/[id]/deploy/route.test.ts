/**
 * Integration tests for workflow deployment API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Workflow Deployment API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/lib/utils', () => ({
      generateApiKey: vi.fn().mockReturnValue('sim_testkeygenerated12345'),
    }))

    vi.doMock('uuid', () => ({
      v4: vi.fn().mockReturnValue('mock-uuid-1234'),
    }))

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id'),
    })

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }))

    vi.doMock('../../middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
        },
      }),
    }))

    vi.doMock('../../utils', () => ({
      createSuccessResponse: vi.fn().mockImplementation((data) => {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      createErrorResponse: vi.fn().mockImplementation((message, status = 500) => {
        return new Response(JSON.stringify({ error: message }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test GET deployment status
   */
  it('should fetch deployment info successfully', async () => {
    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  isDeployed: false,
                  deployedAt: null,
                  userId: 'user-id',
                },
              ]),
            }),
          }),
        }),
      },
    }))

    const req = createMockRequest('GET')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { GET } = await import('./route')

    const response = await GET(req, { params })

    expect(response.status).toBe(200)

    const data = await response.json()

    expect(data).toHaveProperty('isDeployed', false)
    expect(data).toHaveProperty('apiKey', null)
    expect(data).toHaveProperty('deployedAt', null)
  })

  /**
   * Test POST deployment with no existing API key
   * This should generate a new API key
   */
  it('should create new API key when deploying workflow for user with no API key', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue(undefined),
    })

    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'workflow-id' }]),
      }),
    })

    vi.doMock('@/db', () => ({
      db: {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    userId: 'user-id',
                  },
                ]),
              }),
            }),
          })
          // Mock normalized table queries (blocks, edges, subflows)
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  id: 'block-1',
                  type: 'starter',
                  name: 'Start',
                  positionX: '100',
                  positionY: '100',
                  enabled: true,
                  subBlocks: {},
                  data: {},
                },
              ]),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]), // No edges
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]), // No subflows
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]), // No existing API key
              }),
            }),
          }),
        insert: mockInsert,
        update: mockUpdate,
      },
    }))

    const req = createMockRequest('POST')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('./route')

    const response = await POST(req, { params })

    expect(response.status).toBe(200)

    const data = await response.json()

    expect(data).toHaveProperty('apiKey', 'sim_testkeygenerated12345')
    expect(data).toHaveProperty('isDeployed', true)
    expect(data).toHaveProperty('deployedAt')

    expect(mockInsert).toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalled()
  })

  /**
   * Test POST deployment with existing API key
   * This should use the existing API key
   */
  it('should use existing API key when deploying workflow', async () => {
    const mockInsert = vi.fn()

    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'workflow-id' }]),
      }),
    })

    vi.doMock('@/db', () => ({
      db: {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    userId: 'user-id',
                  },
                ]),
              }),
            }),
          })
          // Mock normalized table queries (blocks, edges, subflows)
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  id: 'block-1',
                  type: 'starter',
                  name: 'Start',
                  positionX: '100',
                  positionY: '100',
                  enabled: true,
                  subBlocks: {},
                  data: {},
                },
              ]),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]), // No edges
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]), // No subflows
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    key: 'sim_existingtestapikey12345',
                  },
                ]), // Existing API key
              }),
            }),
          }),
        insert: mockInsert,
        update: mockUpdate,
      },
    }))

    const req = createMockRequest('POST')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('./route')

    const response = await POST(req, { params })

    expect(response.status).toBe(200)

    const data = await response.json()

    expect(data).toHaveProperty('apiKey', 'sim_existingtestapikey12345')
    expect(data).toHaveProperty('isDeployed', true)

    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalled()
  })

  /**
   * Test DELETE undeployment
   */
  it('should undeploy workflow successfully', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'workflow-id' }]),
      }),
    })

    vi.doMock('@/db', () => ({
      db: {
        update: mockUpdate,
      },
    }))

    const req = createMockRequest('DELETE')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { DELETE } = await import('./route')

    const response = await DELETE(req, { params })

    expect(response.status).toBe(200)

    const data = await response.json()

    expect(data).toHaveProperty('isDeployed', false)
    expect(data).toHaveProperty('deployedAt', null)
    expect(data).toHaveProperty('apiKey', null)

    expect(mockUpdate).toHaveBeenCalled()
  })

  /**
   * Test error handling
   */
  it('should handle errors when workflow is not found', async () => {
    vi.doMock('../../middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        error: {
          message: 'Workflow not found',
          status: 404,
        },
      }),
    }))

    const req = createMockRequest('POST')

    const params = Promise.resolve({ id: 'invalid-id' })

    const { POST } = await import('./route')

    const response = await POST(req, { params })

    expect(response.status).toBe(404)

    const data = await response.json()

    expect(data).toHaveProperty('error', 'Workflow not found')
  })

  /**
   * Test unauthorized access
   */
  it('should handle unauthorized access to workflow', async () => {
    vi.doMock('../../middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        error: {
          message: 'Unauthorized access',
          status: 403,
        },
      }),
    }))

    const req = createMockRequest('POST')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('./route')

    const response = await POST(req, { params })

    expect(response.status).toBe(403)

    const data = await response.json()

    expect(data).toHaveProperty('error', 'Unauthorized access')
  })
})
