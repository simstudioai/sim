/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const { mockReadInline } = vi.hoisted(() => ({ mockReadInline: vi.fn() }))

vi.mock('@/lib/workspace-files/application/read-workspace-inline-file', () => ({
  readWorkspaceInlineFile: {
    operation: { id: 'files.read_content', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mockReadInline,
  },
}))

import { GET } from '@/app/api/workspaces/[id]/files/inline/route'

const mockGetSession = authMockFns.mockGetSession
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const params = { params: Promise.resolve({ id: 'ws-1' }) }
const req = (q: string) =>
  new NextRequest(`http://localhost/api/workspaces/ws-1/files/inline${q ? `?${q}` : ''}`)

describe('GET /api/workspaces/[id]/files/inline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } })
    mockReadInline.mockResolvedValue({
      file: { name: 'photo.png', type: 'image/png', size: PNG.length },
      stream: new Blob([new Uint8Array(PNG)]).stream(),
      contentAddressed: false,
    })
  })

  it('serves authenticated workspace-scoped content by file id', async () => {
    const res = await GET(req('fileId=wf_abc'), params)

    expect(res.status).toBe(200)
    expect(mockReadInline).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'u1', sessionId: 's1' },
        input: { workspaceId: 'ws-1', fileId: 'wf_abc' },
      })
    )
    // A file id names the FILE, whose bytes move under it on every edit — so it must revalidate.
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache, must-revalidate')
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="photo.png"')
  })

  it('passes key references to the shared read use case', async () => {
    const res = await GET(req('key=workspace%2Fws-1%2Fphoto.png'), params)

    expect(res.status).toBe(200)
    expect(mockReadInline.mock.calls[0][0].input).toEqual({
      workspaceId: 'ws-1',
      key: 'workspace/ws-1/photo.png',
      fileId: undefined,
    })
  })

  /**
   * A storage key names one object and a content write never rewrites one, so these bytes can never
   * change. Revalidating them meant re-downloading every embedded image on every open — a document is
   * rendered by two editors (the read-only placeholder, then the live one) and each renders the image
   * twice, so the image was fetched again on every one of those passes.
   */
  it('lets the browser keep an image whose URL names the object that was streamed', async () => {
    mockReadInline.mockResolvedValue({
      file: { name: 'photo.png', type: 'image/png', size: PNG.length },
      stream: new Blob([new Uint8Array(PNG)]).stream(),
      contentAddressed: true,
    })

    const res = await GET(req('key=workspace%2Fws-1%2Fphoto.png'), params)

    expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
  })

  it('returns the concealed 404 response for an unauthorized or missing file', async () => {
    mockReadInline.mockRejectedValue(
      new OrchestrationError('forbidden', 'Insufficient permissions')
    )

    const res = await GET(req('fileId=wf_other'), params)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'FileNotFoundError', message: 'Not found' })
  })

  it('authenticates before parsing invalid input', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await GET(req(''), params)

    expect(res.status).toBe(401)
    expect(mockReadInline).not.toHaveBeenCalled()
  })

  it('returns a validation response when both references are supplied', async () => {
    const res = await GET(req('key=k&fileId=f'), params)
    expect(res.status).toBe(400)
    expect(mockReadInline).not.toHaveBeenCalled()
  })
})
