/** @vitest-environment node */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  workspace: vi.fn(),
  banned: vi.fn(),
  run: vi.fn(),
  stopped: vi.fn(),
}))
vi.unmock('@/lib/mothership/request/http')
vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: mocks.banned }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/core/application/workspace-authorization', async (original) => ({
  ...(await original<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: mocks.authorize,
}))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getLatestRunForStream: mocks.run,
  isRunStopRequested: mocks.stopped,
}))

import { env } from '@/lib/core/config/env'
import { POST } from '@/app/api/mothership/runs/control/route'

const chatId = '33333333-3333-4333-8333-333333333333'
function request(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/mothership/runs/control', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.INTERNAL_API_SECRET ?? '',
      'x-mothership-user-id': 'actor',
      'x-mothership-workspace-id': 'workspace',
      ...headers,
    },
    body: JSON.stringify({ chatId, streamId: 'stream' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  queueTableRows(schemaMock.copilotChats, [{ userId: 'actor', workspaceId: 'workspace' }])
  mocks.banned.mockResolvedValue([])
  mocks.workspace.mockResolvedValue({
    workspaceId: 'workspace',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: false,
  })
  mocks.authorize.mockResolvedValue(undefined)
  mocks.run.mockResolvedValue({ chatId, workspaceId: 'workspace' })
  mocks.stopped.mockResolvedValue(true)
})

describe('worker run control boundary', () => {
  it('returns accepted Stop only after authorizing the actor and canonical run', async () => {
    expect(await (await POST(request())).json()).toEqual({ stopped: true })
    expect(mocks.authorize).toHaveBeenCalledOnce()
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith('stream', 'actor')
    expect(mocks.stopped).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actor', workspaceId: 'workspace', streamId: 'stream' })
    )
  })
  it.each([
    ['x-api-key', 'browser-key'],
    ['x-mothership-user-id', ''],
    ['x-mothership-workspace-id', ''],
  ])('rejects invalid service identity: %s', async (header, value) => {
    expect((await POST(request({ [header]: value }))).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('conceals a chat belonging to another actor', async () => {
    expect((await POST(request({ 'x-mothership-user-id': 'other-actor' }))).status).toBe(404)
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it.each([
    null,
    { chatId: 'other-chat', workspaceId: 'workspace' },
    { chatId, workspaceId: 'other-workspace' },
  ])('refuses a missing or mismatched canonical run: %j', async (run) => {
    mocks.run.mockResolvedValue(run)
    expect((await POST(request())).status).toBe(404)
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('does not turn a database outage into permission to continue', async () => {
    mocks.stopped.mockRejectedValue(new Error('database unavailable'))
    expect((await POST(request())).status).toBe(500)
  })
})
