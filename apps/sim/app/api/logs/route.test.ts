/**
 * Tests for workflow logs API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Workflow Logs API Route', () => {
  const mockWorkflowLogs = [
    {
      id: 'log-1',
      workflowId: 'workflow-1',
      executionId: 'exec-1',
      level: 'info',
      message: 'Workflow started',
      duration: '1.2s',
      trigger: 'manual',
      createdAt: new Date('2024-01-01T10:00:00.000Z'),
    },
    {
      id: 'log-2',
      workflowId: 'workflow-1',
      executionId: 'exec-1',
      level: 'error',
      message: 'API call failed',
      duration: '0.5s',
      trigger: 'manual',
      createdAt: new Date('2024-01-01T10:01:00.000Z'),
    },
    {
      id: 'log-3',
      workflowId: 'workflow-2',
      executionId: 'exec-2',
      level: 'info',
      message: 'Task completed',
      duration: '2.1s',
      trigger: 'api',
      createdAt: new Date('2024-01-01T10:02:00.000Z'),
    },
  ]

  const mockWorkflows = [
    {
      id: 'workflow-1',
      userId: 'user-123',
      name: 'Test Workflow 1',
      color: '#3972F6',
      description: 'First test workflow',
      state: {},
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    },
    {
      id: 'workflow-2',
      userId: 'user-123',
      name: 'Test Workflow 2',
      color: '#FF6B6B',
      description: 'Second test workflow',
      state: {},
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    },
  ]

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id-12345678'),
    })

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-123' },
      }),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function setupDatabaseMock({
    userWorkflows = mockWorkflows.filter((w) => w.userId === 'user-123'),
    logs = mockWorkflowLogs,
    workflows = mockWorkflows,
    throwError = false,
  } = {}) {
    const createChainableMock = (data: any[]) => {
      const mock = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve(data)),
      }
      return mock
    }

    let dbCallCount = 0

    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockImplementation((selection?: any) => {
          if (throwError) {
            throw new Error('Database connection failed')
          }

          dbCallCount++

          // First call: get user workflows
          if (dbCallCount === 1) {
            return createChainableMock(userWorkflows.map((w) => ({ id: w.id })))
          }

          // Second call: get logs
          if (dbCallCount === 2) {
            return createChainableMock(logs)
          }

          // Third call: get count
          if (dbCallCount === 3) {
            // If selection is provided and has count property, return count result
            if (selection && Object.keys(selection).some((key) => key === 'count')) {
              return createChainableMock([{ count: logs.length }])
            }
            return createChainableMock([{ count: logs.length }])
          }

          // Fourth call: get workflows for includeWorkflow
          if (dbCallCount === 4) {
            return createChainableMock(workflows)
          }

          return createChainableMock([])
        }),
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn().mockImplementation((field, value) => ({ type: 'eq', field, value })),
      and: vi.fn().mockImplementation((...conditions) => ({ type: 'and', conditions })),
      or: vi.fn().mockImplementation((...conditions) => ({ type: 'or', conditions })),
      gte: vi.fn().mockImplementation((field, value) => ({ type: 'gte', field, value })),
      lte: vi.fn().mockImplementation((field, value) => ({ type: 'lte', field, value })),
      sql: vi.fn().mockImplementation((strings, ...values) => ({
        type: 'sql',
        sql: strings,
        values,
      })),
    }))

    vi.doMock('@/db/schema', () => ({
      workflow: {
        id: 'workflow.id',
        userId: 'workflow.userId',
        name: 'workflow.name',
        color: 'workflow.color',
        description: 'workflow.description',
      },
      workflowLogs: {
        id: 'workflowLogs.id',
        workflowId: 'workflowLogs.workflowId',
        level: 'workflowLogs.level',
        createdAt: 'workflowLogs.createdAt',
        message: 'workflowLogs.message',
        executionId: 'workflowLogs.executionId',
      },
    }))
  }

  describe('GET /api/logs', () => {
    it('should return logs successfully with default parameters', async () => {
      setupDatabaseMock()

      const req = createMockRequest('GET')

      const { GET } = await import('./route')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('data')
      expect(data).toHaveProperty('total', 3)
      expect(data).toHaveProperty('page', 1)
      expect(data).toHaveProperty('pageSize', 100)
      expect(data).toHaveProperty('totalPages', 1)
      expect(Array.isArray(data.data)).toBe(true)
      expect(data.data).toHaveLength(3)
    })

    it('should include workflow data when includeWorkflow=true', async () => {
      setupDatabaseMock()

      const url = new URL('http://localhost:3000/api/logs?includeWorkflow=true')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data[0]).toHaveProperty('workflow')
      expect(data.data[0].workflow).toHaveProperty('name')
      expect(data.data[0].workflow).toHaveProperty('color')
    })

    it('should filter logs by level', async () => {
      const errorLogs = mockWorkflowLogs.filter((log) => log.level === 'error')
      setupDatabaseMock({ logs: errorLogs })

      const url = new URL('http://localhost:3000/api/logs?level=error')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(1)
      expect(data.data[0].level).toBe('error')
    })

    it('should filter logs by specific workflow IDs', async () => {
      const workflow1Logs = mockWorkflowLogs.filter((log) => log.workflowId === 'workflow-1')
      setupDatabaseMock({ logs: workflow1Logs })

      const url = new URL('http://localhost:3000/api/logs?workflowIds=workflow-1')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(2)
      expect(data.data.every((log: any) => log.workflowId === 'workflow-1')).toBe(true)
    })

    it('should filter logs by multiple workflow IDs', async () => {
      setupDatabaseMock()

      const url = new URL('http://localhost:3000/api/logs?workflowIds=workflow-1,workflow-2')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(3)
    })

    it('should filter logs by date range', async () => {
      const startDate = '2024-01-01T10:00:30.000Z'
      const filteredLogs = mockWorkflowLogs.filter(
        (log) => new Date(log.createdAt) >= new Date(startDate)
      )
      setupDatabaseMock({ logs: filteredLogs })

      const url = new URL(`http://localhost:3000/api/logs?startDate=${startDate}`)
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(2)
    })

    it('should search logs by message content', async () => {
      const searchLogs = mockWorkflowLogs.filter((log) =>
        log.message.toLowerCase().includes('failed')
      )
      setupDatabaseMock({ logs: searchLogs })

      const url = new URL('http://localhost:3000/api/logs?search=failed')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(1)
      expect(data.data[0].message).toContain('failed')
    })

    it('should handle pagination correctly', async () => {
      const paginatedLogs = mockWorkflowLogs.slice(1, 3)
      setupDatabaseMock({ logs: paginatedLogs })

      const url = new URL('http://localhost:3000/api/logs?limit=2&offset=1')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(2)
      expect(data.page).toBe(1)
      expect(data.pageSize).toBe(2)
      expect(data.total).toBe(2)
      expect(data.totalPages).toBe(1)
    })

    it('should return empty array when user has no workflows', async () => {
      setupDatabaseMock({ userWorkflows: [], logs: [], workflows: [] })

      const req = createMockRequest('GET')

      const { GET } = await import('./route')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toEqual([])
      expect(data.total).toBe(0)
    })

    it('should return 403 for unauthorized workflow access', async () => {
      // Set up mock to simulate user not owning the requested workflow
      setupDatabaseMock({
        userWorkflows: mockWorkflows.filter((w) => w.id !== 'unauthorized-workflow'),
      })

      const url = new URL('http://localhost:3000/api/logs?workflowIds=unauthorized-workflow')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Unauthorized access to workflows')
    })

    it('should return 401 for unauthenticated requests', async () => {
      // Mock auth to return no session
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      setupDatabaseMock()

      const req = createMockRequest('GET')

      const { GET } = await import('./route')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should validate query parameters', async () => {
      setupDatabaseMock()

      const url = new URL('http://localhost:3000/api/logs?limit=invalid')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Invalid request parameters')
      expect(data).toHaveProperty('details')
    })

    it('should handle database errors gracefully', async () => {
      setupDatabaseMock({ throwError: true })

      const req = createMockRequest('GET')

      const { GET } = await import('./route')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toHaveProperty('error')
    })

    it('should combine multiple filters correctly', async () => {
      const filteredLogs = mockWorkflowLogs.filter(
        (log) =>
          log.level === 'info' &&
          log.workflowId === 'workflow-1' &&
          log.message.toLowerCase().includes('started')
      )
      setupDatabaseMock({ logs: filteredLogs })

      const url = new URL(
        'http://localhost:3000/api/logs?level=info&workflowIds=workflow-1&search=started'
      )
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(1)
      expect(data.data[0].level).toBe('info')
      expect(data.data[0].workflowId).toBe('workflow-1')
      expect(data.data[0].message).toContain('started')
    })

    it('should handle end date filter', async () => {
      const endDate = '2024-01-01T10:01:30.000Z'
      const filteredLogs = mockWorkflowLogs.filter(
        (log) => new Date(log.createdAt) <= new Date(endDate)
      )
      setupDatabaseMock({ logs: filteredLogs })

      const url = new URL(`http://localhost:3000/api/logs?endDate=${endDate}`)
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(2)
    })

    it('should handle large offset values', async () => {
      setupDatabaseMock({ logs: [] })

      const url = new URL('http://localhost:3000/api/logs?limit=10&offset=1000')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toEqual([])
      expect(data.page).toBe(101) // (1000 / 10) + 1
      expect(data.total).toBe(0)
    })

    it('should handle search by execution ID', async () => {
      const searchLogs = mockWorkflowLogs.filter((log) => log.executionId?.includes('exec-1'))
      setupDatabaseMock({ logs: searchLogs })

      const url = new URL('http://localhost:3000/api/logs?search=exec-1')
      const req = new Request(url.toString())

      const { GET } = await import('./route')
      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(2)
      expect(data.data.every((log: any) => log.executionId === 'exec-1')).toBe(true)
    })
  })
})
