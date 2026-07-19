/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceDefinition, InterfaceModule } from '@/lib/interfaces'

const {
  mockExecuteWorkflow,
  mockGetInterfaceById,
  mockReleaseExecutionSlot,
  mockValidateFormSubmission,
  InterfaceConflictErrorMock,
  InterfaceLayoutErrorMock,
  InterfaceStaleWriteErrorMock,
  InvalidModuleReferenceErrorMock,
} = vi.hoisted(() => {
  class InterfaceConflictErrorMock extends Error {
    readonly code = 'INTERFACE_EXISTS' as const
  }
  class InterfaceStaleWriteErrorMock extends Error {
    readonly code = 'INTERFACE_STALE_WRITE' as const
  }
  class InterfaceLayoutErrorMock extends Error {
    readonly code = 'INVALID_INTERFACE_LAYOUT' as const
    readonly errors: string[]
    constructor(errors: string[]) {
      super(errors.join('; '))
      this.errors = errors
    }
  }
  class InvalidModuleReferenceErrorMock extends Error {
    readonly code = 'INVALID_MODULE_REFERENCE' as const
  }
  return {
    mockExecuteWorkflow: vi.fn(),
    mockGetInterfaceById: vi.fn(),
    mockReleaseExecutionSlot: vi.fn(),
    mockValidateFormSubmission: vi.fn(),
    InterfaceConflictErrorMock,
    InterfaceLayoutErrorMock,
    InterfaceStaleWriteErrorMock,
    InvalidModuleReferenceErrorMock,
  }
})

vi.mock('@/lib/interfaces', () => ({
  getInterfaceById: mockGetInterfaceById,
  validateFormSubmission: mockValidateFormSubmission,
  InterfaceConflictError: InterfaceConflictErrorMock,
  InterfaceLayoutError: InterfaceLayoutErrorMock,
  InterfaceStaleWriteError: InterfaceStaleWriteErrorMock,
  InvalidModuleReferenceError: InvalidModuleReferenceErrorMock,
}))

vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: mockExecuteWorkflow,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from '@/app/api/interfaces/[interfaceId]/modules/[moduleId]/submit/route'

const BILLING_ATTRIBUTION = { actorUserId: 'actor-1', workspaceId: 'ws-1' }

const formModule: InterfaceModule = {
  id: 'mod-1',
  type: 'form',
  cell: { row: 0, col: 0 },
  config: {
    workflowId: 'wf-1',
    submitLabel: 'Submit',
    fields: [{ id: 'f-1', name: 'email', label: 'Email', type: 'short-text', required: true }],
  },
}

const tableModule: InterfaceModule = {
  id: 'mod-2',
  type: 'table',
  cell: { row: 0, col: 1 },
  config: { tableId: null },
}

function buildDefinition(modules: InterfaceModule[] = [formModule]): InterfaceDefinition {
  return {
    id: 'int-1',
    workspaceId: 'ws-1',
    name: 'Support desk',
    description: null,
    layout: { version: 1, modules },
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  }
}

function callPost(body: Record<string, unknown>, moduleId = 'mod-1') {
  return POST(
    createMockRequest(
      'POST',
      body,
      {},
      `http://localhost:3000/api/interfaces/int-1/modules/${moduleId}/submit`
    ),
    { params: Promise.resolve({ interfaceId: 'int-1', moduleId }) }
  )
}

const validBody = { workspaceId: 'ws-1', values: { 'f-1': 'ada@sim.ai' } }

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    userName: 'Ada',
    userEmail: 'ada@sim.ai',
    authType: 'session',
  })
  permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
  mockGetInterfaceById.mockResolvedValue(buildDefinition())
  mockValidateFormSubmission.mockReturnValue({ valid: true, input: { email: 'ada@sim.ai' } })
  executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
    success: true,
    actorUserId: 'actor-1',
    billingAttribution: BILLING_ATTRIBUTION,
    workflowRecord: {
      id: 'wf-1',
      userId: 'owner-1',
      workspaceId: 'ws-1',
      isDeployed: true,
      variables: { region: 'eu' },
    },
  })
  mockExecuteWorkflow.mockResolvedValue({
    success: true,
    output: { ticketId: 'T-42' },
    metadata: { executionId: 'exec-1' },
  })
})

