/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelectLimit,
  mockReleaseExecutionSlot,
  mockTryAdmit,
  mockPreprocessExecution,
  mockExecuteWorkflowCore,
  mockHandlePostExecutionPauseState,
  mockLoadDeployedWorkflowState,
  mockMarkAsFailed,
  mockWaitForPostExecution,
  mockCreateTimeoutAbortController,
} = vi.hoisted(() => {
  const mockSelectLimit = vi.fn()
  const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }))
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }))
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }))
  return {
    mockSelectLimit,
    mockSelectWhere,
    mockSelectFrom,
    mockSelect,
    mockReleaseExecutionSlot: vi.fn(),
    mockTryAdmit: vi.fn(() => ({ release: vi.fn() })),
    mockPreprocessExecution: vi.fn(),
    mockExecuteWorkflowCore: vi.fn(),
    mockHandlePostExecutionPauseState: vi.fn(),
    mockLoadDeployedWorkflowState: vi.fn(),
    mockMarkAsFailed: vi.fn(),
    mockWaitForPostExecution: vi.fn(),
    mockCreateTimeoutAbortController: vi.fn(() => ({
      signal: new AbortController().signal,
      abort: vi.fn(),
      cleanup: vi.fn(),
      isTimedOut: () => false,
      timeoutMs: 30_000,
    })),
  }
})

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectLimit,
        }),
      }),
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflowInterface: {
    identifier: 'identifier',
    archivedAt: 'archivedAt',
    isActive: 'isActive',
  },
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: () => 'validation error',
  parseRequest: async (
    _contract: unknown,
    request: Request,
    context: { params: Promise<{ identifier: string }> }
  ) => {
    const body = await request.json()
    const params = await context.params
    return {
      success: true,
      data: {
        params,
        body,
      },
    }
  },
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: mockTryAdmit,
  admissionRejectedResponse: () =>
    new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}))

vi.mock('@/lib/core/execution-limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core/execution-limits')>()
  return {
    ...actual,
    createTimeoutAbortController: mockCreateTimeoutAbortController,
    getTimeoutErrorMessage: () => 'Request timed out after 30000ms',
  }
})

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: () => 'req-1',
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: mockPreprocessExecution,
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: mockHandlePostExecutionPauseState,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mockLoadDeployedWorkflowState,
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    markAsFailed = mockMarkAsFailed
    waitForPostExecution = mockWaitForPostExecution
  },
}))

vi.mock('@sim/utils/id', () => ({
  generateId: () => 'exec-1',
}))

vi.mock('@/lib/interfaces/spec/api-start-input', () => ({
  resolveApiStartInput: () => ({
    ok: true,
    data: { fields: [], blockId: 'start', path: 'api', rawFields: [] },
  }),
}))

vi.mock('@/lib/interfaces', async () => {
  const actual = await vi.importActual<typeof import('@/lib/interfaces')>('@/lib/interfaces')
  return {
    ...actual,
    validateInterfaceSpec: () => ({
      success: true,
      spec: {
        version: 1,
        theme: {},
        page: {},
        sections: [],
        actions: [{ id: 'run', label: 'Run', variant: 'primary', submit: { fieldMapping: {} } }],
      },
    }),
    buildExecutePayload: () => ({ success: true, payload: {} }),
    workflowHasHitlBlocks: () => false,
  }
})

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: class {},
}))

import { POST } from '@/app/api/interfaces/[identifier]/route'

const buttonSpec = {
  version: 1,
  theme: {},
  page: {},
  sections: [],
  actions: [{ id: 'run', label: 'Run', variant: 'primary', submit: { fieldMapping: {} } }],
}

function makeRequest() {
  return new Request('http://localhost:3000/api/interfaces/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId: 'run', values: {} }),
  }) as never
}

describe('POST /api/interfaces/[identifier]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTryAdmit.mockReturnValue({ release: vi.fn() })
    mockSelectLimit.mockResolvedValue([
      {
        id: 'iface-1',
        workflowId: 'wf-1',
        userId: 'user-1',
        identifier: 'demo',
        authType: 'public',
        isActive: true,
        archivedAt: null,
        spec: buttonSpec,
        outputConfigs: [],
      },
    ])
    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'user-1',
      billingAttribution: {},
      workflowRecord: { workspaceId: 'ws-1', userId: 'user-1', variables: {} },
      executionTimeout: { sync: 30_000 },
    })
    mockLoadDeployedWorkflowState.mockResolvedValue({
      blocks: { start: { id: 'start', type: 'start_trigger', subBlocks: {} } },
      edges: [],
      loops: {},
      parallels: {},
      deploymentVersionId: 'dep-1',
      variables: {},
    })
  })

  it('force-fails unexpected pauses without persisting pause state', async () => {
    mockExecuteWorkflowCore.mockResolvedValue({
      success: false,
      status: 'paused',
      error: 'waiting for human',
      logs: [],
    })

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ identifier: 'demo' }),
    })

    expect(response.status).toBe(400)
    expect(mockHandlePostExecutionPauseState).not.toHaveBeenCalled()
    expect(mockMarkAsFailed).toHaveBeenCalledWith(
      'Human-in-the-loop workflows are not supported for interfaces'
    )
  })

  it('marks the logging session failed on timeout', async () => {
    mockCreateTimeoutAbortController.mockReturnValue({
      signal: new AbortController().signal,
      abort: vi.fn(),
      cleanup: vi.fn(),
      isTimedOut: () => true,
      timeoutMs: 30_000,
    })
    mockExecuteWorkflowCore.mockResolvedValue({
      success: false,
      status: 'cancelled',
      logs: [],
    })

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ identifier: 'demo' }),
    })

    expect(response.status).toBe(408)
    expect(mockMarkAsFailed).toHaveBeenCalled()
    expect(mockHandlePostExecutionPauseState).not.toHaveBeenCalled()
  })

  it('collapses execution errors to a public-safe message', async () => {
    mockExecuteWorkflowCore.mockResolvedValue({
      success: false,
      status: 'error',
      error: 'Invalid API key for OpenAI: sk-secret',
      logs: [],
      output: { secret: true },
    })

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ identifier: 'demo' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Workflow execution failed')
    expect(JSON.stringify(body)).not.toContain('sk-secret')
  })
})
