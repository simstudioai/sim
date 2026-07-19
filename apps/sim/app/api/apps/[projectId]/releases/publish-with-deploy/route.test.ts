/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockGetSession = vi.fn()
const mockAssertPermission = vi.fn()
const mockPublish = vi.fn()

vi.mock('@sim/db', () => ({
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}))
vi.mock('@sim/db/schema', () => ({ appProject: {} }))
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  isNull: (value: unknown) => value,
}))
vi.mock('@/lib/auth', () => ({ getSession: (...args: unknown[]) => mockGetSession(...args) }))
vi.mock('@/lib/apps/permissions', () => ({
  assertAppPermission: (...args: unknown[]) => mockAssertPermission(...args),
}))
vi.mock('@/lib/apps/publish-with-deploy', () => ({
  publishProjectWithDeploy: (...args: unknown[]) => mockPublish(...args),
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { APP_PUBLISHED: 'app.published' },
  AuditResourceType: { APP: 'app' },
  recordAudit: vi.fn(),
}))

import { POST } from '@/app/api/apps/[projectId]/releases/publish-with-deploy/route'

function selectWithLimit(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => rows),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  return chain
}

const recovery = {
  resumed: false,
  reusedDeployments: [],
  reusedReboundRevision: false,
  reusedBuild: false,
  reusedRelease: false,
  reusedPublication: false,
}

describe('publish-with-deploy route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAssertPermission.mockResolvedValue({ ok: true })
    mockSelect.mockReturnValue(
      selectWithLimit([{ id: 'project-1', workspaceId: 'workspace-1', name: 'App' }])
    )
  })

  it('accepts old clients without operationId and preserves existing success fields', async () => {
    mockPublish.mockResolvedValue({
      ok: true,
      operationId: 'server-operation-1',
      stage: 'published',
      releaseId: 'release-1',
      revisionId: 'revision-1',
      buildId: 'build-1',
      deployments: [{ workflowId: 'workflow-1', deploymentVersionId: 'version-1' }],
      recovery,
    })
    const response = await POST(
      new NextRequest('http://localhost/api/apps/project-1/releases/publish-with-deploy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 2 }),
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) }
    )
    const json = await response.json()

    expect(mockPublish).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      operationId: undefined,
      expectedVersion: 2,
    })
    expect(json).toEqual(
      expect.objectContaining({
        releaseId: 'release-1',
        revisionId: 'revision-1',
        buildId: 'build-1',
        deployments: [{ workflowId: 'workflow-1', deploymentVersionId: 'version-1' }],
        state: 'published',
        operationId: 'server-operation-1',
        recovery,
      })
    )
  })

  it('returns the stable operation and recovery instructions on failure', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      operationId: '11111111-1111-4111-8111-111111111111',
      stage: 'building',
      error: 'build unavailable',
      code: 'BUILD_FAILED',
      status: 503,
      recoverable: true,
      retryAfterMs: 1000,
      partialDeployments: [{ workflowId: 'workflow-1', deploymentVersionId: 'version-1' }],
      recovery: { ...recovery, resumed: true, reusedDeployments: ['workflow-1'] },
    })
    const response = await POST(
      new NextRequest('http://localhost/api/apps/project-1/releases/publish-with-deploy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationId: '11111111-1111-4111-8111-111111111111',
        }),
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) }
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        operationId: '11111111-1111-4111-8111-111111111111',
        stage: 'building',
        recoverable: true,
        retryAfterMs: 1000,
      })
    )
  })
})
