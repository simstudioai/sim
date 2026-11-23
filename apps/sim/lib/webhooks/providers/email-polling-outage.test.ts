import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing/mocks/auth-oauth-utils.mock'
import { queueTableRows } from '@sim/testing/mocks/database.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { describe, expect, it, vi } from 'vitest'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { gmailHandler } from '@/lib/webhooks/providers/gmail'
import { outlookHandler } from '@/lib/webhooks/providers/outlook'

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

describe.each([
  ['Gmail', gmailHandler],
  ['Outlook', outlookHandler],
])('%s polling setup during an egress outage', (_name, handler) => {
  it('reports the outage instead of a permissions failure', async () => {
    const outage = new OutboundRoutingError('GATEWAY_UNAVAILABLE')
    authOAuthUtilsMockFns.mockResolveOAuthAccountId.mockResolvedValueOnce({ accountId: 'acct-1' })
    queueTableRows(schemaMock.account, [{ userId: 'owner-1' }])
    authOAuthUtilsMockFns.mockRefreshAccessTokenIfNeeded.mockRejectedValueOnce(outage)

    const configurePolling = handler.configurePolling
    if (!configurePolling) throw new Error('Handler has no configurePolling')
    await expect(
      configurePolling({
        webhook: { id: 'webhook-1', providerConfig: { credentialId: 'cred-1' } },
        requestId: 'req-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        deploymentVersionId: null,
      })
    ).rejects.toBe(outage)
  })
})
