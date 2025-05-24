import { NextRequest } from 'next/server'
import { vi } from 'vitest'

export const sampleWorkflowState = {
  blocks: {
    'starter-id': {
      id: 'starter-id',
      type: 'starter',
      name: 'Start',
      position: { x: 100, y: 100 },
      subBlocks: {
        startWorkflow: { id: 'startWorkflow', type: 'dropdown', value: 'manual' },
        webhookPath: { id: 'webhookPath', type: 'short-input', value: '' },
      },
      outputs: {
        response: { type: { input: 'any' } },
      },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 95,
    },
    'agent-id': {
      id: 'agent-id',
      type: 'agent',
      name: 'Agent 1',
      position: { x: 634, y: -167 },
      subBlocks: {
        systemPrompt: {
          id: 'systemPrompt',
          type: 'long-input',
          value: 'You are a helpful assistant',
        },
        context: { id: 'context', type: 'short-input', value: '<start.response.input>' },
        model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
        apiKey: { id: 'apiKey', type: 'short-input', value: '{{OPENAI_API_KEY}}' },
      },
      outputs: {
        response: {
          content: 'string',
          model: 'string',
          tokens: 'any',
        },
      },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 680,
    },
  },
  edges: [
    {
      id: 'edge-id',
      source: 'starter-id',
      target: 'agent-id',
      sourceHandle: 'source',
      targetHandle: 'target',
    },
  ],
  loops: {},
  lastSaved: Date.now(),
  isDeployed: false,
}

export const mockDb = {
  select: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockImplementation(() => [
          {
            id: 'workflow-id',
            userId: 'user-id',
            state: sampleWorkflowState,
          },
        ]),
      })),
    })),
  })),
  update: vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
  })),
  eq: vi.fn().mockImplementation((field, value) => ({ field, value, type: 'eq' })),
  and: vi.fn().mockImplementation((...conditions) => ({
    conditions,
    type: 'and',
  })),
}

export const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

export const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
}

export const mockSubscription = {
  id: 'sub-123',
  plan: 'enterprise',
  status: 'active',
  seats: 5,
  referenceId: 'user-123',
  metadata: {
    perSeatAllowance: 100,
    totalAllowance: 500,
    updatedAt: '2023-01-01T00:00:00.000Z',
  },
}

export const mockOrganization = {
  id: 'org-456',
  name: 'Test Organization',
  slug: 'test-org',
}

export const mockAdminMember = {
  id: 'member-123',
  userId: 'user-123',
  organizationId: 'org-456',
  role: 'admin',
}

export const mockRegularMember = {
  id: 'member-456',
  userId: 'user-123',
  organizationId: 'org-456',
  role: 'member',
}

export const mockTeamSubscription = {
  id: 'sub-456',
  plan: 'team',
  status: 'active',
  seats: 5,
  referenceId: 'org-123',
}

export const mockPersonalSubscription = {
  id: 'sub-789',
  plan: 'enterprise',
  status: 'active',
  seats: 5,
  referenceId: 'user-123',
  metadata: {
    perSeatAllowance: 100,
    totalAllowance: 500,
    updatedAt: '2023-01-01T00:00:00.000Z',
  },
}

export const mockEnvironmentVars = {
  OPENAI_API_KEY: 'encrypted:openai-api-key',
  SERPER_API_KEY: 'encrypted:serper-api-key',
}

export const mockDecryptedEnvVars = {
  OPENAI_API_KEY: 'sk-test123',
  SERPER_API_KEY: 'serper-test123',
}

export function createMockRequest(
  method = 'GET',
  body?: any,
  headers: Record<string, string> = {}
): NextRequest {
  const url = 'http://localhost:3000/api/test'

  // Use the URL constructor to create a proper URL object
  return new NextRequest(new URL(url), {
    method,
    headers: new Headers(headers),
    body: body ? JSON.stringify(body) : undefined,
  })
}

