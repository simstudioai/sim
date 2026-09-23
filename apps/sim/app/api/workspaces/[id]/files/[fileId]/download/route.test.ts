/** @vitest-environment node */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  download: vi.fn(),
  authorize: vi.fn(),
  downloadUrl: vi.fn(),
  analytics: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mocks.session,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))
vi.mock('@/lib/workspace-files/application/download-workspace-file', () => ({
  downloadWorkspaceFile: { operation: { id: 'files.download' }, execute: mocks.downloadUrl },
  downloadWorkspaceFileStream: {
    operation: { id: 'files.download' },
    authorize: mocks.authorize,
    execute: mocks.download,
  },
}))

import { GET } from '@/app/api/workspaces/[id]/files/[fileId]/download/route'

const context = { params: Promise.resolve({ id: 'ws-1', fileId: 'file-1' }) }
const url = 'http://localhost:3000/api/workspaces/ws-1/files/file-1/download'

describe('internal streaming file download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.authorize.mockResolvedValue(undefined)
  })

  it('returns before consuming a large stream and propagates cancellation', async () => {
    const cancel = vi.fn()
    const pull = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
    mocks.download.mockResolvedValue({
      file: { id: 'file-1', workspaceId: 'ws-1', name: 'large.bin' },
      stream,
      contentLength: 5 * 1024 ** 3,
      contentType: 'application/octet-stream',
    })
    const response = await GET(createMockRequest('GET', undefined, {}, url), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe(String(5 * 1024 ** 3))
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Content-Disposition')).toContain('attachment;')
    expect(pull).not.toHaveBeenCalled()
    await response.body?.cancel('download cancelled')
    expect(cancel).toHaveBeenCalledWith('download cancelled')
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'ws-1' },
      })
    )
    expect(mocks.analytics).toHaveBeenCalledOnce()
  })

  it('authenticates before loading protected data', async () => {
    mocks.session.mockResolvedValue(null)
    const response = await GET(createMockRequest('GET', undefined, {}, url), context)
    expect(response.status).toBe(401)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.analytics).not.toHaveBeenCalled()
  })

  it('authorizes HEAD without opening a stream or recording a download', async () => {
    const response = await GET(createMockRequest('HEAD', undefined, {}, url), context)
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(mocks.authorize).toHaveBeenCalledOnce()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.analytics).not.toHaveBeenCalled()
  })

  it('does not expose inaccessible files through HEAD', async () => {
    mocks.authorize.mockRejectedValueOnce(new OrchestrationError('not_found', 'File not found'))
    const response = await GET(createMockRequest('HEAD', undefined, {}, url), context)
    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it.each(['GET', 'HEAD'] as const)(
    'conceals cross-workspace access through %s',
    async (method) => {
      mocks.download.mockRejectedValueOnce(new NoWorkspaceAccessError())
      mocks.authorize.mockRejectedValueOnce(new NoWorkspaceAccessError())
      const response = await GET(createMockRequest(method, undefined, {}, url), context)
      expect(response.status).toBe(404)
      expect(mocks.analytics).not.toHaveBeenCalled()
    }
  )
})
