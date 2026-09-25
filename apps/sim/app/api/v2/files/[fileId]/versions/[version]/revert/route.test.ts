import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revertVersion: vi.fn(),
  getUserEmailsByIds: vi.fn(),
  findUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/file-versions', () => ({
  revertWorkspaceFileVersion: {
    operation: { id: 'files.versions.revert', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.revertVersion,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  findUserEmailsByIds: mocks.findUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { POST } from '@/app/api/v2/files/[fileId]/versions/[version]/revert/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const record = {
  id: FILE_ID,
  workspaceId: WORKSPACE_ID,
  name: 'data.csv',
  key: 'workspace/ws/1-x-data.csv',
  path: '/api/files/serve/x',
  size: 8,
  type: 'text/csv',
  uploadedBy: 'user-1',
  folderId: null,
  uploadedAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-03T00:00:00Z'),
  contentUpdatedAt: new Date('2024-01-04T00:00:00Z'),
}

const versionRecord = {
  fileId: FILE_ID,
  version: 4,
  isCurrent: true,
  size: 8,
  contentType: 'text/csv',
  source: 'revert' as const,
  authorUserIds: ['user-1'],
  restoredFromVersion: 2,
  createdAt: new Date('2024-01-04T00:00:00Z'),
  updatedAt: new Date('2024-01-04T00:00:00Z'),
  supersededAt: null,
}

const callRevert = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/versions/2/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ fileId: FILE_ID, version: '2' }) }
  )

describe('POST /api/v2/files/[fileId]/versions/[version]/revert', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.revertVersion.mockResolvedValue({
      file: record,
      version: versionRecord,
      reverted: true,
      revertedFrom: 3,
    })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
    mocks.findUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  /**
   * A revert consumes the caller's revision, so the response has to issue its replacement —
   * otherwise chaining a second conditional write needs a metadata re-read, and the window
   * between the two is exactly what the revision is meant to close.
   */
  it('returns the revision naming the content the revert produced', async () => {
    const expectedRevision = workspaceFileRevision(record)!

    const response = await callRevert({ workspaceId: WORKSPACE_ID, expectedRevision })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.reverted).toBe(true)
    expect(body.data.revision).toBe(expectedRevision)
    expect(mocks.revertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          fileId: FILE_ID,
          assertedWorkspaceId: WORKSPACE_ID,
          version: 2,
          expectedRevision,
        }),
      })
    )
  })

  it('returns the current content revision when the version was already current', async () => {
    mocks.revertVersion.mockResolvedValue({
      file: record,
      version: { ...versionRecord, version: 3, source: 'api', restoredFromVersion: null },
      reverted: false,
      revertedFrom: 3,
    })

    const body = await (await callRevert({ workspaceId: WORKSPACE_ID })).json()

    expect(body.data.reverted).toBe(false)
    expect(body.data.revision).toBe(workspaceFileRevision(record))
  })
})
