import { resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { resolveCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'

beforeEach(resetDbChainMock)

describe('resolveCoordinatedClientToken', () => {
  it("surfaces an unavailable egress route as Sim's outage instead of a provider failure", async () => {
    const exchange = vi.fn().mockRejectedValue(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))

    await expect(
      resolveCoordinatedClientToken({
        namespace: 'fixture',
        application: ['fixture-client'],
        clientSecret: 'fixture-secret',
        step: 'fixture_token',
        exchange,
      })
    ).rejects.toBeInstanceOf(OutboundRoutingError)
    expect(exchange).toHaveBeenCalledOnce()
  })
})
