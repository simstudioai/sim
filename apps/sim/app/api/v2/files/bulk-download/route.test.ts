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
  download: vi.fn(),
  authorizeDownload: vi.fn(),
  downloadFileStream: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/download-workspace-file-items', () => ({
  downloadWorkspaceFileItems: {
    operation: { id: 'files.download', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.download,
    authorize: mocks.authorizeDownload,
  },
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mocks.downloadFileStream,
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { Readable } from 'node:stream'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'
import { GET } from '@/app/api/v2/files/bulk-download/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const context = { params: Promise.resolve({}) }

const AUTH = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function downloadRequest(query = `workspaceId=${WORKSPACE_ID}&fileIds=wf_a,wf_b`) {
  return new NextRequest(`http://localhost:3000/api/v2/files/bulk-download?${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

function fileRecord(id: string, name: string) {
  return {
    id,
    name,
    key: `workspace/ws/${name}`,
    size: 3,
    type: 'text/plain',
    folderId: null,
    storageContext: 'workspace',
  }
}

describe('GET /api/v2/files/bulk-download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.authorizeDownload.mockResolvedValue(undefined)
    mocks.downloadFileStream.mockImplementation(async () => Readable.from([Buffer.from('abc')]))
    mocks.download.mockResolvedValue({
      filesToZip: [fileRecord('wf_a', 'a.txt'), fileRecord('wf_b', 'b.txt')],
      folderPaths: new Map<string, string>(),
      renderedDocuments: new Map<string, Buffer>(),
      declaredBytes: 6,
    })
  })

  it('streams the selection as a zip', async () => {
    const response = await GET(downloadRequest(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toContain('workspace-files.zip')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  /** v2 addresses folders by path; internal folder ids never cross the boundary. */
  it('passes folder paths, never folder ids', async () => {
    await GET(
      downloadRequest(`workspaceId=${WORKSPACE_ID}&folderPaths=/Engineering,/Design`),
      context
    )

    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspaceId: WORKSPACE_ID,
          fileIds: [],
          folderIds: [],
          folderPaths: ['/Engineering', '/Design'],
        },
      })
    )
  })

  it('splits a comma-separated selection', async () => {
    await GET(downloadRequest(`workspaceId=${WORKSPACE_ID}&fileIds=wf_a,%20wf_b`), context)

    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ fileIds: ['wf_a', 'wf_b'] }) })
    )
  })

  /**
   * v2 rejects a query parameter sent more than once, so the selection is
   * comma-separated only; pinned here so the contract never advertises a
   * repeated-parameter form the boundary would reject.
   */
  it('rejects a repeated selection parameter', async () => {
    const response = await GET(
      downloadRequest(`workspaceId=${WORKSPACE_ID}&fileIds=wf_a&fileIds=wf_b`),
      context
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('at most once')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  /**
   * The contract's cap is the download's real ceiling, so an over-large
   * selection is refused at the boundary rather than validating, resolving, and
   * only then failing — and the message names the field and the limit.
   */
  it('rejects a file selection above the download ceiling before it resolves', async () => {
    const tooMany = Array.from({ length: MAX_ZIP_DOWNLOAD_FILES + 1 }, (_, i) => `wf_${i}`).join(
      ','
    )

    const response = await GET(
      downloadRequest(`workspaceId=${WORKSPACE_ID}&fileIds=${tooMany}`),
      context
    )

    expect(response.status).toBe(400)
    const message = (await response.json()).error.message
    expect(message).toContain('fileIds')
    expect(message).toContain(String(MAX_ZIP_DOWNLOAD_FILES))
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.authorizeDownload).not.toHaveBeenCalled()
  })

  it('accepts a file selection exactly at the download ceiling', async () => {
    const atCap = Array.from({ length: MAX_ZIP_DOWNLOAD_FILES }, (_, i) => `wf_${i}`).join(',')

    const response = await GET(
      downloadRequest(`workspaceId=${WORKSPACE_ID}&fileIds=${atCap}`),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.download).toHaveBeenCalledOnce()
  })

  it('rejects a folder selection above the download ceiling', async () => {
    const tooMany = Array.from({ length: MAX_ZIP_DOWNLOAD_FILES + 1 }, (_, i) => `/f${i}`).join(',')

    const response = await GET(
      downloadRequest(`workspaceId=${WORKSPACE_ID}&folderPaths=${tooMany}`),
      context
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('folderPaths')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('rejects a query with an undeclared key', async () => {
    const response = await GET(
      downloadRequest(`workspaceId=${WORKSPACE_ID}&folderIds=folder-1`),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('surfaces an over-broad resolved selection as 400', async () => {
    mocks.download.mockRejectedValueOnce(
      new OrchestrationError('validation', 'Too many files selected for download.')
    )

    const response = await GET(downloadRequest(), context)

    expect(response.status).toBe(400)
  })

  it('surfaces an unresolvable folder path as 400', async () => {
    mocks.download.mockRejectedValueOnce(
      new OrchestrationError('validation', 'Folder not found: /Nope')
    )

    const response = await GET(
      downloadRequest(`workspaceId=${WORKSPACE_ID}&folderPaths=/Nope`),
      context
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('/Nope')
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(downloadRequest(), context)

    expect(response.status).toBe(401)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('answers 403 for a cross-tenant workspace', async () => {
    mocks.download.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(downloadRequest(), context)

    expect(response.status).toBe(403)
  })

  /**
   * `headSafe: false`: a HEAD authorizes and answers bodiless without building
   * the archive, so it records no audit event.
   */
  it('answers an authorized HEAD bodiless without archiving', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/files/bulk-download?workspaceId=${WORKSPACE_ID}&fileIds=wf_a`,
        { method: 'HEAD' }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.authorizeDownload).toHaveBeenCalledOnce()
  })
})
