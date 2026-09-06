/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  chat: vi.fn(),
  authorize: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  claim: vi.fn(),
  assertLease: vi.fn(),
  events: vi.fn(),
  billing: vi.fn(),
  permission: vi.fn(),
  start: vi.fn(),
}))
vi.mock('@/lib/mothership/async-runs/repository', () => ({ getLatestRunForStream: mocks.run }))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mocks.chat,
}))
vi.mock('@/lib/core/application/workspace-authorization', async (original) => ({
  ...(await original<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: mocks.authorize,
}))
vi.mock('@/lib/mothership/request/session/abort', () => ({
  acquirePendingChatStream: mocks.acquire,
  releasePendingChatStream: mocks.release,
  getLocalChatStreamLease: () => ({ key: 'chat-lock', value: 'stream\nnew-controller' }),
}))
vi.mock('@/lib/mothership/request/session/controller-lease', async (original) => ({
  ...(await original<typeof import('@/lib/mothership/request/session/controller-lease')>()),
  assertChatStreamLease: mocks.assertLease,
}))
vi.mock('@/lib/mothership/request/lifecycle/controller-ownership', () => ({
  claimRunController: mocks.claim,
}))
vi.mock('@/lib/mothership/request/session/buffer', () => ({ readEvents: mocks.events }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mocks.billing,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mocks.permission,
}))
vi.mock('@/lib/mothership/request/lifecycle/start', () => ({ createSSEStream: mocks.start }))

import { readChatStream } from './recover-stream'

const principal = { kind: 'session', userId: 'user', sessionId: 'session' } as const
const input = { streamId: 'stream' }
const run = {
  id: 'run',
  executionId: 'execution',
  streamId: 'stream',
  chatId: 'chat',
  userId: 'user',
  workspaceId: 'workspace',
  status: 'active',
  workflowId: null,
  requestContext: {
    requestId: 'request',
    controllerToken: 'old-controller',
    recovery: {
      kind: 'interactive_stream',
      goRoute: '/api/mothership',
      clientToolPickupExpected: false,
      userTimezone: 'Asia/Kolkata',
      requestMode: 'agent',
    },
  },
}

describe('authorized chat stream recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.run.mockResolvedValue(run)
    mocks.chat.mockResolvedValue({
      chatId: 'chat',
      userId: 'user',
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
    })
    mocks.acquire.mockResolvedValue(true)
    mocks.claim.mockResolvedValue(true)
    mocks.events.mockResolvedValue([])
    mocks.billing.mockResolvedValue({ actorUserId: 'user', workspaceId: 'workspace' })
    mocks.permission.mockResolvedValue('read')
    mocks.start.mockImplementation(
      () =>
        new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
    )
  })

  it.each([
    'personal_api_key',
    'workspace_api_key',
    'delegated',
    'system',
    'external_user',
    'workflow_execution',
  ])('rejects a %s principal before protected lookup', async (kind) => {
    await expect(
      readChatStream.execute({ principal: { kind } as Principal, input })
    ).rejects.toThrow()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it('conceals a run that does not belong to the authenticated user', async () => {
    mocks.run.mockResolvedValue(null)
    await expect(readChatStream.execute({ principal, input })).rejects.toThrow('Stream not found')
    expect(mocks.run).toHaveBeenCalledWith('stream', 'user')
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it.each(['deleted chat', 'changed owner', 'suspended user'])(
    'does not recover a %s rejected by canonical chat resolution',
    async (reason) => {
      mocks.chat.mockRejectedValue(new Error(reason))
      await expect(readChatStream.execute({ principal, input })).rejects.toThrow(reason)
      expect(mocks.acquire).not.toHaveBeenCalled()
    }
  )

  it('rejects mismatched canonical workspaces before acquiring a controller', async () => {
    mocks.run.mockResolvedValue({ ...run, workspaceId: 'another-workspace' })
    await expect(readChatStream.execute({ principal, input })).rejects.toThrow('Stream not found')
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it('rechecks current workspace permission before recovery or replay', async () => {
    mocks.authorize.mockRejectedValue(new Error('membership revoked'))
    await expect(readChatStream.execute({ principal, input })).rejects.toThrow('membership revoked')
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it.each(['complete', 'cancelled', 'error'])('only reads a %s run', async (status) => {
    mocks.run.mockResolvedValue({ ...run, status })
    expect((await readChatStream.execute({ principal, input })).status).toBe(status)
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it('tails the existing owner without starting another controller', async () => {
    mocks.acquire.mockResolvedValue(false)
    await readChatStream.execute({ principal, input })
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('reattaches the same worker run with saved interaction metadata and current authorization', async () => {
    await readChatStream.execute({ principal, input })
    expect(mocks.claim).toHaveBeenCalledWith({
      runId: 'run',
      chatId: 'chat',
      previousToken: 'old-controller',
      token: 'stream\nnew-controller',
    })
    expect(mocks.start).toHaveBeenCalledOnce()
    const params = mocks.start.mock.calls[0][0]
    expect(params.requestPayload).toEqual({ streamId: 'stream', results: [] })
    expect(params.orchestrateOptions).toMatchObject({
      goRoute: '/api/mothership',
      userPermission: 'read',
      interactive: true,
      clientToolPickupExpected: false,
      recovery: {
        streamId: 'stream',
        userTimezone: 'Asia/Kolkata',
        requestMode: 'agent',
        events: [],
      },
    })
    expect(mocks.billing).toHaveBeenCalledWith({ actorUserId: 'user', workspaceId: 'workspace' })
  })

  it('does not start after losing the database takeover race', async () => {
    mocks.claim.mockResolvedValue(false)
    await readChatStream.execute({ principal, input })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith('chat', 'stream', {
      key: 'chat-lock',
      value: 'stream\nnew-controller',
    })
  })

  it('releases its exact lease when recovery preparation fails', async () => {
    mocks.events.mockRejectedValue(new Error('buffer unavailable'))
    await expect(readChatStream.execute({ principal, input })).rejects.toThrow('buffer unavailable')
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith('chat', 'stream', {
      key: 'chat-lock',
      value: 'stream\nnew-controller',
    })
  })
})
