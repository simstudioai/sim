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
    mockEnsureWorkspaceAccess.mockResolvedValue(undefined)
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
