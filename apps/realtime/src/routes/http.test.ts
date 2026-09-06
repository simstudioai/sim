import type { IncomingMessage, ServerResponse } from 'http'
import { describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'

const { mockInvalidateDocument } = vi.hoisted(() => ({ mockInvalidateDocument: vi.fn() }))

vi.mock('@/handlers/file-doc', () => ({
  applyMarkdownToLiveFileDoc: vi.fn(),
  fileDocAdmissionRoom: (fileId: string) => `file-doc-admission:${fileId}`,
  invalidateLiveFileDocument: mockInvalidateDocument,
}))

import { createHttpHandler } from '@/routes/http'

function createMocks(req: Partial<IncomingMessage>) {
  const setHeader = vi.fn()
  const writeHead = vi.fn()
  const end = vi.fn()
  const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
  const emit = vi.fn()
  const to = vi.fn(() => ({ emit }))
  const roomManager = {
    io: { to },
    getTotalActiveConnections: vi.fn().mockResolvedValue(0),
    isReady: vi.fn().mockReturnValue(true),
    emitToRoom: vi.fn(),
  } as unknown as IRoomManager

  return {
    handler: createHttpHandler(roomManager, logger),
    req: { headers: {}, ...req } as IncomingMessage,
    res: { setHeader, writeHead, end } as unknown as ServerResponse,
    setHeader,
    writeHead,
    end,
    roomManager,
    to,
    emit,
  }
}

function requestWithBody(url: string, body: unknown): Partial<IncomingMessage> {
  const text = JSON.stringify(body)
  const request = {
    method: 'POST',
    url,
    headers: { 'x-api-key': 'test-internal-api-secret-at-least-32-chars' },
    on(event: string, callback: (value?: Buffer) => void) {
      if (event === 'data') callback(Buffer.from(text))
      if (event === 'end') callback()
      return request
    },
  }
  return request as unknown as Partial<IncomingMessage>
}

describe('createHttpHandler', () => {
  /**
   * `/health` is the only route on this server that returns 200 with a body, so
   * it is the only genuinely indexable surface on the `sockets.*` hostnames.
   * Node merges `setHeader` values into `writeHead`, and no branch here sets
   * `X-Robots-Tag`, so the handler-level call reaches every response.
   */
  it.each([
    ['health check', { method: 'GET', url: '/health' }],
    ['unmatched route', { method: 'GET', url: '/' }],
    ['unauthenticated internal API call', { method: 'POST', url: '/api/workflow-deleted' }],
  ])('marks the %s noindex', async (_label, req) => {
    const { handler, req: request, res, setHeader } = createMocks(req)

    await handler(request, res)

    expect(setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, nofollow')
  })

  it('still serves the unmatched-route 404 unchanged', async () => {
    const { handler, req, res, writeHead, end } = createMocks({ method: 'GET', url: '/' })

    await handler(req, res)

    expect(writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' })
    expect(end).toHaveBeenCalledWith(JSON.stringify({ error: 'Not found' }))
  })

  it('still serves the health check as 200', async () => {
    const { handler, req, res, writeHead } = createMocks({ method: 'GET', url: '/health' })

    await handler(req, res)

    expect(writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
  })

  it('invalidates the shared generation before notifying every open editor', async () => {
    mockInvalidateDocument.mockResolvedValueOnce({ status: 'applied', docId: 'old-document' })
    const { handler, req, res, writeHead, to, emit } = createMocks(
      requestWithBody('/api/file-doc/invalidate', { fileId: 'file-1', version: 100 })
    )

    await handler(req, res)

    expect(mockInvalidateDocument).toHaveBeenCalledWith('file-1', 100)
    expect(to).toHaveBeenCalledWith(['workspace-file-doc:file-1', 'file-doc-admission:file-1'])
    expect(emit).toHaveBeenCalledWith(
      'file-doc-invalidated',
      expect.objectContaining({ fileId: 'file-1', version: 100, docId: 'old-document' })
    )
    expect(mockInvalidateDocument.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0]
    )
    expect(writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
  })

  it('does not evict editors for a superseded invalidation', async () => {
    mockInvalidateDocument.mockResolvedValueOnce({ status: 'stale' })
    const { handler, req, res, end, roomManager, to } = createMocks(
      requestWithBody('/api/file-doc/invalidate', { fileId: 'file-1', version: 100 })
    )
    await handler(req, res)
    expect(roomManager.emitToRoom).not.toHaveBeenCalled()
    expect(to).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledWith(JSON.stringify({ status: 'stale' }))
  })

  it('requires a durable version for invalidation', async () => {
    const { handler, req, res, writeHead } = createMocks(
      requestWithBody('/api/file-doc/invalidate', { fileId: 'file-1' })
    )
    await handler(req, res)
    expect(writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' })
  })
})
