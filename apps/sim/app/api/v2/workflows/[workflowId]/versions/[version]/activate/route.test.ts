/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  assertMutable: vi.fn(),
  activate: vi.fn(),
  findPrevious: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))
vi.mock('@/lib/workflows/orchestration', () => ({
  getWorkflowDeploymentSummary: vi.fn(),
  performActivateVersion: mocks.activate,
  performFullDeploy: vi.fn(),
  performFullUndeploy: vi.fn(),
  performRevertToVersion: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  findPreviousDeploymentVersion: mocks.findPrevious,
  updateDeploymentVersionMetadata: vi.fn(),
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { POST } from '@/app/api/v2/workflows/[workflowId]/versions/[version]/activate/route'

const personalKeyAuth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const workspaceKeyAuth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: 'workspace-1',
    keyId: 'workspace-key-1',
  },
  rateLimitSubjectIds: ['api-key:workspace-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const workflowContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Release workflow', workspaceId: 'workspace-1' },
}

async function post(version = '3', body?: unknown) {
  const request = new NextRequest(
    `http://localhost/api/v2/workflows/workflow-1/versions/${version}/activate`,
    body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
  )
  return POST(request, { params: Promise.resolve({ workflowId: 'workflow-1', version }) })
}

describe('POST /api/v2/workflows/[workflowId]/versions/[version]/activate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.assertMutable.mockResolvedValue(undefined)
    mocks.activate.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-08-01T00:00:00.000Z'),
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
  })

  it('promotes the version named by the path with an empty body', async () => {
    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: 'workflow-1',
        isDeployed: false,
        deployedAt: '2026-08-01T00:00:00.000Z',
        version: 3,
        warnings: [],
        activeDeployment: null,
        latestDeploymentAttempt: null,
      },
    })
    expect(mocks.resolveWorkflowContext).toHaveBeenCalledBefore(mocks.activate)
    expect(mocks.activate).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }))
  })

  /**
   * Activation is unconditional on the current state, unlike rollback, which
   * refuses when nothing is deployed. Nothing may consult the previous version.
   */
  it('never falls back to the previous version', async () => {
    await post()

    expect(mocks.findPrevious).not.toHaveBeenCalled()
  })

  it('rejects the rollback body rather than activating a different version', async () => {
    const response = await post('3', { version: 2 })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('rejects a fractional version in the path before any canonical load', async () => {
    const response = await post('1.5')

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
  })

  it('rejects a workspace API key before canonical loading', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

    const response = await post()

    expect(response.status).toBe(403)
    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('refuses a caller below workspace admin with 403', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

    const response = await post()

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('conceals a workflow the caller cannot reach as 404', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('maps a competing lifecycle attempt to 409', async () => {
    mocks.activate.mockResolvedValue({
      success: false,
      errorCode: 'conflict',
      error: 'A deployment is already in progress',
    })

    const response = await post()

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.message).toBe('A deployment is already in progress')
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await post()

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
