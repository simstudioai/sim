/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetchProviderJson = vi.hoisted(() => vi.fn())

vi.mock('@/lib/selectors/server/providers/provider-http', () => ({
  fetchProviderJson: mockFetchProviderJson,
}))

import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { resolveSelectorAtlassianCloudId } from '@/lib/selectors/server/providers/atlassian'

describe('Atlassian server selector authentication', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts only a service-account cloud id bound to the selected domain', async () => {
    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: 'https://ACME.atlassian.net/',
        providedCloudId: 'cloud-1',
        providedDomain: 'acme.atlassian.net',
        product: 'Jira',
      })
    ).resolves.toBe('cloud-1')
    expect(mockFetchProviderJson).not.toHaveBeenCalled()

    await expect(
      resolveSelectorAtlassianCloudId({
        accessToken: 'server-only-token',
        domain: 'other.atlassian.net',
        providedCloudId: 'cloud-1',
        providedDomain: 'acme.atlassian.net',
        product: 'Jira',
      })
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mockFetchProviderJson).not.toHaveBeenCalled()
  })
})
