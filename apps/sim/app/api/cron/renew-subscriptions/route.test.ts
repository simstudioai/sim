/**
 * Tests for the Teams subscription renewal cron route.
 *
 * @vitest-environment node
 */

import { webhook } from '@sim/db/schema'
import {
  authOAuthUtilsMock,
  authOAuthUtilsMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  redisConfigMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
  detached: vi.fn<(label: string, work: () => Promise<unknown>) => void>(),
  enabled: vi.fn(() => true),
  workspace: vi.fn(),
  route: vi.fn(async (organizationId: string | null | undefined) => ({ organizationId })),
  fetch: vi.fn<typeof fetch>(),
  credentialOwner: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mocks.mockVerifyCronAuth,
}))

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/lib/core/utils/background', () => ({ runDetached: mocks.detached }))
vi.mock('@/lib/core/network/config.server', () => ({
  isOutboundRoutingEnabled: mocks.enabled,
  resolveOutboundRoute: mocks.route,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mocks.fetch,
}))
vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: mocks.credentialOwner,
  getNotificationUrl: () => 'https://example.com/api/webhooks/trigger/teams',
}))

import {
  resolveCurrentOutboundRoute,
  runWithOutboundOrganization,
} from '@/lib/core/network/context.server'
import { GET } from '@/app/api/cron/renew-subscriptions/route'

const NEW_EXPIRATION = '2030-01-04T00:00:00.000Z'

function createRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/renew-subscriptions'
  )
}

function expiringWebhook(id: string, workspaceId: string | null) {
  return {
    workspaceId,
    webhook: {
      id,
      workflowId: `workflow-${id}`,
      providerConfig: {
        triggerId: 'microsoftteams_chat_subscription',
        subscriptionExpiration: new Date(Date.now() + 60_000).toISOString(),
        credentialId: 'shared-credential',
        externalSubscriptionId: `subscription-${id}`,
        chatId: 'chat-1',
      },
    },
  }
}

async function runBackground() {
  expect(mocks.detached).toHaveBeenCalledExactlyOnceWith(
    'teams-subscription-renewal',
    expect.any(Function)
  )
  await mocks.detached.mock.calls[0][1]()
}

