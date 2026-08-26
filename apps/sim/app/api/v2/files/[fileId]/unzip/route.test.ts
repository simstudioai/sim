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
  extract: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/extract-workspace-file', () => ({
  extractWorkspaceFile: {
    operation: { id: 'files.extract_archive', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.extract,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/files/[fileId]/unzip/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const FILE_ID = 'wf_archive'
const context = { params: Promise.resolve({ fileId: FILE_ID }) }

const AUTH = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function unzipRequest(body: Record<string, unknown> = { workspaceId: WORKSPACE_ID }) {
  return new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/unzip`, {
    method: 'POST',
    headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v2/files/[fileId]/unzip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.extract.mockResolvedValue({
      folderName: 'archive',
      folderDisplayPath: 'Engineering/archive',
      extractedCount: 12,
      skippedCount: 2,
    })
  })

  /**
   * The widening itself: a workspace API key previously could not reach this
   * operation at all, because it was declared `['session']` only.
   */
  it('unarchives for a workspace API key', async () => {
    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { folderPath: '/Engineering/archive', extractedFileCount: 12, skippedFileCount: 2 },
    })
  })

  it('unarchives for a personal API key', async () => {
    v2RouteMocks.authenticate.mockResolvedValueOnce({
      ...AUTH,
      principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-2' },
      keyType: 'personal' as const,
    })

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(200)
  })

  /**
   * Counts and a path only. Returning the unpacked files would materialize a
   * large archive's whole contents into one response body.
   */
  it('does not return the unpacked files', async () => {
    const response = await POST(unzipRequest(), context)
    const body = await response.json()

    expect(body.data).not.toHaveProperty('files')
    expect(Object.keys(body.data).sort()).toEqual([
      'extractedFileCount',
      'folderPath',
      'skippedFileCount',
    ])
  })

  it('rejects a body with an undeclared key', async () => {
    const response = await POST(
      unzipRequest({ workspaceId: WORKSPACE_ID, destination: '/elsewhere' }),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.extract).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(401)
    expect(mocks.extract).not.toHaveBeenCalled()
  })

  it('conceals a cross-tenant archive as a missing file', async () => {
    mocks.extract.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'File not found' },
    })
  })

  /** The zip-bomb and size guards must still surface, not be softened. */
  it('surfaces the archive size ceiling as 413', async () => {
    mocks.extract.mockRejectedValueOnce(
      new OrchestrationError('payload_too_large', 'Archive exceeds the 100 MB unzip limit')
    )

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(413)
    expect((await response.json()).error.message).toContain('unzip limit')
  })

  it('surfaces a concurrent unarchive as 409', async () => {
    mocks.extract.mockRejectedValueOnce(
      new OrchestrationError('conflict', 'This archive is already being unzipped')
    )

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(409)
  })

  it('surfaces a non-archive file as 400', async () => {
    mocks.extract.mockRejectedValueOnce(
      new OrchestrationError('validation', 'Only .zip files can be unzipped')
    )

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(400)
  })
})
