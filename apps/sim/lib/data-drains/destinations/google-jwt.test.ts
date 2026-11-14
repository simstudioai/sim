import { generateKeyPairSync } from 'node:crypto'
import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/network/config.server', () => networkConfigMock)

import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { createServiceAccountJwt } from '@/lib/data-drains/destinations/google-jwt'

const mockFetch = vi.fn()
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const account = { clientEmail: 'drain@project.iam.gserviceaccount.com', privateKey }

describe('createServiceAccountJwt', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
  })

  afterEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(false)
    networkConfigMockFns.mockResolveOutboundRoute.mockResolvedValue({ kind: 'direct' })
  })

  it("mints the access token on the drain organization's egress route", async () => {
    mockFetch.mockResolvedValue(
      Response.json({ access_token: 'minted', token_type: 'Bearer', expires_in: 3600 })
    )
    const jwt = createServiceAccountJwt(account, ['https://www.googleapis.com/auth/scope'])
    const { token } = await runWithOutboundOrganization('org-1', () => jwt.getAccessToken())
    expect(token).toBe('minted')
    expect(networkConfigMockFns.mockResolveOutboundRoute).toHaveBeenCalledWith('org-1')
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/token')
  })

  it('surfaces an unavailable egress route as Sim unavailability', async () => {
    networkConfigMockFns.mockResolveOutboundRoute.mockRejectedValue(
      new OutboundRoutingError('GATEWAY_UNAVAILABLE')
    )
    const jwt = createServiceAccountJwt(account, ['https://www.googleapis.com/auth/scope'])
    const error = await runWithOutboundOrganization('org-1', () => jwt.getAccessToken()).catch(
      (caught: unknown) => caught
    )
    expect(asOrchestrationError(error)?.code).toBe('unavailable')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
