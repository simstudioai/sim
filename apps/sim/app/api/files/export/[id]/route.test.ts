import { createMockRequest } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { hybridAuthMockFns } from '@sim/testing/mocks/hybrid-auth.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { getServeStoragePrefix } from '@/lib/uploads/config'

const { mockExtractEmbeddedFileRefs } = vi.hoisted(() => ({
  mockExtractEmbeddedFileRefs: vi.fn(),
}))

/** `embedded-image-refs.test.ts` covers the grammar itself. */
function embeds(...ids: string[]) {
  mockExtractEmbeddedFileRefs.mockReturnValue({ keys: [], ids })
}

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/uploads/server/embedded-image-refs', () => ({
  extractEmbeddedFileRefs: mockExtractEmbeddedFileRefs,
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { GET } from '@/app/api/files/export/[id]/route'

const mockDownloadFile = storageServiceMockFns.mockDownloadFile
const mockGetFileMetadataById = uploadsMetadataMockFns.mockGetFileMetadataById
const mockVerifyFileAccess = filesAuthorizationMockFns.mockVerifyFileAccess
const mockCheckAuth = hybridAuthMockFns.mockCheckSessionOrInternalAuth
const mockRecordAudit = auditMockFns.mockRecordAudit

const MB = 1024 * 1024
const DOC_ID = 'doc-1'
const context = createRouteContext({ id: DOC_ID })

function request() {
  return createMockRequest('GET', undefined, {}, `http://localhost:3000/api/files/export/${DOC_ID}`)
}

function assetRecord(id: string, size: number | null) {
  return {
    id,
    key: `workspace/ws-1/${id}`,
    originalName: `${id}.png`,
    contentType: 'image/png',
    context: 'workspace',
    sizeBytes: size,
    workspaceId: 'ws-1',
  }
}

const DOC_RECORD = {
  id: DOC_ID,
  key: 'workspace/ws-1/doc.md',
  originalName: 'doc.md',
  contentType: 'text/markdown',
  context: 'workspace',
  sizeBytes: 1024,
  workspaceId: 'ws-1',
}

function assetsResolveTo(assetFor: (id: string) => unknown) {
  mockGetFileMetadataById.mockImplementation(async (id: string) =>
    id === DOC_ID ? DOC_RECORD : assetFor(id)
  )
}

beforeEach(() => {
  mockCheckAuth.mockResolvedValue({ success: true, userId: 'user-1' })
  mockVerifyFileAccess.mockResolvedValue(true)
  assetsResolveTo((id) => assetRecord(id, 1 * MB))
  mockDownloadFile.mockResolvedValue(Buffer.from('# Doc\n'))
  embeds()
})

