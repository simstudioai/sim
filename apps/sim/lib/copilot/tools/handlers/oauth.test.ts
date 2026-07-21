/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureWorkspaceAccess, mockGetCredentialActorContext } = vi.hoisted(() => ({
  mockEnsureWorkspaceAccess: vi.fn(),
  mockGetCredentialActorContext: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkspaceAccess: mockEnsureWorkspaceAccess,
}))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mockGetCredentialActorContext,
}))

vi.mock('@/lib/oauth/utils', () => ({
  getAllOAuthServices: vi.fn(() => [
    { providerId: 'google-email', name: 'Gmail' },
    { providerId: 'slack', name: 'Slack' },
    { providerId: 'trello', name: 'Trello' },
    { providerId: 'shopify', name: 'Shopify' },
  ]),
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeOAuthGetAuthLink } from '@/lib/copilot/tools/handlers/oauth'

const BASE_URL = 'https://sim.test'
const WORKSPACE_ID = 'ws-1'
const USER_ID = 'user-1'
const CREDENTIAL_ID = 'cred-1'

const context = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  chatId: 'chat-1',
} as unknown as ExecutionContext

const WORKSPACE_ACCESS = {
  exists: true,
  hasAccess: true,
  canWrite: true,
  canAdmin: false,
  workspace: { id: WORKSPACE_ID },
}

function oauthCredentialActor(overrides: Record<string, unknown> = {}) {
  return {
    credential: {
      id: CREDENTIAL_ID,
      workspaceId: WORKSPACE_ID,
      type: 'oauth',
      providerId: 'google-email',
      ...((overrides.credential as Record<string, unknown>) ?? {}),
    },
    member: null,
    hasWorkspaceAccess: true,
    canWriteWorkspace: true,
    isAdmin: true,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'credential')),
  }
}