export function mockExecutionDependencies() {
  vi.mock('@/lib/utils', async () => {
    const actual = await vi.importActual('@/lib/utils')
    return {
      ...(actual as any),
      decryptSecret: vi.fn().mockImplementation((encrypted: string) => {
        // Map from encrypted to decrypted
        const entries = Object.entries(mockEnvironmentVars)
        const found = entries.find(([_, val]) => val === encrypted)
        const key = found ? found[0] : null

        return Promise.resolve({
          decrypted:
            key && key in mockDecryptedEnvVars
              ? mockDecryptedEnvVars[key as keyof typeof mockDecryptedEnvVars]
              : 'decrypted-value',
        })
      }),
    }
  })

  vi.mock('@/lib/logs/execution-logger', () => ({
    persistExecutionLogs: vi.fn().mockResolvedValue(undefined),
    persistExecutionError: vi.fn().mockResolvedValue(undefined),
  }))

  vi.mock('@/lib/logs/trace-spans', () => ({
    buildTraceSpans: vi.fn().mockReturnValue({
      traceSpans: [],
      totalDuration: 100,
    }),
  }))

  vi.mock('@/lib/workflows/utils', () => ({
    updateWorkflowRunCounts: vi.fn().mockResolvedValue(undefined),
  }))

  vi.mock('@/serializer', () => ({
    Serializer: vi.fn().mockImplementation(() => ({
      serializeWorkflow: vi.fn().mockReturnValue({
        version: '1.0',
        blocks: [
          {
            id: 'starter-id',
            metadata: { id: 'starter', name: 'Start' },
            config: {},
            inputs: {},
            outputs: {},
            position: { x: 100, y: 100 },
            enabled: true,
          },
          {
            id: 'agent-id',
            metadata: { id: 'agent', name: 'Agent 1' },
            config: {},
            inputs: {},
            outputs: {},
            position: { x: 634, y: -167 },
            enabled: true,
          },
        ],
        connections: [
          {
            source: 'starter-id',
            target: 'agent-id',
          },
        ],
        loops: {},
      }),
    })),
  }))

  vi.mock('@/executor', () => ({
    Executor: vi.fn().mockImplementation(() => ({
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: {
          response: {
            content: 'This is a test response',
            model: 'gpt-4o',
          },
        },
        logs: [],
        metadata: {
          duration: 1000,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
        },
      }),
    })),
  }))

  vi.mock('@/db', () => ({
    db: mockDb,
  }))
}

export function mockWorkflowAccessValidation(shouldSucceed = true) {
  if (shouldSucceed) {
    vi.mock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
          state: sampleWorkflowState,
        },
      }),
    }))
  } else {
    vi.mock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        error: {
          message: 'Access denied',
          status: 403,
        },
      }),
    }))
  }
}

export async function getMockedDependencies() {
  const utilsModule = await import('@/lib/utils')
  const logsModule = await import('@/lib/logs/execution-logger')
  const traceSpansModule = await import('@/lib/logs/trace-spans')
  const workflowUtilsModule = await import('@/lib/workflows/utils')
  const executorModule = await import('@/executor')
  const serializerModule = await import('@/serializer')
  const dbModule = await import('@/db')

  return {
    decryptSecret: utilsModule.decryptSecret,
    persistExecutionLogs: logsModule.persistExecutionLogs,
    persistExecutionError: logsModule.persistExecutionError,
    buildTraceSpans: traceSpansModule.buildTraceSpans,
    updateWorkflowRunCounts: workflowUtilsModule.updateWorkflowRunCounts,
    Executor: executorModule.Executor,
    Serializer: serializerModule.Serializer,
    db: dbModule.db,
  }
}

export function mockScheduleStatusDb({
  schedule = [
    {
      id: 'schedule-id',
      workflowId: 'workflow-id',
      status: 'active',
      failedCount: 0,
      lastRanAt: new Date('2024-01-01T00:00:00.000Z'),
      lastFailedAt: null,
      nextRunAt: new Date('2024-01-02T00:00:00.000Z'),
    },
  ],
  workflow = [
    {
      userId: 'user-id',
    },
  ],
}: {
  schedule?: any[]
  workflow?: any[]
} = {}) {
  vi.doMock('@/db', () => {
    let callCount = 0

    const select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            callCount += 1
            if (callCount === 1) return schedule
            if (callCount === 2) return workflow
            return []
          }),
        })),
      })),
    }))

    return {
      db: { select },
    }
  })
}

export function mockScheduleExecuteDb({
  schedules = [] as any[],
  workflowRecord = {
    id: 'workflow-id',
    userId: 'user-id',
    state: sampleWorkflowState,
  },
  envRecord = {
    userId: 'user-id',
    variables: {
      OPENAI_API_KEY: 'encrypted:openai-api-key',
      SERPER_API_KEY: 'encrypted:serper-api-key',
    },
  },
}: {
  schedules?: any[]
  workflowRecord?: any
  envRecord?: any
}): void {
  vi.doMock('@/db', () => {
    const select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: any) => {
        const tbl = String(table)
        if (tbl === 'workflow_schedule' || tbl === 'schedule') {
          return {
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => schedules),
            })),
          }
        }

        if (tbl === 'workflow') {
          return {
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => [workflowRecord]),
            })),
          }
        }

        if (tbl === 'environment') {
          return {
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => [envRecord]),
            })),
          }
        }

        return {
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => []),
          })),
        }
      }),
    }))

    const update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    }))

    return { db: { select, update } }
  })
}
