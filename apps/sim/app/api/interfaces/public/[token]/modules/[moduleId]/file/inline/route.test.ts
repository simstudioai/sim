/**
 * @vitest-environment node
 *
 * The inline route is the only place a share token grants bytes it was not
 * directly pointed at, so it is the one place the capability could widen into a
 * general workspace read. §2.6 holds it behind three gates that must all stay:
 * referenced-by-doc, same-workspace, and content-truth (`sniff`).
 */
import { auditMock, auditMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnforcePerIp,
  mockEnforcePerShare,
  mockResolvePublicInterfaceModule,
  mockGetWorkspaceFile,
  mockDownloadFile,
  mockExtractEmbeddedImageIds,
  mockExtractEmbeddedImageKeys,
  mockResolveWorkspaceInlineImage,
  mockServeInlineImage,
} = vi.hoisted(() => ({
  mockEnforcePerIp: vi.fn(),
  mockEnforcePerShare: vi.fn(),
  mockResolvePublicInterfaceModule: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockExtractEmbeddedImageIds: vi.fn(),
  mockExtractEmbeddedImageKeys: vi.fn(),
  mockResolveWorkspaceInlineImage: vi.fn(),
  mockServeInlineImage: vi.fn(),
}))

vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePerIpRateLimit: mockEnforcePerIp,
  enforcePerShareRateLimit: mockEnforcePerShare,
}))

vi.mock('@/lib/public-shares/interface-access', () => ({
  resolvePublicInterfaceModule: mockResolvePublicInterfaceModule,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
}))

vi.mock('@/lib/copilot/tools/server/files/embedded-image-refs', () => ({
  extractEmbeddedImageIds: mockExtractEmbeddedImageIds,
  extractEmbeddedImageKeys: mockExtractEmbeddedImageKeys,
}))

vi.mock('@/lib/uploads/server/inline-image', () => ({
  resolveWorkspaceInlineImage: mockResolveWorkspaceInlineImage,
}))

vi.mock('@/app/api/files/serve-inline-image', () => ({
  serveInlineImage: mockServeInlineImage,
}))

vi.mock('@sim/audit', () => auditMock)

import { GET } from '@/app/api/interfaces/public/[token]/modules/[moduleId]/file/inline/route'

const TOKEN = 'tok_1'
const MODULE_ID = 'mod-file'
const WS = 'ws-a'
const DOC_ID = 'doc-stored'
const EMBED_ID = 'img-embedded'

const params = (token = TOKEN, moduleId = MODULE_ID) => ({
  params: Promise.resolve({ token, moduleId }),
})

const request = (query = `?fileId=${EMBED_ID}`) =>
  new NextRequest(
    `http://localhost/api/interfaces/public/${TOKEN}/modules/${MODULE_ID}/file/inline${query}`
  )

const fileModule = {
  id: MODULE_ID,
  type: 'file' as const,
  placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  config: { fileId: DOC_ID },
}

const access = {
  share: { id: 'sh_1', token: TOKEN, authType: 'public', password: null },
  definition: {
    id: 'int-a',
    workspaceId: WS,
    name: 'Support desk',
    description: null,
    layout: { version: 1, grid: { rows: 2, cols: 2 }, modules: [fileModule] },
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  },
  workspaceId: WS,
  module: fileModule,
  resource: { type: 'file' as const, id: DOC_ID },
}

