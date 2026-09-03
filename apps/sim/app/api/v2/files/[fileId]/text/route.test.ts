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
import { OrchestrationError } from '@/lib/core/orchestration/types'
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
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readText.mockResolvedValue(result())
  })

  it('returns extracted text with its quality flags', async () => {
    const response = await GET(textRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        fileId: FILE_ID,
        name: 'notes.txt',
        path: 'files/notes.txt',
        type: 'text/plain',
        text: 'hello there!',
        truncated: false,
        degraded: false,
        degradedReason: null,
        charCount: 12,
        byteCount: 12,
      },
    })
  })

  /**
   * `degraded` must be present on every response, not only degraded ones: an
   * omittable field lets a client that never checks it treat guessed text as
   * extracted text, which is the whole hazard.
   */
  it('always emits degraded, even on a clean extraction', async () => {
    const response = await GET(textRequest(), context)
    const body = await response.json()

    expect(body.data).toHaveProperty('degraded')
    expect(typeof body.data.degraded).toBe('boolean')
  })

  it('carries a degraded extraction and its reason to the wire', async () => {
    mocks.readText.mockResolvedValueOnce(
      result({
        file: { id: FILE_ID, name: 'legacy.doc', type: 'application/msword' },
        text: 'Unable to extract text from DOC file.',
        degraded: true,
        degradedReason: 'Basic text extraction used. For better results, convert to DOCX format.',
      })
    )

    const response = await GET(textRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.degraded).toBe(true)
    expect(body.data.degradedReason).toContain('Basic text extraction used')
  })

  it('reports parser truncation', async () => {
    mocks.readText.mockResolvedValueOnce(result({ text: 'partial', truncated: true }))

    const body = await (await GET(textRequest(), context)).json()

    expect(body.data.truncated).toBe(true)
    expect(body.data.charCount).toBe('partial'.length)
  })

  it('forwards a caller maxBytes to the use case', async () => {
    await GET(textRequest(`workspaceId=${WORKSPACE_ID}&maxBytes=4096`), context)

    expect(mocks.readText).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { workspaceId: WORKSPACE_ID, reference: FILE_ID, maxBytes: 4096 },
      })
    )
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

  it('rejects a query with an undeclared key', async () => {
    const response = await GET(textRequest(`workspaceId=${WORKSPACE_ID}&format=html`), context)

    expect(response.status).toBe(400)
    expect(mocks.readText).not.toHaveBeenCalled()
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

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(textRequest(), context)

    expect(response.status).toBe(401)
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

  it('surfaces an unsupported type as 400 naming the download endpoint', async () => {
    mocks.readText.mockRejectedValueOnce(
      new OrchestrationError(
        'validation',
        `Text extraction is not supported for "photo.heic"; download the raw bytes with GET /api/v2/files/${FILE_ID}`
      )
    )

    const response = await GET(textRequest(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain(`GET /api/v2/files/${FILE_ID}`)
  })

  it('surfaces an oversized source as 413 without Retry-After', async () => {
    mocks.readText.mockRejectedValueOnce(
      new OrchestrationError('payload_too_large', 'above the 25 MB text-extraction limit')
    )

    const response = await GET(textRequest(), context)

    expect(response.status).toBe(413)
    expect(response.headers.get('Retry-After')).toBeNull()
  })
})