describe('Teams subscription renewal route (fire-and-forget)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    mocks.mockVerifyCronAuth.mockReturnValue(null)
    mocks.enabled.mockReturnValue(true)
    mocks.workspace.mockResolvedValue({ workspaceOrganizationId: 'org-1' })
    mocks.credentialOwner.mockResolvedValue({ accountId: 'account-1', userId: 'credential-owner' })
    authOAuthUtilsMockFns.mockRefreshAccessTokenIfNeeded.mockImplementation(async () => {
      await resolveCurrentOutboundRoute()
      return 'access-token'
    })
    mocks.fetch.mockImplementation(async () => {
      await resolveCurrentOutboundRoute()
      return Response.json({ expirationDateTime: NEW_EXPIRATION })
    })
  })

  it('returns the auth error when cron auth fails', async () => {
    mocks.mockVerifyCronAuth.mockReturnValueOnce(new Response(null, { status: 401 }) as never)

    const response = await GET(createRequest())

    expect(response.status).toBe(401)
    expect(redisConfigMockFns.mockAcquireLock).not.toHaveBeenCalled()
    expect(mocks.detached).not.toHaveBeenCalled()
  })

  it('acknowledges with 202 and renews in the background after acquiring the lock', async () => {
    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'started' })
    expect(redisConfigMockFns.mockAcquireLock).toHaveBeenCalledWith(
      'teams-subscription-renewal-lock',
      expect.any(String),
      expect.any(Number),
      { reclaimOnFailure: true }
    )

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    await runBackground()
    expect(dbChainMockFns.select).toHaveBeenCalled()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'teams-subscription-renewal-lock',
      expect.any(String)
    )
  })

  it('skips with 202 when the lock is already held', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValueOnce(false)

    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'skip' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.detached).not.toHaveBeenCalled()
  })

  it('scopes refresh and Graph calls by each canonical workspace, not the credential owner', async () => {
    queueTableRows(webhook, [
      expiringWebhook('first', 'workspace-1'),
      expiringWebhook('second', 'workspace-2'),
    ])
    mocks.workspace
      .mockResolvedValueOnce({ workspaceOrganizationId: 'org-1' })
      .mockResolvedValueOnce({ workspaceOrganizationId: null })

    await GET(createRequest())
    await runWithOutboundOrganization('caller-org', runBackground)

    expect(mocks.workspace.mock.calls).toEqual([['workspace-1'], ['workspace-2']])
    expect(mocks.route.mock.calls).toEqual([['org-1'], ['org-1'], [null], [null]])
    expect(mocks.fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['https://graph.microsoft.com/v1.0/subscriptions/subscription-first', 'PATCH'],
      ['https://graph.microsoft.com/v1.0/subscriptions/subscription-second', 'PATCH'],
    ])
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
    expect(await resolveCurrentOutboundRoute()).toEqual({ organizationId: undefined })
  })

  it.each([404, 410])(
    'recreates an expired subscription through the same scope after Graph returns %s',
    async (status) => {
      queueTableRows(webhook, [expiringWebhook('expired', 'workspace-1')])
      mocks.fetch
        .mockImplementationOnce(async () => {
          await resolveCurrentOutboundRoute()
          return Response.json({ error: { message: 'Subscription expired' } }, { status })
        })
        .mockImplementationOnce(async () => {
          await resolveCurrentOutboundRoute()
          return Response.json({ id: 'replacement', expirationDateTime: NEW_EXPIRATION })
        })

      await GET(createRequest())
      await runBackground()

      expect(mocks.route.mock.calls).toEqual([['org-1'], ['org-1'], ['org-1']])
      expect(mocks.fetch).toHaveBeenLastCalledWith(
        'https://graph.microsoft.com/v1.0/subscriptions',
        expect.objectContaining({ method: 'POST' })
      )
      expect(dbChainMockFns.set).toHaveBeenCalledExactlyOnceWith({
        providerConfig: expect.objectContaining({
          externalSubscriptionId: 'replacement',
          subscriptionExpiration: NEW_EXPIRATION,
        }),
        updatedAt: expect.any(Date),
      })
    }
  )

  it.each([null, 'removed-workspace'])(
    'skips unresolved workspace %s without provider calls and renews the next webhook',
    async (workspaceId) => {
      queueTableRows(webhook, [
        expiringWebhook('unresolved', workspaceId),
        expiringWebhook('valid', 'workspace-1'),
      ])
      mocks.workspace.mockImplementation(async (id: string) =>
        id === 'workspace-1' ? { workspaceOrganizationId: 'org-1' } : null
      )

      await GET(createRequest())
      await runBackground()

      expect(authOAuthUtilsMockFns.mockRefreshAccessTokenIfNeeded).toHaveBeenCalledOnce()
      expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
        'https://graph.microsoft.com/v1.0/subscriptions/subscription-valid',
        expect.objectContaining({ method: 'PATCH' })
      )
      expect(dbChainMockFns.set).toHaveBeenCalledOnce()
      expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledOnce()
    }
  )

  it('continues after a routed provider failure and releases the lock', async () => {
    queueTableRows(webhook, [
      expiringWebhook('failed', 'workspace-1'),
      expiringWebhook('valid', 'workspace-2'),
    ])
    mocks.workspace
      .mockResolvedValueOnce({ workspaceOrganizationId: 'org-1' })
      .mockResolvedValueOnce({ workspaceOrganizationId: 'org-2' })
    mocks.fetch.mockImplementationOnce(async () => {
      await resolveCurrentOutboundRoute()
      throw new Error('Gateway unavailable')
    })

    await GET(createRequest())
    await runBackground()

    expect(mocks.route.mock.calls).toEqual([['org-1'], ['org-1'], ['org-2'], ['org-2']])
    expect(dbChainMockFns.set).toHaveBeenCalledOnce()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledOnce()
  })

  it.each(['workspace-1', null])(
    'renews legacy workspace %s without an extra lookup when routing is unconfigured',
    async (workspaceId) => {
      mocks.enabled.mockReturnValue(false)
      queueTableRows(webhook, [expiringWebhook('default', workspaceId)])

      await GET(createRequest())
      await runBackground()

      expect(mocks.workspace).not.toHaveBeenCalled()
      expect(mocks.fetch).toHaveBeenCalledOnce()
      expect(dbChainMockFns.set).toHaveBeenCalledOnce()
    }
  )
})
