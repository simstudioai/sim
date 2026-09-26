import type { Principal } from '@sim/auth/principal'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  chat: vi.fn(),
  authorize: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  claim: vi.fn(),
  assertLease: vi.fn(),
  events: vi.fn(),
  start: vi.fn(),
}))
vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: hoisted.chat,
}))
vi.mock('@/lib/core/application/workspace-authorization', async (original) => ({
  ...(await original<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: hoisted.authorize,
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/mothership/request/session/abort', () => ({
  acquirePendingChatStream: hoisted.acquire,
  releasePendingChatStream: hoisted.release,
  getLocalChatStreamLease: () => ({ key: 'chat-lock', value: 'stream\nnew-controller' }),
}))
vi.mock('@/lib/mothership/request/session/controller-lease', async (original) => ({
  ...(await original<typeof import('@/lib/mothership/request/session/controller-lease')>()),
  assertChatStreamLease: hoisted.assertLease,
}))
vi.mock('@/lib/mothership/request/lifecycle/controller-ownership', () => ({
  claimRunController: hoisted.claim,
}))
vi.mock('@/lib/mothership/request/session/buffer', () => ({ readEvents: hoisted.events }))
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
const mockResolveBillingAttribution = billingAttributionMockFns.mockResolveBillingAttribution
const mockResolveOrganizationBillingAttribution =
  billingAttributionMockFns.mockResolveOrganizationBillingAttribution
const mocks = {
  ...hoisted,
  run: mothershipAsyncRunsMockFns.mockGetLatestRunForStream,
  organizationAuthorize: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
  permission: permissionsMockFns.mockGetUserEntityPermissions,
}
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/mothership/request/lifecycle/start', () => ({ createSSEStream: hoisted.start }))

import { readChatStream } from '@/lib/mothership/request/application/recover-stream'

const principal = createSessionPrincipal({ userId: 'user', sessionId: 'session' })
const input = { streamId: '11111111-1111-4111-8111-111111111111' }
const run = {
  id: 'run',
  executionId: 'execution',
  streamId: '11111111-1111-4111-8111-111111111111',
  chatId: '22222222-2222-4222-8222-222222222222',
  userId: 'user',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  status: 'active',
  workflowId: null,
  startedAt: new Date('2026-01-01T00:00:00Z'),
  requestContext: {
    requestId: 'request',
    controllerToken: 'old-controller',
    recovery: {
      kind: 'interactive_stream',
      request: {
        message: 'Original accepted instruction',
        userId: 'user',
        messageId: '11111111-1111-4111-8111-111111111111',
        chatId: '22222222-2222-4222-8222-222222222222',
        workspaceId: '33333333-3333-4333-8333-333333333333',
      },
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
      chatId: '22222222-2222-4222-8222-222222222222',
      userId: 'user',
      workspaceId: '33333333-3333-4333-8333-333333333333',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
    })
    mocks.acquire.mockResolvedValue(true)
    mocks.claim.mockResolvedValue(true)
    mocks.events.mockResolvedValue([])
    mockResolveBillingAttribution.mockResolvedValue({
      actorUserId: 'user',
      workspaceId: '33333333-3333-4333-8333-333333333333',
    })
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
    expect(mocks.run).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'user')
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
      chatId: '22222222-2222-4222-8222-222222222222',
      previousToken: 'old-controller',
      token: 'stream\nnew-controller',
    })
    expect(mocks.start).toHaveBeenCalledOnce()
    const params = mocks.start.mock.calls[0][0]
    expect(params.requestPayload).toMatchObject(run.requestContext.recovery.request)
    expect(params.orchestrateOptions).toMatchObject({
      goRoute: '/api/mothership',
      userPermission: 'read',
      interactive: true,
      clientToolPickupExpected: false,
      recovery: {
        streamId: '11111111-1111-4111-8111-111111111111',
        userTimezone: 'Asia/Kolkata',
        requestMode: 'agent',
        events: [],
      },
    })
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user',
      workspaceId: '33333333-3333-4333-8333-333333333333',
    })
  })

  it('restores organization Assistant identity, filters and context without workspace authority', async () => {
    const organizationId = 'org-1'
    const { workspaceId, ...workspaceRequest } = run.requestContext.recovery.request
    const request = {
      ...workspaceRequest,
      organizationId,
      mode: 'assistant',
      assistantSearch: { source: 'slack', documentIds: ['document-1'] },
      context: [{ type: 'search_integrations', content: '{"connections":[]}' }],
    }
    mocks.run.mockResolvedValue({
      ...run,
      workspaceId: null,
      organizationId,
      requestContext: {
        ...run.requestContext,
        recovery: { ...run.requestContext.recovery, request, requestMode: 'assistant' },
      },
    })
    mocks.chat.mockResolvedValue({
      userId: 'user',
      chatId: run.chatId,
      organizationId,
      mode: 'assistant',
    })
    mockResolveOrganizationBillingAttribution.mockResolvedValue({
      actorUserId: 'user',
      workspaceId: null,
      organizationId,
    })
    await readChatStream.execute({ principal, input })
    expect(mocks.organizationAuthorize).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ id: 'mothership.runs.reconnect', capability: 'copilot.use' }),
      { organizationId }
    )
    expect(mocks.permission).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: undefined,
        organizationId,
        requestPayload: expect.objectContaining(request),
        orchestrateOptions: expect.objectContaining({
          organizationId,
          workspaceId: undefined,
          recovery: expect.objectContaining({ requestMode: 'assistant' }),
        }),
      })
    )
    mocks.organizationAuthorize.mockRejectedValueOnce(new Error('membership revoked'))
    mocks.start.mockClear()
    await expect(readChatStream.execute({ principal, input })).rejects.toThrow('membership revoked')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('refuses a run from a different organization before taking its controller', async () => {
    mocks.run.mockResolvedValue({ ...run, workspaceId: null, organizationId: 'org-1' })
    mocks.chat.mockResolvedValue({ userId: 'user', chatId: run.chatId, organizationId: 'org-2' })
    await expect(readChatStream.execute({ principal, input })).rejects.toThrow('Stream not found')
    expect(mocks.acquire).not.toHaveBeenCalled()
  })

  it('does not start after losing the database takeover race', async () => {
    mocks.claim.mockResolvedValue(false)
    await readChatStream.execute({ principal, input })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      {
        key: 'chat-lock',
        value: 'stream\nnew-controller',
      }
    )
  })

  it('releases its exact lease when recovery preparation fails', async () => {
    mocks.events.mockRejectedValue(new Error('buffer unavailable'))
    await expect(readChatStream.execute({ principal, input })).rejects.toThrow('buffer unavailable')
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      {
        key: 'chat-lock',
        value: 'stream\nnew-controller',
      }
    )
  })
})
