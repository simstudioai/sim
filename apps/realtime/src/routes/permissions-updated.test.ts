/**
 * @vitest-environment node
 *
 * Tests for the `/api/permissions-updated` HTTP endpoint that the main app calls
 * to reconcile realtime rooms after a workspace permission change.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpHandler } from '@/routes/http'

const API_KEY = 'test-internal-api-secret-at-least-32-chars'

function createLogger() {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
}

function createRoomManager(overrides?: Record<string, unknown>) {
  return {
    isReady: vi.fn().mockReturnValue(true),
    handleWorkspaceAccessChange: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function createRequest(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const req = Readable.from([
    typeof body === 'string' ? body : JSON.stringify(body),
  ]) as unknown as IncomingMessage
  req.method = 'POST'
  req.url = '/api/permissions-updated'
  req.headers = headers
  return req
}

function createResponse() {
  const res = {
    statusCode: 0,
    body: '',
    writeHead: vi.fn((status: number) => {
      res.statusCode = status
      return res
    }),
    end: vi.fn((chunk?: string) => {
      if (chunk) res.body = chunk
    }),
  }
  return res as unknown as ServerResponse & { statusCode: number; body: string }
}

async function invoke(roomManager: ReturnType<typeof createRoomManager>, req: IncomingMessage) {
  const res = createResponse()
  const handler = createHttpHandler(roomManager as never, createLogger())
  await handler(req, res)
  return res
}

describe('POST /api/permissions-updated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects requests without a valid internal API key', async () => {
    const roomManager = createRoomManager()
    const res = await invoke(roomManager, createRequest({ workspaceId: 'ws-1', userId: 'user-1' }))

    expect(res.statusCode).toBe(401)
    expect(roomManager.handleWorkspaceAccessChange).not.toHaveBeenCalled()
  })

  it('returns 400 when workspaceId or userId is missing', async () => {
    const roomManager = createRoomManager()
    const res = await invoke(
      roomManager,
      createRequest({ workspaceId: 'ws-1' }, { 'x-api-key': API_KEY })
    )

    expect(res.statusCode).toBe(400)
    expect(roomManager.handleWorkspaceAccessChange).not.toHaveBeenCalled()
  })

  it('delegates to handleWorkspaceAccessChange on a valid request', async () => {
    const roomManager = createRoomManager()
    const res = await invoke(
      roomManager,
      createRequest({ workspaceId: 'ws-1', userId: 'user-1' }, { 'x-api-key': API_KEY })
    )

    expect(res.statusCode).toBe(200)
    expect(roomManager.handleWorkspaceAccessChange).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('returns 503 when the room manager is not ready', async () => {
    const roomManager = createRoomManager({ isReady: vi.fn().mockReturnValue(false) })
    const res = await invoke(
      roomManager,
      createRequest({ workspaceId: 'ws-1', userId: 'user-1' }, { 'x-api-key': API_KEY })
    )

    expect(res.statusCode).toBe(503)
    expect(roomManager.handleWorkspaceAccessChange).not.toHaveBeenCalled()
  })

  it('returns 500 when reconciliation throws', async () => {
    const roomManager = createRoomManager({
      handleWorkspaceAccessChange: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const res = await invoke(
      roomManager,
      createRequest({ workspaceId: 'ws-1', userId: 'user-1' }, { 'x-api-key': API_KEY })
    )

    expect(res.statusCode).toBe(500)
  })
})
