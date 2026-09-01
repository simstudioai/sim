import type { IncomingMessage, ServerResponse } from 'http'
import { describe, expect, it, vi } from 'vitest'
import { env } from '@/env'
import type { IRoomManager } from '@/rooms'
import { createHttpHandler } from '@/routes/http'

function createMocks(req: Partial<IncomingMessage>) {
  const setHeader = vi.fn()
  const writeHead = vi.fn()
  const end = vi.fn()
  const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
  const roomManager = {
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
  }
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

  it('fans workflow-tree changes out to the workspace workflows room', async () => {
    const workspaceId = 'workspace-1'
    const body = JSON.stringify({ workspaceId })
    const request = {
      method: 'POST',
      url: '/api/workspace-workflows-changed',
      headers: { 'x-api-key': env.INTERNAL_API_SECRET },
      on(event: string, callback: (chunk?: Buffer) => void) {
        if (event === 'data') callback(Buffer.from(body))
        if (event === 'end') callback()
        return this
      },
    } as unknown as IncomingMessage
    const { handler, res, roomManager, writeHead } = createMocks(request)

    await handler(request, res)

    expect(roomManager.emitToRoom).toHaveBeenCalledWith(
      { type: 'workspace-workflows', id: workspaceId },
      'workspace-workflows-changed',
      { workspaceId, timestamp: expect.any(Number) }
    )
    expect(writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
  })
})