describe('GET /api/interfaces/public/[token]/modules/[moduleId]/file/inline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforcePerIp.mockResolvedValue(null)
    mockEnforcePerShare.mockResolvedValue(null)
    mockResolvePublicInterfaceModule.mockResolvedValue({ ok: true, access })
    mockGetWorkspaceFile.mockResolvedValue({
      id: DOC_ID,
      workspaceId: WS,
      name: 'handbook.md',
      key: 'workspace/ws-a/handbook.md',
      uploadedBy: 'user-1',
    })
    mockDownloadFile.mockResolvedValue(Buffer.from(`![alt](${EMBED_ID})`))
    mockExtractEmbeddedImageIds.mockReturnValue([EMBED_ID])
    mockExtractEmbeddedImageKeys.mockReturnValue([])
    mockResolveWorkspaceInlineImage.mockResolvedValue({
      filename: 'diagram.png',
      key: 'workspace/ws-a/diagram.png',
    })
    mockServeInlineImage.mockResolvedValue(new NextResponse(Buffer.from('png'), { status: 200 }))
  })

  it('returns 429 before the authorization chain runs', async () => {
    mockEnforcePerIp.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await GET(request(), params())
    expect(res.status).toBe(429)
    expect(mockResolvePublicInterfaceModule).not.toHaveBeenCalled()
  })

  it('uses the content rate-limit scope and consumes the per-IP bucket once', async () => {
    await GET(request(), params())
    expect(mockEnforcePerIp).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerIp).toHaveBeenCalledWith(expect.anything(), 'content')
  })

  /**
   * One page of a shared document fans out to many inline requests, so the
   * aggregate per-share ceiling matters most here — the per-IP bucket alone does
   * not bound a link that is passed around.
   */
  it('enforces the per-share content bucket with the resolved share id', async () => {
    await GET(request(), params())
    expect(mockEnforcePerShare).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerShare).toHaveBeenCalledWith('content', 'sh_1')
  })

  it('stops on the per-share bucket before any storage read', async () => {
    mockEnforcePerShare.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await GET(request(), params())
    expect(res.status).toBe(429)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockServeInlineImage).not.toHaveBeenCalled()
  })

  it('propagates a 401 from the gate without reading the document', async () => {
    mockResolvePublicInterfaceModule.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'auth_required_password' }, { status: 401 }),
    })
    const res = await GET(request(), params())
    expect(res.status).toBe(401)
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockServeInlineImage).not.toHaveBeenCalled()
  })

  it('404s when the module document no longer resolves in the workspace', async () => {
    mockGetWorkspaceFile.mockResolvedValueOnce(null)
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(mockServeInlineImage).not.toHaveBeenCalled()
  })

  /**
   * Gate 1 — the document's *current* bytes are re-read per request; a cached
   * or previously-referenced embed grants nothing.
   */
  it('404s an image the document does not embed', async () => {
    mockExtractEmbeddedImageIds.mockReturnValueOnce([])
    const res = await GET(request('?fileId=img-arbitrary'), params())
    expect(res.status).toBe(404)
    expect(mockResolveWorkspaceInlineImage).not.toHaveBeenCalled()
    expect(mockServeInlineImage).not.toHaveBeenCalled()
  })

  it('re-reads the document bytes on every request', async () => {
    await GET(request(), params())
    await GET(request(), params())
    expect(mockDownloadFile).toHaveBeenCalledTimes(2)
  })

  /** Gate 2 — a cross-workspace embed an author can write must never resolve. */
  it('resolves the image scoped to the interface own workspace', async () => {
    await GET(request(), params())
    expect(mockResolveWorkspaceInlineImage).toHaveBeenCalledWith(WS, { fileId: EMBED_ID })
  })

  it('404s when the referenced image is outside the workspace', async () => {
    mockResolveWorkspaceInlineImage.mockResolvedValueOnce(null)
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(mockServeInlineImage).not.toHaveBeenCalled()
  })

  /** Gate 3 — the content type comes from the bytes, never the stored type. */
  it('never relaxes the content sniff', async () => {
    await GET(request(), params())
    expect(mockServeInlineImage).toHaveBeenCalledWith(expect.anything(), { sniff: true })
  })

  it('folds a spoofed content type into the uniform 404', async () => {
    const { FileNotFoundError } = await import('@/app/api/files/utils')
    mockServeInlineImage.mockRejectedValueOnce(new FileNotFoundError('Not an image'))
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })

  it('serves a referenced in-workspace image', async () => {
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
  })

  it('records the inline read as anonymous', async () => {
    await GET(request(), params())
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        actorId: null,
        action: 'file.downloaded',
        metadata: expect.objectContaining({
          access: 'public_share',
          anonymous: true,
          inline: true,
        }),
      })
    )
  })
})
