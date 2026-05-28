/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/auth-client', () => ({
  client: { oauth2: { link: vi.fn() } },
  useSession: vi.fn(() => ({ data: null, isPending: false, error: null })),
}))

vi.mock('@/lib/credentials/client-state', () => ({
  writeOAuthReturnContext: vi.fn(),
}))

vi.mock('@/hooks/queries/credentials', () => ({
  useCreateCredentialDraft: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

vi.mock('@/lib/oauth', () => ({
  getCanonicalScopesForProvider: vi.fn(() => []),
  getProviderIdFromServiceId: vi.fn((id: string) => id),
  OAUTH_PROVIDERS: {},
  parseProvider: vi.fn((p: string) => ({ baseProvider: p, variant: null })),
}))

vi.mock('@/lib/oauth/utils', () => ({
  getScopeDescription: vi.fn((s: string) => s),
}))

import { getDefaultCredentialName } from '@/app/workspace/[workspaceId]/components/oauth-modal'

describe('getDefaultCredentialName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the user name when available', () => {
    expect(getDefaultCredentialName('Waleed', 'Google Drive', 0)).toBe("Waleed's Google Drive 1")
  })

  it('increments the number based on existing credential count', () => {
    expect(getDefaultCredentialName('Waleed', 'Google Drive', 2)).toBe("Waleed's Google Drive 3")
  })

  it('falls back to "My" when user name is null', () => {
    expect(getDefaultCredentialName(null, 'Slack', 0)).toBe('My Slack 1')
  })

  it('falls back to "My" when user name is undefined', () => {
    expect(getDefaultCredentialName(undefined, 'Gmail', 1)).toBe('My Gmail 2')
  })

  it('falls back to "My" when user name is empty string', () => {
    expect(getDefaultCredentialName('', 'GitHub', 0)).toBe('My GitHub 1')
  })

  it('falls back to "My" when user name is whitespace-only', () => {
    expect(getDefaultCredentialName('   ', 'Notion', 0)).toBe('My Notion 1')
  })

  it('trims whitespace from user name', () => {
    expect(getDefaultCredentialName('  Waleed  ', 'Linear', 0)).toBe("Waleed's Linear 1")
  })

  it('works with zero existing credentials', () => {
    expect(getDefaultCredentialName('Alice', 'Jira', 0)).toBe("Alice's Jira 1")
  })

  it('works with many existing credentials', () => {
    expect(getDefaultCredentialName('Bob', 'Slack', 9)).toBe("Bob's Slack 10")
  })
})
