import { NextRequest } from 'next/server'
import { vi } from 'vitest'

/**
 * Mock sample workflow state for testing
 */
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

/**
 * Mock database with test data
 */
export function mockDb() {
  return {
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
  }
}

/**
 * Mock environment variables for testing
 */
export const mockEnvironmentVars = {
  OPENAI_API_KEY: 'encrypted:openai-api-key',
  SERPER_API_KEY: 'encrypted:serper-api-key',
}

/**
 * Mock decrypted environment variables for testing
 */
export const mockDecryptedEnvVars = {
  OPENAI_API_KEY: 'sk-test123',
  SERPER_API_KEY: 'serper-test123',
}

/**
 * Create mock Next.js request for testing
 */
export function createMockRequest(
  method: string = 'GET',
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

/**
 * Mock the executeWorkflow function dependencies
 */
export function mockExecutionDependencies() {
  // Mock decryptSecret function
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

  // Mock execution logger functions
  vi.mock('@/lib/logs/execution-logger', () => ({
    persistExecutionLogs: vi.fn().mockResolvedValue(undefined),
    persistExecutionError: vi.fn().mockResolvedValue(undefined),
  }))

  // Mock trace spans builder
  vi.mock('@/lib/logs/trace-spans', () => ({
    buildTraceSpans: vi.fn().mockReturnValue({
      traceSpans: [],
      totalDuration: 100,
    }),
  }))

  // Mock workflow utils
  vi.mock('@/lib/workflows/utils', () => ({
    updateWorkflowRunCounts: vi.fn().mockResolvedValue(undefined),
  }))

  // Mock serializer
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

  // Mock executor
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

  // Mock database
  vi.mock('@/db', () => ({
    db: mockDb(),
  }))
}

/**
 * Mock the workflow access validation middleware
 */
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

/**
 * Get mocked dependencies for validation
 */
export async function getMockedDependencies() {
  // Using dynamic imports to avoid module resolution issues
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