describe('executeOAuthGetAuthLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = BASE_URL
    mockEnsureWorkspaceAccess.mockResolvedValue(WORKSPACE_ACCESS)
  })

  describe('connect (no credentialId)', () => {
    it('returns an authorize URL without a credentialId param', async () => {
      const result = await executeOAuthGetAuthLink({ providerName: 'google-email' }, context)

      expect(result.success).toBe(true)
      const url = new URL((result.output as { oauth_url: string }).oauth_url)
      expect(url.pathname).toBe('/api/auth/oauth2/authorize')
      expect(url.searchParams.get('providerId')).toBe('google-email')
      expect(url.searchParams.get('credentialId')).toBeNull()
      expect(mockGetCredentialActorContext).not.toHaveBeenCalled()
    })
  })

  describe('reconnect (credentialId passed)', () => {
    it('returns an authorize URL carrying the credentialId and a reconnect message', async () => {
      mockGetCredentialActorContext.mockResolvedValue(oauthCredentialActor())

      const result = await executeOAuthGetAuthLink(
        { providerName: 'google-email', credentialId: CREDENTIAL_ID },
        context
      )

      expect(result.success).toBe(true)
      const output = result.output as { oauth_url: string; message: string }
      const url = new URL(output.oauth_url)
      expect(url.searchParams.get('credentialId')).toBe(CREDENTIAL_ID)
      expect(output.message).toContain('Reconnect')
      expect(output.message).toContain(CREDENTIAL_ID)
    })

    it('reuses the already-resolved workspace access for the credential lookup', async () => {
      mockGetCredentialActorContext.mockResolvedValue(oauthCredentialActor())

      await executeOAuthGetAuthLink(
        { providerName: 'google-email', credentialId: CREDENTIAL_ID },
        context
      )

      expect(mockGetCredentialActorContext).toHaveBeenCalledWith(CREDENTIAL_ID, USER_ID, {
        workspaceAccess: WORKSPACE_ACCESS,
      })
    })

    it('fails with an agent-visible error for a nonexistent credential', async () => {
      mockGetCredentialActorContext.mockResolvedValue({
        credential: null,
        member: null,
        hasWorkspaceAccess: false,
        canWriteWorkspace: false,
        isAdmin: false,
      })

      const result = await executeOAuthGetAuthLink(
        { providerName: 'google-email', credentialId: 'cred-hallucinated' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found in this workspace')
    })

    it('fails when the credential belongs to another workspace', async () => {
      mockGetCredentialActorContext.mockResolvedValue(
        oauthCredentialActor({ credential: { workspaceId: 'ws-other' } })
      )

      const result = await executeOAuthGetAuthLink(
        { providerName: 'google-email', credentialId: CREDENTIAL_ID },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found in this workspace')
    })

    it('fails when the credential is not an OAuth credential', async () => {
      mockGetCredentialActorContext.mockResolvedValue(
        oauthCredentialActor({ credential: { type: 'env_workspace' } })
      )

      const result = await executeOAuthGetAuthLink(
        { providerName: 'google-email', credentialId: CREDENTIAL_ID },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not an OAuth credential')
    })

    it('fails naming the actual provider when providerName does not match the credential', async () => {
      mockGetCredentialActorContext.mockResolvedValue(oauthCredentialActor())

      const result = await executeOAuthGetAuthLink(
        { providerName: 'slack', credentialId: CREDENTIAL_ID },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('google-email')
    })

    it('fails when the caller is not a credential admin', async () => {
      mockGetCredentialActorContext.mockResolvedValue(oauthCredentialActor({ isAdmin: false }))

      const result = await executeOAuthGetAuthLink(
        { providerName: 'google-email', credentialId: CREDENTIAL_ID },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Admin access')
    })

    it('rejects reconnect for Trello and directs the user to the integrations page', async () => {
      const result = await executeOAuthGetAuthLink(
        { providerName: 'trello', credentialId: CREDENTIAL_ID },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('integrations page')
      expect(mockGetCredentialActorContext).not.toHaveBeenCalled()
    })

    it('rejects reconnect for Shopify and directs the user to the integrations page', async () => {
      const result = await executeOAuthGetAuthLink(
        { providerName: 'shopify', credentialId: CREDENTIAL_ID },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('integrations page')
      expect(mockGetCredentialActorContext).not.toHaveBeenCalled()
    })
  })
})

describe('executeOAuthGetAuthLink service account rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = BASE_URL
    mockEnsureWorkspaceAccess.mockResolvedValue(WORKSPACE_ACCESS)
  })

  /**
   * Regression: a user asked for a "new custom bot", the agent correctly
   * resolved that to `slack-custom-bot` and passed it here, and the fuzzy
   * substring pass matched it to the Slack OAuth service — `slack-custom-bot`
   * contains `slack`. The tool returned a personal-OAuth authorize URL and
   * reported success, so the user connected their own account instead of a
   * shared bot. Failing loudly is the point: a wrong link that looks right is
   * worse than an error the agent can recover from.
   */
  it('rejects a service account id with a coherent recovery message, not a workspace link', async () => {
    const result = await executeOAuthGetAuthLink({ providerName: 'slack-custom-bot' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('service account')
    expect(result.error).toContain('service_account credential tag')
    const output = result.output as { setup_url?: string; oauth_url?: string; message: string }
    // The rejection must not fall into the generic catch, which would attach a
    // contradicting workspace oauth_url and a "connect manually" message — the
    // agent would then surface a workspace link instead of the tag.
    expect(output.setup_url).toBeUndefined()
    expect(output.oauth_url).toBeUndefined()
    expect(output.message).toContain('service_account credential tag')
    expect(output.message).not.toContain('Connect manually')
  })

  it.each([
    'notion-service-account',
    'salesforce-service-account',
    'google-service-account',
    'atlassian-service-account',
    'SLACK-CUSTOM-BOT',
    // Readable forms must be normalized (spaces/underscores → hyphens) so they
    // are caught too, not passed to the fuzzy OAuth resolver.
    'slack custom bot',
    'google service account',
    'notion_service_account',
  ])('rejects %s', async (providerName) => {
    const result = await executeOAuthGetAuthLink({ providerName }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('service_account credential tag')
  })

  it('still resolves ordinary OAuth providers for integrations that also offer a service account', async () => {
    // `slack` and `notion` must keep working — the guard keys off the id being
    // a service-account id, not off the integration having a service-account flow.
    for (const providerName of ['slack', 'google-email']) {
      const result = await executeOAuthGetAuthLink({ providerName }, context)
      expect(result.success).toBe(true)
      expect((result.output as { oauth_url: string }).oauth_url).toContain(
        '/api/auth/oauth2/authorize'
      )
    }
  })
})
