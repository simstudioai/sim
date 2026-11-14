/**
 * Tests for the Teams subscription renewal cron route.
 */
import {
  authOAuthUtilsMock,
  authOAuthUtilsMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  redisConfigMockFns,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCredentialOwner, mockLoadWorkspaceApplicationContext } = vi.hoisted(() => ({
  mockGetCredentialOwner: vi.fn(),
  mockLoadWorkspaceApplicationContext: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => authInternalMock)
vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/lib/core/network/config.server', () => networkConfigMock)
vi.mock('@/lib/workspaces/application/context', () => ({
  loadWorkspaceApplicationContext: mockLoadWorkspaceApplicationContext,
}))
vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: mockGetCredentialOwner,
  getNotificationUrl: vi.fn(() => 'https://sim.test/api/webhooks/trigger/hook-1'),
}))

import { GET } from './route'

const mockVerifyCronAuth = authInternalMockFns.mockVerifyCronAuth

function createRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/renew-subscriptions'
  )
}

describe('Teams subscription renewal route (fire-and-forget)', () => {
  beforeEach(() => {
    resetDbChainMock()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    mockVerifyCronAuth.mockReturnValue(null)
  })

  it('skips with 202 when the lock is already held', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValueOnce(false)

    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'skip' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  describe('with outbound routing enabled', () => {
    const graphCalls: Array<{ url: string; organizationId: string | null | undefined }> = []
    let routeOrganizationId: string | null | undefined

    beforeEach(() => {
      graphCalls.length = 0
      networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
      networkConfigMockFns.mockResolveOutboundRoute.mockImplementation(async (organizationId) => {
        routeOrganizationId = organizationId
        return { kind: 'direct' }
      })
      mockLoadWorkspaceApplicationContext.mockResolvedValue({
        workspaceId: 'workspace-1',
        workspaceOrganizationId: 'org-1',
      })
      mockGetCredentialOwner.mockResolvedValue({ accountId: 'account-1', userId: 'user-1' })
      authOAuthUtilsMockFns.mockRefreshAccessTokenIfNeeded.mockResolvedValue('graph-token')
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          graphCalls.push({ url, organizationId: routeOrganizationId })
          return new Response(JSON.stringify({ expirationDateTime: '2030-01-01T00:00:00Z' }))
        })
      )
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(false)
    })

    it("renews each subscription through its workspace organization's outbound route", async () => {
      queueTableRows(schemaMock.webhook, [
        {
          workspaceId: 'workspace-1',
          webhook: {
            id: 'hook-1',
            providerConfig: {
              triggerId: 'microsoftteams_chat_subscription',
              subscriptionExpiration: new Date(Date.now() + 60_000).toISOString(),
              credentialId: 'credential-1',
              externalSubscriptionId: 'subscription-1',
            },
          },
        },
      ])

      const response = await GET(createRequest())
      expect(response.status).toBe(202)

      await vi.waitFor(() => expect(graphCalls).toHaveLength(1))
      expect(graphCalls[0]).toEqual({
        url: 'https://graph.microsoft.com/v1.0/subscriptions/subscription-1',
        organizationId: 'org-1',
      })
    })
  })
})
