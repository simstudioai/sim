import { createMockRequest } from '@sim/testing'
import {
  apiServerRoutesMock,
  apiServerRoutesMockFns,
} from '@sim/testing/mocks/api-server-routes.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  parseRequest: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: vi.fn(),
  parseRequest: mocks.parseRequest,
}))

vi.mock('@/lib/api/server/routes', () => apiServerRoutesMock)

vi.mock('@/lib/workflows/api', () => ({
  createInternalWorkflowErrorPolicy: vi.fn(() => ({
    project: vi.fn(),
    unhandled: vi.fn(),
  })),
  WORKFLOW_NOT_FOUND_MESSAGE: 'Workflow not found',
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/workflows/application/deployments', () => ({
  activateWorkflowVersion: { execute: mocks.activate },
  updateWorkflowVersion: { execute: mocks.update },
}))

vi.mock('@/lib/workflows/application/read-workflow-version', () => ({
  readWorkflowVersion: { execute: mocks.read },
}))

import { concealCrossTenantResourceError } from '@/lib/api/server/routes/resource-concealment'
import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { PATCH } from '@/app/api/workflows/[id]/deployments/[version]/route'

apiServerRoutesMockFns.mockConcealCrossTenantResourceError.mockImplementation(
  concealCrossTenantResourceError
)

const { mockInternalSessionAuthenticate } = apiServerRoutesMockFns

describe('workflow deployment version PATCH', () => {
  beforeEach(() => {
    mockInternalSessionAuthenticate.mockResolvedValue({
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    })
    mocks.activate.mockResolvedValue({
      deployedAt: new Date('2026-01-01T00:00:00Z'),
      warnings: undefined,
      activeDeployment: null,
      latestDeploymentAttempt: null,
      name: 'Release 2',
      description: 'Production',
    })
    mocks.update.mockResolvedValue({ name: 'Release 2', description: 'Production' })
  })

  it.each([
    new NoWorkspaceAccessError(),
    new WorkspaceApiKeyScopeAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
  ])('conceals a cross-tenant activation denial as an absent workflow: %s', async (error) => {
    mocks.parseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1', version: 2 }, body: { isActive: true } },
    })
    mocks.activate.mockRejectedValueOnce(error)

    const response = await PATCH(
      createMockRequest(
        'PATCH',
        undefined,
        {},
        'http://localhost/api/workflows/workflow-1/deployments/2'
      ),
      { params: Promise.resolve({ id: 'workflow-1', version: '2' }) }
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Workflow not found' })
  })

  it('keeps a same-workspace role denial on activation forbidden', async () => {
    mocks.parseRequest.mockResolvedValue({
      success: true,
      data: { params: { id: 'workflow-1', version: 2 }, body: { isActive: true } },
    })
    mocks.activate.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await PATCH(
      createMockRequest(
        'PATCH',
        undefined,
        {},
        'http://localhost/api/workflows/workflow-1/deployments/2'
      ),
      { params: Promise.resolve({ id: 'workflow-1', version: '2' }) }
    )

    expect(response.status).toBe(403)
  })
})
