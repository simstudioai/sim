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
  readText: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-text', () => ({
  readWorkspaceFileText: {
    operation: { id: 'files.read_content', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.readText,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file-utils'
import { GET } from '@/app/api/v2/files/[fileId]/text/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const FILE_ID = 'wf_doc'
const context = { params: Promise.resolve({ fileId: FILE_ID }) }

const AUTH = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function textRequest(query = `workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/text?${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    file: { id: FILE_ID, name: 'notes.txt', type: 'text/plain' },
    text: 'hello there!',
    truncated: false,
    degraded: false,
    degradedReason: null,
    byteCount: 12,
    ...overrides,
  }
}

describe('GET /api/v2/files/[fileId]/text', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readText.mockResolvedValue(result())
  })

  /**
   * A Chat upload is absent from every listing, so the `uploads/<name>` path its
   * upload notice names is the only handle the model has. The path parameter
   * therefore carries a VFS reference, not only an id, and the response echoes
   * the canonical path that was read so the model sees the name it was told.
   */
  it('accepts a VFS path as the file reference and echoes the path read', async () => {
    mocks.readText.mockResolvedValueOnce(
      result({
        file: { id: 'wf_upload', name: 'face (2).png', type: 'image/png', vfsNamespace: 'uploads' },
      })
    )

    const response = await GET(textRequest(), {
      params: Promise.resolve({ fileId: 'uploads/face%20(2).png' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.readText).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspaceId: WORKSPACE_ID,
          reference: 'uploads/face%20(2).png',
          maxBytes: undefined,
        },
      })
    )
    expect(body.data).toMatchObject({
      fileId: 'wf_upload',
      name: 'face (2).png',
      path: 'uploads/face%20(2).png',
    })
  })

  it('rejects a maxBytes above the server ceiling and echoes the bound', async () => {
    const response = await GET(
      textRequest(`workspaceId=${WORKSPACE_ID}&maxBytes=${500 * 1024 * 1024}`),
      context
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(JSON.stringify(body.error.details)).toContain(
      `maxBytes cannot exceed ${MAX_TEXT_EXTRACTION_BYTES}`
    )
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('conceals a cross-tenant file as a missing file', async () => {
    mocks.readText.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(textRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'File not found' },
    })
  })
})