describe('POST /api/interfaces/[interfaceId]/modules/[moduleId]/submit', () => {
  it('returns 401 before validating the body', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await callPost({})

    expect(response.status).toBe(401)
    expect(mockGetInterfaceById).not.toHaveBeenCalled()
  })

  it('returns 403 for a read-only member so runs cannot be billed without write access', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await callPost(validBody)

    expect(response.status).toBe(403)
    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('returns 404 when the interface belongs to another workspace', async () => {
    mockGetInterfaceById.mockResolvedValue({
      ...buildDefinition(),
      workspaceId: 'ws-other',
    })

    const response = await callPost(validBody)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Interface not found' })
  })

  it('returns 404 when the module is not on the interface', async () => {
    const response = await callPost(validBody, 'missing-module')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Module not found' })
  })

  it('returns 400 when the module is not a form', async () => {
    mockGetInterfaceById.mockResolvedValue(buildDefinition([tableModule]))

    const response = await callPost(validBody, 'mod-2')

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Module is not a form' })
  })

  it('returns 400 when the form has no connected workflow', async () => {
    mockGetInterfaceById.mockResolvedValue(
      buildDefinition([{ ...formModule, config: { ...formModule.config, workflowId: null } }])
    )

    const response = await callPost(validBody)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'This form is not connected to a workflow',
    })
    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('returns 400 with per-field details when validation fails', async () => {
    mockValidateFormSubmission.mockReturnValue({
      valid: false,
      errors: [{ fieldId: 'f-1', message: 'Email is required' }],
    })

    const response = await callPost({ workspaceId: 'ws-1', values: {} })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid form submission',
      details: [{ fieldId: 'f-1', message: 'Email is required', path: ['values', 'f-1'] }],
    })
    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('passes the preprocessing failure status and message through verbatim', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
      success: false,
      error: { message: 'Workflow is not deployed', statusCode: 403 },
    })

    const response = await callPost(validBody)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow is not deployed' })
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  it('releases the reserved billing slot when the workflow has no workspace', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'actor-1',
      billingAttribution: BILLING_ATTRIBUTION,
      workflowRecord: { id: 'wf-1', userId: 'owner-1', workspaceId: null, isDeployed: true },
    })

    const response = await callPost(validBody)

    expect(response.status).toBe(500)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith(expect.any(String))
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  it('runs the workflow with the form trigger type and a flat name-keyed input', async () => {
    const response = await callPost(validBody)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { executionId: 'exec-1', output: { ticketId: 'T-42' } },
    })

    expect(mockValidateFormSubmission).toHaveBeenCalledWith(formModule.config.fields, {
      'f-1': 'ada@sim.ai',
    })
    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      {
        id: 'wf-1',
        userId: 'owner-1',
        workspaceId: 'ws-1',
        isDeployed: true,
        variables: { region: 'eu' },
      },
      expect.any(String),
      { email: 'ada@sim.ai' },
      'actor-1',
      {
        enabled: true,
        executionMode: 'sync',
        workflowTriggerType: 'form',
        billingAttribution: BILLING_ATTRIBUTION,
      },
      expect.any(String)
    )
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('leaves the deployment and rate-limit defaults to preprocessing and enters at the start block', async () => {
    await callPost(validBody)

    const options = executionPreprocessingMockFns.mockPreprocessExecution.mock.calls[0][0]
    expect(options).toMatchObject({
      workflowId: 'wf-1',
      userId: 'user-1',
      triggerType: 'form',
      useAuthenticatedUserAsActor: true,
    })
    expect(options.checkDeployment).toBeUndefined()
    expect(options.checkRateLimit).toBeUndefined()

    const streamConfig = mockExecuteWorkflow.mock.calls[0][4]
    expect(streamConfig.triggerBlockId).toBeUndefined()
    expect(streamConfig.selectedOutputs).toBeUndefined()
  })

  it('falls back to the generated execution id when the result carries no metadata', async () => {
    mockExecuteWorkflow.mockResolvedValue({ success: true, output: {} })

    const response = await callPost(validBody)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.executionId).toEqual(expect.any(String))
    expect(payload.data.executionId).not.toBe('')
  })

  it('returns 502 with the executor message when the run fails instead of a false confirmation', async () => {
    mockExecuteWorkflow.mockResolvedValue({
      success: false,
      output: {},
      error: 'Block "Create ticket" failed: 401 Unauthorized',
      metadata: { executionId: 'exec-1' },
    })

    const response = await callPost(validBody)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Block "Create ticket" failed: 401 Unauthorized',
    })
  })

  it('falls back to a generic message when a failed run carries no error', async () => {
    mockExecuteWorkflow.mockResolvedValue({ success: false, output: {} })

    const response = await callPost(validBody)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'The connected workflow failed to run',
    })
  })

  it('accepts a paused run, which reached the workflow and awaits a resume', async () => {
    mockExecuteWorkflow.mockResolvedValue({
      success: true,
      status: 'paused',
      output: { awaiting: 'approval' },
      metadata: { executionId: 'exec-1' },
    })

    const response = await callPost(validBody)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { executionId: 'exec-1', output: { awaiting: 'approval' } },
    })
  })

  it('returns 500 without double-releasing the slot when execution throws', async () => {
    mockExecuteWorkflow.mockRejectedValue(new Error('executor exploded'))

    const response = await callPost(validBody)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to submit interface form' })
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })
})
