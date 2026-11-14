import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetActiveConnectDraft, mockGetOAuthState } = vi.hoisted(() => ({
  mockGetActiveConnectDraft: vi.fn(),
  mockGetOAuthState: vi.fn(),
}))
const { mockLoadWorkspaceApplicationContext } = workspaceContextMockFns

vi.mock('better-auth/api', () => ({ getOAuthState: mockGetOAuthState }))
vi.mock('@/lib/core/network/config.server', () => networkConfigMock)
vi.mock('@/lib/credentials/connect-draft', () => ({
  getActiveConnectDraft: mockGetActiveConnectDraft,
}))
vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)

import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import {
  resolveConnectDraftOutboundScope,
  withConnectDraftOutboundScope,
} from '@/lib/oauth/connect-scope.server'

async function organizationSeenByVendorCall(
  draftOwner: { workspaceId: string | null; organizationId: string | null },
  requestedProviderId: string
): Promise<string | null | undefined> {
  mockGetActiveConnectDraft.mockResolvedValue({
    id: 'draft-1',
    providerId: 'instagram',
    ...draftOwner,
  })
  const inDraftScope = await resolveConnectDraftOutboundScope({
    draftId: 'draft-1',
    userId: 'user-1',
    providerId: requestedProviderId,
  })
  let organizationId: string | null | undefined
  networkConfigMockFns.mockResolveOutboundRoute.mockImplementation(async (id) => {
    organizationId = id
    return { kind: 'direct' }
  })
  await inDraftScope(() => resolveCurrentOutboundRoute())
  return organizationId
}

describe('resolveConnectDraftOutboundScope', () => {
  beforeEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
    mockLoadWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'org-1',
    })
  })

  afterEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(false)
  })

  it("routes vendor calls through the draft workspace's organization", async () => {
    await expect(
      organizationSeenByVendorCall(
        { workspaceId: 'workspace-1', organizationId: null },
        'instagram'
      )
    ).resolves.toBe('org-1')
    expect(mockGetActiveConnectDraft).toHaveBeenCalledWith('draft-1', 'user-1')
  })

  it('leaves vendor calls unscoped when the draft belongs to another provider', async () => {
    await expect(
      organizationSeenByVendorCall({ workspaceId: 'workspace-1', organizationId: null }, 'trello')
    ).resolves.toBeUndefined()
  })
})

describe('withConnectDraftOutboundScope', () => {
  beforeEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
  })

  afterEach(() => {
    networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(false)
  })

  it("runs a generic connector's code exchange in its connect draft's organization", async () => {
    mockGetOAuthState.mockResolvedValue({
      callbackURL: '/workspace/ws-1/integrations?credentialDraftId=draft-1',
      link: { userId: 'user-1', email: 'user@example.com' },
    })
    mockGetActiveConnectDraft.mockResolvedValue({
      id: 'draft-1',
      providerId: 'jira',
      workspaceId: null,
      organizationId: 'org-1',
    })
    let organizationId: string | null | undefined
    networkConfigMockFns.mockResolveOutboundRoute.mockImplementation(async (id) => {
      organizationId = id
      return { kind: 'direct' }
    })
    const connector = withConnectDraftOutboundScope({
      providerId: 'jira',
      clientId: 'client',
      getToken: async () => {
        await resolveCurrentOutboundRoute()
        return { accessToken: 'token' }
      },
    })

    await connector.getToken?.({ code: 'code', redirectURI: 'https://sim.test/callback' })

    expect(organizationId).toBe('org-1')
    expect(mockGetActiveConnectDraft).toHaveBeenCalledWith('draft-1', 'user-1')
  })
})