describe('markdown export bundling', () => {
  it('keeps non-Markdown downloads as authorized serve redirects', async () => {
    mockGetFileMetadataById.mockResolvedValue({
      ...DOC_RECORD,
      originalName: 'report.pdf',
      contentType: 'application/pdf',
      context: 'chat',
    })
    const response = await GET(request(), context)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain(
      `/api/files/serve/${getServeStoragePrefix()}/${encodeURIComponent(DOC_RECORD.key)}`
    )
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ format: 'file', assetCount: 0 }),
      })
    )
  })

  it('rejects on declared asset bytes before downloading any of them', async () => {
    embeds('a', 'b', 'c')
    assetsResolveTo((id) => assetRecord(id, 100 * MB))

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('exceeds')
    // Only the markdown body was read; the 300 MB of assets never left storage.
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })

  it('counts the document body against the export limit, not just its assets', async () => {
    // Assets alone sit under the cap; the body is what carries the bundle over it.
    embeds('a')
    mockDownloadFile.mockResolvedValue(Buffer.alloc(2 * MB))
    assetsResolveTo((id) => assetRecord(id, 249 * MB))

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('document and its embedded files')
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })

  it('downloads large Markdown verbatim without parsing it or querying assets', async () => {
    const content = Buffer.alloc(11 * MB, 'a')
    mockDownloadFile.mockResolvedValue(content)
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).equals(content)).toBe(true)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(mockExtractEmbeddedFileRefs).not.toHaveBeenCalled()
    expect(mockGetFileMetadataById).toHaveBeenCalledTimes(1)
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })

  it('caps the document body read rather than loading it unbounded', async () => {
    embeds()

    await GET(request(), context)

    const bodyCall = mockDownloadFile.mock.calls.find(([options]) => options.key.endsWith('doc.md'))
    expect(bodyCall?.[0].maxBytes).toBe(250 * MB)
  })

  it('reports an oversized body as a size rejection, not a server error', async () => {
    embeds()
    mockDownloadFile.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'storage file download', maxBytes: 1 })
    )

    const response = await GET(request(), context)

    // The cap exists to produce a clear limit message; a 500 would hide it.
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('export limit')
  })

  it('caps each asset download rather than trusting its declared size', async () => {
    embeds('a')

    await GET(request(), context)

    const assetCall = mockDownloadFile.mock.calls.find(
      ([options]) => options.key === 'workspace/ws-1/a'
    )
    expect(assetCall?.[0].maxBytes).toBe(25 * MB)
  })

  it('rejects actual aggregate bytes that exceed underreported asset metadata', async () => {
    const ids = Array.from({ length: 30 }, (_, index) => `image-${index}`)
    embeds(...ids)
    assetsResolveTo((id) => assetRecord(id, 1))
    const asset = Buffer.alloc(25 * MB)
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key === DOC_RECORD.key ? Buffer.from('# Doc\n') : asset
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('exceeds')
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockDownloadFile.mock.calls.length).toBeLessThan(ids.length + 1)
  })

  it('drops an unreadable asset instead of failing the whole export', async () => {
    embeds('good', 'bad')
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) => {
      if (key.endsWith('doc.md')) return Buffer.from('# Doc\n![x](/api/files/view/good)\n')
      if (key.endsWith('bad')) throw new Error('storage down')
      return Buffer.from('png-bytes')
    })

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    expect(zip.file('assets/good.png')).not.toBeNull()
    expect(zip.file('assets/bad.png')).toBeNull()
  })

  /**
   * The two id representations have to stay distinct: metadata resolves by the stored id, while the
   * rewrite finds the embed by the spelling the document used. Collapsing them either drops the
   * asset or bundles it behind a link still pointing at the API.
   */
  it('resolves and rewrites an embed whose id is percent-encoded in the document', async () => {
    embeds('wf%5Fa')
    assetsResolveTo((id) => (id === 'wf_a' ? assetRecord(id, 1 * MB) : null))
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md')
        ? Buffer.from('# Doc\n![x](/api/files/view/wf%5Fa)\n')
        : Buffer.from('png-bytes')
    )

    const response = await GET(request(), context)

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    expect(zip.file('assets/wf_a.png')).not.toBeNull()
    const md = await zip.file('doc.md')?.async('string')
    expect(md).toContain('./assets/wf_a.png')
    expect(md).not.toContain('/api/files/view/')
  })

  it('skips an asset the caller cannot read', async () => {
    embeds('secret')
    mockVerifyFileAccess.mockImplementation(async (key: string) => !key.endsWith('secret'))

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    // Authorization is settled during metadata resolution, before any asset read.
    expect(mockDownloadFile.mock.calls.some(([options]) => options.key.endsWith('secret'))).toBe(
      false
    )
  })
})

describe('markdown export format', () => {
  async function expectPlainMarkdown(response: Response) {
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toContain('doc.md')
    expect(await response.text()).toBe('# Doc\n')
  }

  it('returns the document itself when every embed fails to download', async () => {
    embeds('a')
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) => {
      if (key.endsWith('doc.md')) return Buffer.from('# Doc\n')
      throw new Error('storage down')
    })

    await expectPlainMarkdown(await GET(request(), context))
  })

  it('bundles a zip once at least one embed resolves', async () => {
    embeds('a')

    const response = await GET(request(), context)

    expect(response.headers.get('Content-Type')).toBe('application/zip')
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    expect(zip.file('assets/a.png')).not.toBeNull()
  })
})
