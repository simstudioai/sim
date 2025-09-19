/**
 * Integration tests for workflow deployment API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Workflow Deployment API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Set up environment to prevent @sim/db import errors
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

    // Mock postgres dependencies
    vi.doMock('drizzle-orm/postgres-js', () => ({
      drizzle: vi.fn().mockReturnValue({}),
    }))

    vi.doMock('postgres', () => vi.fn().mockReturnValue({}))

    vi.doMock('@/lib/utils', () => ({
      generateApiKey: vi.fn().mockReturnValue('sim_testkeygenerated12345'),
      generateRequestId: vi.fn(() => 'test-request-id'),
    }))

    vi.doMock('uuid', () => ({
      v4: vi.fn().mockReturnValue('mock-uuid-1234'),
    }))

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id'),
    })

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }))

    // Mock serializer
    vi.doMock('@/serializer', () => ({
      serializeWorkflow: vi.fn().mockReturnValue({
        version: '1.0',
        blocks: [
          {
            id: 'block-1',
            metadata: { id: 'starter', name: 'Start' },
            position: { x: 100, y: 100 },
            config: { tool: 'starter', params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
        parallels: {},
      }),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'starter',
            name: 'Start',
            position: { x: 100, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }),
    }))

    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
        },
      }),
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
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

    // Mock the database schema module

    // Mock drizzle-orm operators
    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      desc: vi.fn((field) => ({ field, type: 'desc' })),
      sql: vi.fn((strings, ...values) => ({ strings, values, type: 'sql' })),
    }))

    // Mock the database module with proper chainable query builder
    let selectCallCount = 0
    vi.doMock('@sim/db', () => ({
      workflow: {},
      apiKey: {},
      workflowBlocks: {},
      workflowEdges: {},
      workflowSubflows: {},
      workflowDeploymentVersion: {
        workflowId: 'workflowId',
        state: 'state',
        isActive: 'isActive',
        version: 'version',
      },
      db: {
        select: vi.fn().mockImplementation(() => {
          selectCallCount++
          const buildLimitResponse = () => ({
            limit: vi.fn().mockImplementation(() => {
              // First call: workflow lookup (should return workflow)
              if (selectCallCount === 1) {
                return Promise.resolve([{ userId: 'user-id', id: 'workflow-id' }])
              }
              // Second call: blocks lookup
              if (selectCallCount === 2) {
                return Promise.resolve([
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
                ])
              }
              // Third call: edges lookup
              if (selectCallCount === 3) {
                return Promise.resolve([])
              }
              // Fourth call: subflows lookup
              if (selectCallCount === 4) {
                return Promise.resolve([])
              }
              // Fifth call: API key lookup (should return empty for new key test)
              if (selectCallCount === 5) {
                return Promise.resolve([])
              }
              // Default: empty array
              return Promise.resolve([])
            }),
          })

          return {
            from: vi.fn().mockImplementation(() => ({
              where: vi.fn().mockImplementation(() => ({
                ...buildLimitResponse(),
                orderBy: vi.fn().mockReturnValue(buildLimitResponse()),
              })),
            })),
          }
        }),
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockResolvedValue([{ id: 'mock-api-key-id' }]),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test GET deployment status
   */
  it('should fetch deployment info successfully', async () => {
    // The global mock from mockExecutionDependencies() should handle this
    const req = createMockRequest('GET')
    const params = Promise.resolve({ id: 'workflow-id' })

    const { GET } = await import('@/app/api/workflows/[id]/deploy/route')
    const response = await GET(req, { params })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('isDeployed')
  })
})
