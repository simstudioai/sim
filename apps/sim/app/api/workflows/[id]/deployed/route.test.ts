import { authMockFns } from '@sim/testing'
import {
  authInternalMock,
  authInternalMockFns,
  MockInvalidInternalDelegationTokenError,
} from '@sim/testing/mocks/auth-internal.mock'
import {
  authInternalDelegationMock,
  authInternalDelegationMockFns,
} from '@sim/testing/mocks/auth-internal-delegation.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadWorkflowDefinition } = vi.hoisted(() => ({
  mockReadWorkflowDefinition: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => authInternalMock)

vi.mock('@/lib/auth/internal-delegation', () => authInternalDelegationMock)

vi.mock('@/lib/workflows/application/read-workflow-definition', () => {
  const operation = {
    id: 'workflows.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
    delegatedServices: ['copilot', 'executor'],
  } as const
  return {
    readWorkflowDefinition: { operation, execute: mockReadWorkflowDefinition },
  }
})

import { GET } from '@/app/api/workflows/[id]/deployed/route'

const { mockBindInternalExecutorDelegation: mockBindExecutorDelegation } =
  authInternalDelegationMockFns
const { mockVerifyInternalDelegationToken: mockVerifyDelegationToken } = authInternalMockFns

const DEPLOYED_STATE = {
  blocks: { 'block-1': { id: 'block-1', type: 'starter' } },
  edges: [],
  loops: {},
  parallels: {},
  variables: {},
  deploymentVersionId: 'deployment-version-1',
}

const SESSION = {
  user: { id: 'user-123' },
  session: { id: 'session-123' },
}

const EXECUTOR_PRINCIPAL = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  subjectUserId: 'user-123',
  workspaceId: 'workspace-456',
  delegationId: 'delegation-123',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-08-08T00:00:00.000Z'),
  expiresAt: new Date('2999-08-08T00:00:00.000Z'),
  delegationContext: {
    kind: 'workflow_execution' as const,
    workflowId: 'origin-workflow',
    executionId: 'origin-run',
  },
}

function createRequest(bearerToken?: string) {
  return new NextRequest('http://localhost:3000/api/workflows/workflow-123/deployed', {
    headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined,
  })
}

const routeParams = () => ({ params: Promise.resolve({ id: 'workflow-123' }) })

function readResult(state: typeof DEPLOYED_STATE | null = DEPLOYED_STATE) {
  return {
    workflow: { id: 'workflow-123' },
    workspaceId: 'workspace-456',
    state,
  }
}

describe('GET /api/workflows/[id]/deployed', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue(SESSION)
    mockReadWorkflowDefinition.mockResolvedValue(readResult())
    mockVerifyDelegationToken.mockResolvedValue({
      subjectUserId: 'user-123',
      workflowId: 'origin-workflow',
      executionId: 'origin-run',
    })
    mockBindExecutorDelegation.mockResolvedValue(EXECUTOR_PRINCIPAL)
  })

  it('accepts only the canonically bound executor principal for Bearer requests', async () => {
    const response = await GET(createRequest('signed-token'), routeParams())

    expect(response.status).toBe(200)
    expect(mockBindExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'origin-workflow', executionId: 'origin-run' }),
      { audience: 'sim:workflows', resourceScope: undefined }
    )
    expect(mockReadWorkflowDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: EXECUTOR_PRINCIPAL,
        input: { workflowId: 'workflow-123', state: 'deployed' },
      })
    )
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })

  it('fails closed when a Bearer delegation cannot be verified', async () => {
    mockVerifyDelegationToken.mockRejectedValue(new MockInvalidInternalDelegationTokenError())

    const response = await GET(createRequest('invalid-token'), routeParams())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' })
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
    expect(mockReadWorkflowDefinition).not.toHaveBeenCalled()
  })
})
