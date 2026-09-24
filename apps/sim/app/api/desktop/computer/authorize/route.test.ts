/** @vitest-environment node */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), rate: vi.fn() }))
vi.mock('@/lib/computer-use/application/authorize', () => ({
  authorizeComputerUse: {
    operation: {
      id: 'desktop.computer.execute',
      capability: 'copilot.use',
      principalKinds: ['session'],
    },
    execute: mocks.execute,
  },
}))
vi.mock('@/lib/core/rate-limiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/rate-limiter')>()),
  enforceUserRateLimit: mocks.rate,
}))

import { POST } from '@/app/api/desktop/computer/authorize/route'

const request = (body: unknown) =>
  new NextRequest('http://localhost/api/desktop/computer/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
describe('computer authorization route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.rate.mockResolvedValue(null)
    mocks.execute.mockResolvedValue({
      toolName: 'computer',
      chatId: 'chat-1',
      args: { action: 'list_apps' },
    })
  })
  it('authenticates before parsing malformed requests', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    expect((await POST(request({ args: 'forged' }))).status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('accepts only a tool ID, never renderer-provided target or chat authority', async () => {
    expect(
      (await POST(request({ toolCallId: 'call-1', args: { action: 'click' }, chatId: 'chat-2' })))
        .status
    ).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('passes the authenticated session principal and returns validated canonical arguments', async () => {
    const response = await POST(request({ toolCallId: 'call-1' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      toolName: 'computer',
      chatId: 'chat-1',
      args: { action: 'list_apps' },
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { toolCallId: 'call-1' },
      })
    )
    expect(mocks.rate).toHaveBeenCalledWith('desktop-computer-use', 'user-1', undefined)
  })
  it.each([
    ['not_found', 404],
    ['forbidden', 403],
  ] as const)('projects %s without leaking protected state', async (code, status) => {
    mocks.execute.mockRejectedValueOnce(new OrchestrationError(code, 'Computer action unavailable'))
    expect((await POST(request({ toolCallId: 'call-1' }))).status).toBe(status)
  })
})
