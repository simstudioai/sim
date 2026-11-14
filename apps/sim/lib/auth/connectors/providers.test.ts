/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-capabilities.server', () => ({
  inspectConfiguredOAuthClient: () => ({ state: 'ready' }),
}))

import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { isUnavailableFailure } from '@/lib/core/orchestration/types'

const identityLookups = buildConnectorProviders().flatMap(({ providerId, getUserInfo }) =>
  getUserInfo ? [{ providerId, getUserInfo }] : []
)

describe('connector identity lookups during an egress outage', () => {
  it.each(identityLookups)(
    '$providerId rejects with the outage instead of reporting no profile',
    async ({ getUserInfo }) => {
      const fetchMock = vi.fn(async () => {
        throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      })
      vi.stubGlobal('fetch', fetchMock)

      const outcome = await getUserInfo({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        scopes: [],
      }).then(
        (value) => ({ rejected: false as const, value }),
        (error: unknown) => ({ rejected: true as const, error })
      )

      if (fetchMock.mock.calls.length === 0) return
      expect(outcome.rejected && isUnavailableFailure(outcome.error)).toBe(true)
    }
  )
})
