/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const {
  InvalidDelegationTokenError,
  mockBindExecutorDelegation,
  mockReadWorkflowDefinition,
  mockVerifyDelegationToken,
} = vi.hoisted(() => ({
  InvalidDelegationTokenError: class InvalidDelegationTokenError extends Error {},
  mockBindExecutorDelegation: vi.fn(),
  mockReadWorkflowDefinition: vi.fn(),
  mockVerifyDelegationToken: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({
  InvalidInternalDelegationTokenError: InvalidDelegationTokenError,
  verifyInternalDelegationToken: mockVerifyDelegationToken,
}))

vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: mockBindExecutorDelegation,
  InvalidInternalDelegationBindingError: class InvalidInternalDelegationBindingError extends Error {},
}))

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

const DEPLOYED_STATE = {
  blocks: { 'block-1': { id: 'block-1', type: 'starter' } },
  edges: [],
  loops: {},
  parallels: {},
  variables: {},
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
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue(SESSION)
    mockReadWorkflowDefinition.mockResolvedValue(readResult())
    mockVerifyDelegationToken.mockResolvedValue({
      subjectUserId: 'user-123',
      workflowId: 'origin-workflow',
      executionId: 'origin-run',
    })
    mockBindExecutorDelegation.mockResolvedValue(EXECUTOR_PRINCIPAL)
  })

  it('passes the authenticated session principal through the application use case', async () => {
    const response = await GET(createRequest(), routeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ deployedState: DEPLOYED_STATE })
    expect(mockReadWorkflowDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'user-123', sessionId: 'session-123' },
        input: { workflowId: 'workflow-123', state: 'deployed' },
      })
    )
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
    mockVerifyDelegationToken.mockRejectedValue(new InvalidDelegationTokenError())

    const response = await GET(createRequest('invalid-token'), routeParams())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' })
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
    expect(mockReadWorkflowDefinition).not.toHaveBeenCalled()
  })

  it('projects application authorization failures without loading state in the route', async () => {
    mockReadWorkflowDefinition.mockRejectedValue(
      new OrchestrationError('forbidden', 'Delegated workflow access is no longer valid')
    )

    const response = await GET(createRequest('signed-token'), routeParams())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Delegated workflow access is no longer valid',
    })
  })

  it('preserves null deployed state and disables caching', async () => {
    mockReadWorkflowDefinition.mockResolvedValue(readResult(null))

    const response = await GET(createRequest(), routeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ deployedState: null })
    expect(response.headers.get('cache-control')).toBe(
      'no-store, no-cache, must-revalidate, max-age=0'
    )
  })
})
