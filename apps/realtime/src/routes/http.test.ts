import type { IncomingMessage, ServerResponse } from 'http'
import { describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'
import { createHttpHandler } from '@/routes/http'

function createMocks(req: Partial<IncomingMessage>) {
  const writeHead = vi.fn()
  const end = vi.fn()
  const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
  const roomManager = {
    getTotalActiveConnections: vi.fn().mockResolvedValue(0),
    isReady: vi.fn().mockReturnValue(true),
  } as unknown as IRoomManager

  return {
    handler: createHttpHandler(roomManager, logger),
    req: { headers: {}, ...req } as IncomingMessage,
    res: { writeHead, end } as unknown as ServerResponse,
    writeHead,
    end,
  }
}

describe('createHttpHandler', () => {
  it('marks unmatched routes noindex so crawlers drop the socket hostnames', async () => {
    const { handler, req, res, writeHead, end } = createMocks({ method: 'GET', url: '/' })

    await handler(req, res)

    expect(writeHead).toHaveBeenCalledWith(404, {
      'Content-Type': 'application/json',
      'X-Robots-Tag': 'noindex, nofollow',
    })
    expect(end).toHaveBeenCalledWith(JSON.stringify({ error: 'Not found' }))
  })

  it('does not mark the health check noindex', async () => {
    const { handler, req, res, writeHead } = createMocks({ method: 'GET', url: '/health' })

    await handler(req, res)

    expect(writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
  })
})
