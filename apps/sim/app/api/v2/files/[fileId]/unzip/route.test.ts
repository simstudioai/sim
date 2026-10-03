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
import { ArchiveError } from '@/lib/uploads/archive'
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

  it('conceals a cross-tenant archive as a missing file', async () => {
    mocks.extract.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'File not found' },
    })
  })

  /**
   * Every v2 policy already renders an `OrchestrationError`, but the extraction
   * use case does not only raise those: a payload it cannot
   * parse or that busts a cap raises `ArchiveError`, and with no arm for that
   * class the route answered `500`. The internal extract route beside it has
   * mapped these all along, so the two disagreed about whose fault a bad
   * archive was.
   */
  it('renders a malformed archive as 400 rather than a server fault', async () => {
    mocks.extract.mockRejectedValueOnce(
      new ArchiveError(
        'invalid',
        'Not a valid .zip archive — its central directory could not be parsed.'
      )
    )

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('valid .zip archive')
  })

  it('renders an over-cap archive as 413 rather than a server fault', async () => {
    mocks.extract.mockRejectedValueOnce(
      new ArchiveError('too_many_entries', 'Archive has 1001 files; the maximum is 1000.')
    )

    const response = await POST(unzipRequest(), context)

    expect(response.status).toBe(413)
    expect((await response.json()).error.message).toContain('maximum is 1000')
  })
})
