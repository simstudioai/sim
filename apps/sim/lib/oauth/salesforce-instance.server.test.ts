import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/network/config.server', () => networkConfigMock)

import { OutboundRoutingError } from '@/lib/core/network/routing'
import { fetchSalesforceInstanceUrl } from '@/lib/oauth/salesforce-instance.server'

const mockFetch = vi.fn()

describe('fetchSalesforceInstanceUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
  })

  afterEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(false)
    networkConfigMockFns.mockResolveOutboundRoute.mockResolvedValue({ kind: 'direct' })
  })

  it('propagates a blocked egress route instead of reporting an unverifiable account', async () => {
    networkConfigMockFns.mockResolveOutboundRoute.mockRejectedValue(
      new OutboundRoutingError('ROUTE_BLOCKED')
    )
    await expect(fetchSalesforceInstanceUrl('salesforce', 'token')).rejects.toBeInstanceOf(
      OutboundRoutingError
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
