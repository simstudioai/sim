/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capture: vi.fn(),
  defineRoute: vi.fn((definition) => definition),
  deleteWorkflow: vi.fn(),
  parseRequest: vi.fn(),
  readWorkflow: vi.fn(),
  updatePolicy: vi.fn(),
  updateWorkflow: vi.fn(),
}))

vi.mock('@/lib/api/server', () => ({ parseRequest: mocks.parseRequest }))

vi.mock('@/lib/api/server/routes', async () => {
  const { concealCrossTenantResourceError } = await import(
    '@/lib/api/server/routes/resource-concealment'
  )
  return {
    concealCrossTenantResourceError,
    defineInternalJsonRoute: mocks.defineRoute,
    InternalUnauthenticatedError: class InternalUnauthenticatedError extends Error {},
    internalOrchestrationErrorPolicy: { kind: 'plain-orchestration' },
    internalRateLimits: { none: vi.fn(() => ({ kind: 'none' })) },
  }
})

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

vi.mock('@/lib/workflows/api', () => ({
  internalWorkflowErrorPolicies: {
    concealWorkflowAuthorization: { kind: 'conceal-workflow-authorization' },
  },
  internalWorkflowReadAuth: { authenticate: mocks.auth },
  internalWorkflowSessionOrExecutorAuth: { authenticate: mocks.auth },
  WORKFLOW_NOT_FOUND_MESSAGE: 'Workflow not found',
}))

vi.mock('@/lib/workflows/application/read-workflow-definition', () => ({
  readWorkflowDefinition: {
    operation: { id: 'workflows.read' },
    execute: mocks.readWorkflow,
  },
}))

vi.mock('@/lib/workflows/application/delete-workflow', () => ({
  deleteWorkflow: {
    operation: { id: 'workflows.delete' },
    execute: mocks.deleteWorkflow,
  },
}))

vi.mock('@/lib/workflows/application/update-workflow', () => ({
  updateWorkflow: {
    operation: { id: 'workflows.update' },
    execute: mocks.updateWorkflow,
  },
  updateWorkflowPolicy: {
    operation: { id: 'workflows.policy.update' },
    execute: mocks.updatePolicy,
  },
}))

import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { DELETE, GET, PUT } from '@/app/api/workflows/[id]/route'

const sessionPrincipal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}

describe('/api/workflows/[id] application adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(sessionPrincipal)
    mocks.updateWorkflow.mockResolvedValue({
      workflow: { id: 'workflow-1', name: 'Renamed', locked: false, forkSyncExcluded: false },
      workspaceId: 'workspace-1',
      changes: ['name'],
    })
    mocks.updatePolicy.mockResolvedValue({
      workflow: { id: 'workflow-1', name: 'Workflow', locked: true, forkSyncExcluded: false },
      workspaceId: 'workspace-1',
      changes: ['locked'],
    })
  })

  it('binds GET and DELETE directly to fixed application use cases', () => {
    expect(GET).toMatchObject({
      operation: { id: 'workflows.read' },
      useCase: { operation: { id: 'workflows.read' } },
    })
    expect(Reflect.get(GET, 'mapInput')({ params: { id: 'workflow-1' } })).toEqual({
      workflowId: 'workflow-1',
      state: 'draft',
    })

    expect(DELETE).toMatchObject({
      operation: { id: 'workflows.delete' },
      useCase: { operation: { id: 'workflows.delete' } },
    })
    expect(Reflect.get(DELETE, 'mapInput')({ params: { id: 'workflow-1' } })).toEqual({
      workflowId: 'workflow-1',
    })

    for (const handler of [GET, DELETE]) {
      expect(Reflect.get(handler, 'errorPolicy')).toMatchObject({
        kind: 'conceal-workflow-authorization',
      })
    }
  })

  it('keeps human delete analytics surface-specific and no-op aware', async () => {
    const onSuccess = Reflect.get(DELETE, 'onSuccess')
    await onSuccess({
      principal: sessionPrincipal,
      result: { archived: false, workflowId: 'workflow-1', workspaceId: 'workspace-1' },
    })
    expect(mocks.capture).not.toHaveBeenCalled()

    await onSuccess({
      principal: sessionPrincipal,
      result: { archived: true, workflowId: 'workflow-1', workspaceId: 'workspace-1' },
    })
    expect(mocks.capture).toHaveBeenCalledOnce()
  })

  it('selects one fixed update command without route-owned resource work', async () => {
    mocks.parseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1' }, body: { name: 'Renamed' } },
    })

    const response = await PUT(createMockRequest('PUT', { name: 'Renamed' }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.updateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: sessionPrincipal,
        input: { workflowId: 'workflow-1', name: 'Renamed' },
      })
    )
    expect(mocks.updatePolicy).not.toHaveBeenCalled()
  })

  it('uses the dedicated policy command and emits only human product analytics', async () => {
    mocks.parseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1' }, body: { locked: true } },
    })

    const response = await PUT(createMockRequest('PUT', { locked: true }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.updatePolicy).toHaveBeenCalledOnce()
    expect(mocks.updateWorkflow).not.toHaveBeenCalled()
    expect(mocks.capture).toHaveBeenCalledWith(
      'user-1',
      'workflow_lock_toggled',
      expect.objectContaining({ workflow_id: 'workflow-1', locked: true }),
      expect.any(Object)
    )
  })

  it.each([
    new NoWorkspaceAccessError(),
    new WorkspaceApiKeyScopeAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
  ])('conceals a cross-tenant update denial as an absent workflow: %s', async (error) => {
    mocks.parseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1' }, body: { name: 'Renamed' } },
    })
    mocks.updateWorkflow.mockRejectedValueOnce(error)

    const response = await PUT(createMockRequest('PUT', { name: 'Renamed' }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Workflow not found' })
  })

  it('keeps a same-workspace role denial on update forbidden', async () => {
    mocks.parseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1' }, body: { name: 'Renamed' } },
    })
    mocks.updateWorkflow.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await PUT(createMockRequest('PUT', { name: 'Renamed' }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Insufficient workspace permissions' })
  })

  it('projects unknown update failures safely', async () => {
    mocks.parseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1' }, body: { name: 'Renamed' } },
    })
    mocks.updateWorkflow.mockRejectedValueOnce(new Error('postgres password=secret'))

    const response = await PUT(createMockRequest('PUT', { name: 'Renamed' }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error' })
  })
})
