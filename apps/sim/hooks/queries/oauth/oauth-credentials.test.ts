import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))
vi.mock('@/hooks/queries/credentials', () => ({ useWorkspaceCredential: vi.fn() }))

import { listOrganizationOAuthCredentialsContract } from '@/lib/api/contracts/organization-credentials'
import { fetchOAuthCredentials, oauthCredentialKeys } from '@/hooks/queries/oauth/oauth-credentials'

beforeEach(() => {
  mocks.request.mockReset()
})

describe('connector credential listing', () => {
  it('requests own managed accounts only for the isolated organization browsing cache', async () => {
    const memberAccount = {
      id: 'managed-1',
      name: 'My Jira',
      provider: 'jira',
      type: 'managed_oauth',
    }
    const signal = new AbortController().signal
    mocks.request.mockImplementation((contract) =>
      Promise.resolve({
        credentials: contract === listOrganizationOAuthCredentialsContract ? [memberAccount] : [],
      })
    )
    await expect(
      fetchOAuthCredentials(
        { organizationId: 'org-1', providerId: 'jira', purpose: 'browsing' },
        signal
      )
    ).resolves.toEqual([memberAccount])
    expect(mocks.request).toHaveBeenCalledWith(listOrganizationOAuthCredentialsContract, {
      query: { organizationId: 'org-1', providerId: 'jira', purpose: 'browsing' },
      signal,
    })
    expect(oauthCredentialKeys.list('jira', undefined, undefined, 'org-1', 'browsing')).not.toEqual(
      oauthCredentialKeys.list('jira', undefined, undefined, 'org-1')
    )
  })

  it('does not report a partial credential list as successful when service-account access fails', async () => {
    const failure = new Error('Access denied')
    mocks.request.mockImplementation((contract) =>
      contract === listOrganizationOAuthCredentialsContract
        ? Promise.resolve({ credentials: [] })
        : Promise.reject(failure)
    )

    await expect(
      fetchOAuthCredentials({ organizationId: 'org-1', providerId: 'google-drive' })
    ).rejects.toBe(failure)
  })
})
