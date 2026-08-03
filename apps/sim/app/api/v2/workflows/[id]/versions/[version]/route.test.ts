/**
 * @vitest-environment node
 *
 * Public v2 deployment-version detail: the 404 mask on an access failure, the
 * coerced numeric version param, and the pinned workflow state it serves.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetActiveWorkflowRecord,
  mockGetWorkflowDeploymentVersion,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetActiveWorkflowRecord: vi.fn(),
  mockGetWorkflowDeploymentVersion: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  getActiveWorkflowRecord: mockGetActiveWorkflowRecord,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  getWorkflowDeploymentVersion: mockGetWorkflowDeploymentVersion,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/workflows/[id]/versions/[version]/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 1000,
}

const ACCESS_DENIED = { status: 403, code: 'FORBIDDEN', message: 'Access denied' }

const WORKFLOW_RECORD = { id: 'wf-1', name: 'Support Agent', workspaceId: 'workspace-1' }

const DEPLOYED_STATE = { blocks: {}, edges: [], loops: {}, parallels: {} }

const VERSION_ROW = {
  id: 'dv-3',
  version: 3,
  name: 'Escalation branch',
  description: null,
  isActive: true,
  createdAt: new Date('2024-01-03T00:00:00Z'),
  state: DEPLOYED_STATE,
}

const routeContext = (version = '3') => ({ params: Promise.resolve({ id: 'wf-1', version }) })
const callGet = (version = '3') =>
  GET(
    new NextRequest(`http://localhost:3000/api/v2/workflows/wf-1/versions/${version}`),
    routeContext(version)
  )

describe('GET /api/v2/workflows/[id]/versions/[version]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    mockGetWorkflowDeploymentVersion.mockResolvedValue(VERSION_ROW)
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockGetWorkflowDeploymentVersion).not.toHaveBeenCalled()
  })

  it('400s on a non-numeric version', async () => {
    const res = await callGet('latest')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockGetWorkflowDeploymentVersion).not.toHaveBeenCalled()
  })

  it('masks an access-denied failure as 404 so existence is not leaked', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect(mockGetWorkflowDeploymentVersion).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callGet()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the workflow does not exist or is archived', async () => {
    mockGetActiveWorkflowRecord.mockResolvedValue(null)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect(mockGetWorkflowDeploymentVersion).not.toHaveBeenCalled()
  })

  it('404s when the version does not exist on this workflow', async () => {
    mockGetWorkflowDeploymentVersion.mockResolvedValue(null)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect((await res.json()).error.message).toBe('Deployment version not found')
  })

  it('returns the version with the workflow state it pins', async () => {
    const res = await callGet()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      data: {
        id: 'dv-3',
        version: 3,
        name: 'Escalation branch',
        description: null,
        isActive: true,
        createdAt: '2024-01-03T00:00:00.000Z',
        state: DEPLOYED_STATE,
      },
    })
    expect(mockGetWorkflowDeploymentVersion).toHaveBeenCalledWith('wf-1', 3)
  })
})
