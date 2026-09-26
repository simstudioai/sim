import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  authorizeDownload: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/download-workspace-file-items', () => ({
  downloadWorkspaceFileItems: {
    operation: { id: 'files.download', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.download,
    authorize: mocks.authorizeDownload,
  },
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { Readable } from 'node:stream'
import { MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'
import { GET } from '@/app/api/v2/files/bulk-download/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const context = createRouteContext({})

const AUTH = {
  principal: createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID }),
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function downloadRequest(query = `workspaceId=${WORKSPACE_ID}&fileIds=wf_a,wf_b`) {
  return createMockRequest({
    url: `http://localhost:3000/api/v2/files/bulk-download?${query}`,
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
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.authorizeDownload.mockResolvedValue(undefined)
    storageServiceMockFns.mockDownloadFileStream.mockImplementation(async () =>
      Readable.from([Buffer.from('abc')])
    )
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

  it('splits a comma-separated selection', async () => {
    await GET(downloadRequest(`workspaceId=${WORKSPACE_ID}&fileIds=wf_a,%20wf_b`), context)

    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ fileIds: ['wf_a', 'wf_b'] }) })
    )
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

  /**
   * `headSafe: false`: a HEAD authorizes and answers bodiless without building
   * the archive, so it records no audit event.
   */
  it('answers an authorized HEAD bodiless without archiving', async () => {
    const response = await GET(
      createMockRequest({
        method: 'HEAD',
        url: `http://localhost:3000/api/v2/files/bulk-download?workspaceId=${WORKSPACE_ID}&fileIds=wf_a`,
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.authorizeDownload).toHaveBeenCalledOnce()
  })
})
