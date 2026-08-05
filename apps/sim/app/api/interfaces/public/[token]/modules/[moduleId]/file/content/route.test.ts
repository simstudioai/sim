/**
 * @vitest-environment node
 *
 * The token is a capability for the module's one file, never an arbitrary
 * workspace file. STEP 5 of §2.3 re-asserts the file is a live `workspace`-context
 * row in the interface's own workspace before a single byte is read from storage.
 */
import { Readable } from 'node:stream'
import { auditMock, auditMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnforcePerIp,
  mockEnforcePerShare,
  mockResolvePublicInterfaceModule,
  mockGetWorkspaceFile,
  mockDownloadFile,
  mockHeadObject,
  mockDownloadFileStream,
  mockResolveServableDoc,
} = vi.hoisted(() => ({
  mockEnforcePerIp: vi.fn(),
  mockEnforcePerShare: vi.fn(),
  mockResolvePublicInterfaceModule: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockHeadObject: vi.fn(),
  mockDownloadFileStream: vi.fn(),
  mockResolveServableDoc: vi.fn(),
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
  headObject: mockHeadObject,
  downloadFileStream: mockDownloadFileStream,
}))

vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  resolveServableDoc: mockResolveServableDoc,
}))

vi.mock('@sim/audit', () => auditMock)

import { GET } from '@/app/api/interfaces/public/[token]/modules/[moduleId]/file/content/route'

const TOKEN = 'tok_1'
const MODULE_ID = 'mod-file'
const WS = 'ws-a'
const OTHER_WS = 'ws-b'
const FILE_ID = 'file-stored'

const params = (token = TOKEN, moduleId = MODULE_ID) => ({
  params: Promise.resolve({ token, moduleId }),
})

const request = (query = '', headers?: Record<string, string>) =>
  new NextRequest(
    `http://localhost/api/interfaces/public/${TOKEN}/modules/${MODULE_ID}/file/content${query}`,
    headers ? { headers } : undefined
  )

const fileModule = {
  id: MODULE_ID,
  type: 'file' as const,
  placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  config: { fileId: FILE_ID },
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
  resource: { type: 'file' as const, id: FILE_ID },
}

function buildFile(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    workspaceId: WS,
    name: 'handbook.pdf',
    key: 'workspace/ws-a/handbook.pdf',
    path: '/api/files/serve/workspace/ws-a/handbook.pdf',
    size: 4,
    type: 'application/pdf',
    uploadedBy: 'user-1',
    deletedAt: null,
    uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('GET /api/interfaces/public/[token]/modules/[moduleId]/file/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforcePerIp.mockResolvedValue(null)
    mockEnforcePerShare.mockResolvedValue(null)
    mockResolvePublicInterfaceModule.mockResolvedValue({ ok: true, access })
    mockGetWorkspaceFile.mockResolvedValue(buildFile())
    mockDownloadFile.mockResolvedValue(Buffer.from('data'))
    mockResolveServableDoc.mockResolvedValue({ kind: 'passthrough' })
  })

  it('returns 429 before the authorization chain runs', async () => {
    mockEnforcePerIp.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await GET(request(), params())
    expect(res.status).toBe(429)
    expect(mockResolvePublicInterfaceModule).not.toHaveBeenCalled()
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('uses the content rate-limit scope and consumes the per-IP bucket once', async () => {
    await GET(request(), params())
    expect(mockEnforcePerIp).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerIp).toHaveBeenCalledWith(expect.anything(), 'content')
  })

  /**
   * S3 egress is what the `content` scope exists to bound, so the aggregate
   * per-share ceiling must apply here too — the per-IP bucket alone does not
   * bound a link that is passed around.
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
  })

  it('runs the chain with the file type pinned', async () => {
    await GET(request(), params())
    expect(mockResolvePublicInterfaceModule).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN, moduleId: MODULE_ID, expectedType: 'file' })
    )
  })

  it('propagates a 401 from the gate and never reads storage', async () => {
    mockResolvePublicInterfaceModule.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'auth_required_password' }, { status: 401 }),
    })
    const res = await GET(request(), params())
    expect(res.status).toBe(401)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  /**
   * The route accepts no `fileId`; the id is produced by `moduleReference` from
   * the stored layout, so a query param cannot redirect the read.
   */
  it('re-asserts the derived file against the interface own workspace', async () => {
    await GET(request('?fileId=file-attacker'), params())
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith(WS, FILE_ID)
  })

  it('404s when the derived file is not in the interface workspace', async () => {
    mockGetWorkspaceFile.mockResolvedValueOnce(null)
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  /**
   * `getWorkspaceFile(workspaceId, fileId)` *is* the STEP 5 assert — its WHERE
   * clause carries same-workspace, `context = 'workspace'`, and not-soft-deleted
   * together. A file that fails any of them resolves to null, so the route must
   * never fall back to a lookup that is not workspace-scoped.
   */
  it('scopes the lookup to the interface workspace, never the file own', async () => {
    mockResolvePublicInterfaceModule.mockResolvedValueOnce({
      ok: true,
      access: { ...access, workspaceId: OTHER_WS },
    })
    await GET(request(), params())
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith(OTHER_WS, FILE_ID)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalledWith(WS, FILE_ID)
  })

  it('serves the derived file bytes', async () => {
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    expect(mockDownloadFile).toHaveBeenCalledWith({
      key: 'workspace/ws-a/handbook.pdf',
      context: 'workspace',
    })
  })

  it('revalidates on every request so a revoked link cannot serve cached bytes', async () => {
    const res = await GET(request(), params())
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache, must-revalidate')
  })

  it('409s while a document is still compiling', async () => {
    mockResolveServableDoc.mockResolvedValueOnce({ kind: 'unavailable' })
    const res = await GET(request(), params())
    expect(res.status).toBe(409)
  })

  it('records the download as anonymous, never as the owner', async () => {
    await GET(request(), params())
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        actorId: null,
        action: 'file.downloaded',
        resourceId: FILE_ID,
        metadata: expect.objectContaining({ access: 'public_share', anonymous: true }),
      })
    )
  })

  /**
   * The byte-range media branch. It had no coverage at all, which is exactly how
   * it shipped without the audit row the buffered branch beside it records — the
   * same access, through the same token, invisible in the trail.
   */
  describe('media byte-serving', () => {
    const MEDIA_SIZE = 2048

    function mediaFile() {
      mockGetWorkspaceFile.mockResolvedValue(
        buildFile({ name: 'clip.mp4', type: 'video/mp4', size: MEDIA_SIZE })
      )
      mockHeadObject.mockResolvedValue({ size: MEDIA_SIZE })
      mockDownloadFileStream.mockResolvedValue(Readable.from([Buffer.alloc(8)]))
    }

    it('audits the opening request of a playback', async () => {
      mediaFile()

      const res = await GET(request('', { range: 'bytes=0-' }), params())

      expect(res.status).toBe(206)
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceName: 'clip.mp4',
          metadata: expect.objectContaining({ access: 'public_share', anonymous: true }),
        })
      )
    })

    /**
     * The negative control: a player issues many ranged requests for one view, so
     * a seek must NOT add a row. Without this the first assertion would pass just
     * as happily on an implementation that audits every request.
     */
    it('does not audit a seek', async () => {
      mediaFile()

      const res = await GET(request('', { range: 'bytes=500-999' }), params())

      expect(res.status).toBe(206)
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    it('serves the whole object, audited, when no range is asked for', async () => {
      mediaFile()

      const res = await GET(request(), params())

      expect(res.status).toBe(200)
      expect(res.headers.get('Accept-Ranges')).toBe('bytes')
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    })
  })
})
