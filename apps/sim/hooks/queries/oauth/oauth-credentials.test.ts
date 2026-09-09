/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))
vi.mock('@/hooks/queries/credentials', () => ({ useWorkspaceCredential: vi.fn() }))

import { listOAuthCredentialsContract } from '@/lib/api/contracts'
import {
  listOrganizationCredentialsContract,
  listOrganizationOAuthCredentialsContract,
} from '@/lib/api/contracts/organization-credentials'
import { fetchOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'

beforeEach(() => {
  mocks.request.mockReset()
})

describe('connector credential listing', () => {
  it('loads organization OAuth and mapped service accounts concurrently with exact scope and cancellation', async () => {
    const oauth = {
      id: 'oauth-1',
      name: 'Personal Drive',
      provider: 'google-drive',
      type: 'oauth',
      scopes: ['https://www.googleapis.com/auth/drive'],
    } as const
    const account = {
      id: 'service-1',
      displayName: 'Search service account',
      providerId: 'google-service-account',
      type: 'service_account',
    } as const
    const oauthResponse = Promise.withResolvers<{ credentials: (typeof oauth)[] }>()
    const accountResponse = Promise.withResolvers<{ credentials: (typeof account)[] }>()
    mocks.request.mockImplementation((contract) => {
      if (contract === listOrganizationOAuthCredentialsContract) return oauthResponse.promise
      if (contract === listOrganizationCredentialsContract) return accountResponse.promise
      throw new Error('Unexpected credential request')
    })
    const signal = new AbortController().signal

    const result = fetchOAuthCredentials(
      { organizationId: 'org-1', providerId: 'google-drive' },
      signal
    )

    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.request).toHaveBeenCalledWith(listOrganizationOAuthCredentialsContract, {
      query: { organizationId: 'org-1', providerId: 'google-drive' },
      signal,
    })
    expect(mocks.request).toHaveBeenCalledWith(listOrganizationCredentialsContract, {
      query: {
        organizationId: 'org-1',
        type: 'service_account',
        providerId: 'google-service-account',
      },
      signal,
    })
    oauthResponse.resolve({ credentials: [oauth] })
    accountResponse.resolve({ credentials: [account] })

    const credentials = await result
    expect(credentials).toHaveLength(2)
    expect(credentials[0]).toBe(oauth)
    expect(credentials[0].scopes).toEqual(oauth.scopes)
    expect(credentials[1]).toMatchObject({
      id: 'service-1',
      name: 'Search service account',
      type: 'service_account',
    })
    expect(credentials[1]).not.toHaveProperty('displayName')
  })

  it('does not request service accounts for a provider without service-account support', async () => {
    const credential = { id: 'chat-1', name: 'Personal Chat', provider: 'google-chat' }
    mocks.request.mockResolvedValue({ credentials: [credential] })

    await expect(
      fetchOAuthCredentials({ organizationId: 'org-1', providerId: 'google-chat' })
    ).resolves.toEqual([credential])
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(listOrganizationOAuthCredentialsContract, {
      query: { organizationId: 'org-1', providerId: 'google-chat' },
      signal: undefined,
    })
  })

  it.each([{ workspaceId: 'workspace-1' }, { workflowId: 'workflow-1' }])(
    'rejects organization requests with conflicting scope %o before querying',
    async (conflictingScope) => {
      await expect(
        fetchOAuthCredentials({
          organizationId: 'org-1',
          providerId: 'google-drive',
          ...conflictingScope,
        })
      ).rejects.toThrow('Organization credential listing cannot include a workspace or workflow')
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it('preserves the existing workspace response and workflow context', async () => {
    const credentials = [{ id: 'workspace-service', name: 'Shared Drive', type: 'service_account' }]
    const signal = new AbortController().signal
    mocks.request.mockResolvedValue({ credentials })

    await expect(
      fetchOAuthCredentials(
        { workspaceId: 'workspace-1', workflowId: 'workflow-1', providerId: 'google-drive' },
        signal
      )
    ).resolves.toBe(credentials)
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(listOAuthCredentialsContract, {
      query: { workspaceId: 'workspace-1', workflowId: 'workflow-1', provider: 'google-drive' },
      signal,
    })
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

  it('does not query credentials before a provider is selected', async () => {
    await expect(
      fetchOAuthCredentials({ organizationId: 'org-1', providerId: '' })
    ).resolves.toEqual([])
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
