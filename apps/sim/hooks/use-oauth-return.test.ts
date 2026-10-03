import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireWorkspaceCredentialListResponse: vi.fn(),
}))

vi.mock('@sim/emcn', () => emcnMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/hooks/queries/utils/fetch-workspace-credentials', () => ({
  requireWorkspaceCredentialListResponse: mocks.requireWorkspaceCredentialListResponse,
}))

import { listOrganizationCredentialsContract } from '@/lib/api/contracts/organization-credentials'
import type { OAuthReturnContext } from '@/lib/credentials/client-state'
import {
  buildKnowledgeBaseOAuthReturnUrl,
  resolveOAuthCallbackError,
  resolveOAuthMessage,
} from '@/hooks/use-oauth-return'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

const context: OAuthReturnContext = {
  origin: 'integrations',
  displayName: 'New Gmail',
  providerId: 'google-email',
  preCount: 1,
  baselineCredentials: [
    {
      id: 'credential-existing',
      accountId: 'account-1',
      updatedAt: '2026-08-14T17:00:00.000Z',
    },
  ],
  workspaceId: 'workspace-1',
  requestedAt: Date.now(),
}

const existingCredential = {
  id: 'credential-existing',
  workspaceId: 'workspace-1',
  type: 'oauth' as const,
  displayName: 'Existing Gmail',
  description: null,
  providerId: 'google-email',
  accountId: 'account-1',
  envKey: null,
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-14T18:00:00.000Z',
}

describe('resolveOAuthMessage', () => {
  beforeEach(() => {
    mockRequestJson.mockResolvedValue({})
  })

  it('verifies organization OAuth against only the routed organization credentials', async () => {
    const orgContext: OAuthReturnContext = {
      ...context,
      workspaceId: undefined,
      organizationId: 'org-1',
    }
    mockRequestJson.mockResolvedValue({
      credentials: [
        existingCredential,
        { ...existingCredential, id: 'new-org-credential', displayName: context.displayName },
      ],
    })
    await expect(resolveOAuthMessage(orgContext)).resolves.toMatchObject({
      kind: 'success',
      credentialId: 'new-org-credential',
    })
    expect(mockRequestJson).toHaveBeenCalledWith(listOrganizationCredentialsContract, {
      query: { organizationId: 'org-1', type: 'oauth' },
    })
    expect(mocks.requireWorkspaceCredentialListResponse).not.toHaveBeenCalled()
  })

  it('does not choose an arbitrary account when multiple new credentials are ambiguous', async () => {
    mocks.requireWorkspaceCredentialListResponse.mockReturnValue([
      existingCredential,
      { ...existingCredential, id: 'credential-a' },
      { ...existingCredential, id: 'credential-b' },
    ])
    expect(await resolveOAuthMessage(context)).not.toHaveProperty('credentialId')
  })

  it('does not report success when the credential list is unchanged', async () => {
    mocks.requireWorkspaceCredentialListResponse.mockReturnValue([
      {
        ...existingCredential,
        updatedAt: context.baselineCredentials?.[0].updatedAt,
      },
    ])

    await expect(resolveOAuthMessage(context)).resolves.toEqual({
      kind: 'error',
      text: 'We couldn’t verify the "New Gmail" connection. Try again.',
    })
  })
})

describe('resolveOAuthCallbackError', () => {
  it('prevents a provider rejection from being reported as reconnect success', () => {
    expect(
      resolveOAuthCallbackError(
        'https://sim.ai/workspace/workspace-1/integrations?error=quickbooks_access_denied',
        context
      )
    ).toEqual({
      kind: 'error',
      text: 'The "New Gmail" connection didn’t finish. Try again.',
    })
  })
})

describe('buildKnowledgeBaseOAuthReturnUrl', () => {
  it('keeps connector identifiers within the source route path segment', () => {
    expect(
      buildKnowledgeBaseOAuthReturnUrl(
        { kind: 'organization', organizationId: 'org-1' },
        'kb-1',
        undefined,
        'connector/other?view=documents'
      )
    ).toBe(
      '/o/org-1/settings/integrations/sources/connector%2Fother%3Fview%3Ddocuments?view=settings'
    )
  })
})
