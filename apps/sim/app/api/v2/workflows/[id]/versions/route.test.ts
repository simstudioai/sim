/**
 * @vitest-environment node
 *
 * Public v2 deployment-version listing: the 404 mask on an access failure, the
 * public projection (no raw `createdBy` user id), and the version-keyed cursor.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetActiveWorkflowRecord,
  mockListWorkflowVersions,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetActiveWorkflowRecord: vi.fn(),
  mockListWorkflowVersions: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  getActiveWorkflowRecord: mockGetActiveWorkflowRecord,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  listWorkflowVersions: mockListWorkflowVersions,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/workflows/[id]/versions/route'

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

function buildVersion(version: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `dv-${version}`,
    version,
    name: null,
    description: null,
    isActive: false,
    createdAt: new Date(`2024-01-0${version}T00:00:00Z`),
    createdBy: 'user-9',
    deployedByName: 'Ada Lovelace',
    latestOperationStatus: null,
    ...overrides,
  }
}

const routeContext = () => ({ params: Promise.resolve({ id: 'wf-1' }) })
const callGet = (query = '') =>
  GET(
    new NextRequest(`http://localhost:3000/api/v2/workflows/wf-1/versions${query}`),
    routeContext()
  )

describe('GET /api/v2/workflows/[id]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    mockListWorkflowVersions.mockResolvedValue({
      versions: [
        buildVersion(3, {
          isActive: true,
          name: 'Escalation branch',
          latestOperationStatus: 'active',
        }),
        buildVersion(2),
        buildVersion(1),
      ],
    })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockListWorkflowVersions).not.toHaveBeenCalled()
  })

  it('400s on an out-of-range limit', async () => {
    const res = await callGet('?limit=0')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListWorkflowVersions).not.toHaveBeenCalled()
  })

  it('masks an access-denied failure as 404 so existence is not leaked', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect(mockListWorkflowVersions).not.toHaveBeenCalled()
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
    expect(mockListWorkflowVersions).not.toHaveBeenCalled()
  })

  it('returns the public version shape newest-first, without the raw creator id', async () => {
    const res = await callGet()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toHaveLength(3)
    expect(body.data[0]).toEqual({
      id: 'dv-3',
      version: 3,
      name: 'Escalation branch',
      description: null,
      isActive: true,
      createdAt: '2024-01-03T00:00:00.000Z',
      deployedBy: 'Ada Lovelace',
      latestOperationStatus: 'active',
    })
    expect(body.data[0]).not.toHaveProperty('createdBy')
    expect(mockListWorkflowVersions).toHaveBeenCalledWith('wf-1')
  })

  it('pages with a version-keyed cursor', async () => {
    const first = await callGet('?limit=2')
    const firstBody = await first.json()

    expect(firstBody.data.map((v: { version: number }) => v.version)).toEqual([3, 2])
    expect(firstBody.nextCursor).toEqual(expect.any(String))

    const second = await callGet(`?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`)
    const secondBody = await second.json()

    expect(secondBody.data.map((v: { version: number }) => v.version)).toEqual([1])
    expect(secondBody.nextCursor).toBeNull()
  })
})
