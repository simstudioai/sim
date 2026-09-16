/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  decrypt: vi.fn(),
  parseBinding: vi.fn(),
  list: vi.fn(),
  resolve: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@/lib/credentials/application/organization-credentials', () => ({
  authorizeOrganizationCredentialUse: mocks.authorize,
}))
vi.mock('@/lib/oauth/github-installation', () => ({
  GitHubInstallationError: class extends Error {},
  parseGitHubInstallationBinding: mocks.parseBinding,
  listGitHubInstallationRepositories: mocks.list,
  resolveGitHubInstallationRepository: mocks.resolve,
}))

import { githubSelectorAttachments } from '@/lib/selectors/server/providers/github'

const principal = { kind: 'session', userId: 'admin', sessionId: 'session' } as const
const binding = { installationId: '21', accountId: '11' }
const row = {
  organizationId: 'org-1',
  workspaceId: null,
  type: 'service_account',
  providerSubjectId: '21',
  providerTenantId: '11',
  encryptedServiceAccountKey: 'encrypted',
}
function args(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'github.installationRepositories',
    principal,
    requesterUserId: principal.userId,
    scope: { kind: 'organization', organizationId: 'org-1' },
    organizationId: 'org-1',
    context: { oauthCredential: 'credential-1' },
    credential: {
      suppliedId: 'credential-1',
      providerId: 'github-app-installation',
      organization: { principal, organizationId: 'org-1' },
    },
    request: { kind: 'list' },
    references: new Map(),
    protectedValues: { add: vi.fn(), contains: () => false, containsExceptExact: () => false },
  }
}
const execute = (input: ExecuteServerSelectorArgs) =>
  githubSelectorAttachments['github.installationRepositories'].execute(input)

describe('GitHub installation repository selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ credential: row })
    mocks.decrypt.mockResolvedValue({ decrypted: '{}' })
    mocks.parseBinding.mockReturnValue(binding)
    mocks.list.mockResolvedValue({
      repositories: [{ id: '101', fullName: 'team/repo' }],
      hasMore: true,
    })
  })
  it('rechecks the acting admin connection and passes only bounded repository options', async () => {
    const input = args()
    input.request = { kind: 'list', cursor: '2' }
    input.signal = new AbortController().signal
    expect(await execute(input)).toEqual({
      kind: 'list',
      items: [{ id: 'team/repo', label: 'team/repo' }],
      nextCursor: '3',
    })
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        organizationId: 'org-1',
        credentialId: 'credential-1',
        expectedProviderId: 'github-app-installation',
      })
    )
    expect(mocks.list).toHaveBeenCalledWith(binding, { page: 2, signal: input.signal })
  })
  it.each(['0', '101', '2.5', 'https://evil.example', '02'])(
    'refuses cursor %s before reading secrets',
    async (cursor) => {
      const input = args()
      input.request = { kind: 'list', cursor }
      await expect(execute(input)).rejects.toThrow('Context unavailable')
      expect(mocks.authorize).not.toHaveBeenCalled()
      expect(mocks.list).not.toHaveBeenCalled()
    }
  )
  it('refuses workspace and mismatched organization scope', async () => {
    await expect(
      execute({ ...args(), scope: { kind: 'workspace', workspaceId: 'ws-1' } })
    ).rejects.toThrow('Context unavailable')
    await expect(execute({ ...args(), organizationId: 'org-2' })).rejects.toThrow(
      'Context unavailable'
    )
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
  it('never reads provider data after credential authorization fails', async () => {
    mocks.authorize.mockRejectedValue(new Error('Forbidden'))
    await expect(execute(args())).rejects.toThrow('Forbidden')
    expect(mocks.decrypt).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it.each([
    { ...row, organizationId: 'other' },
    { ...row, workspaceId: 'ws' },
    { ...row, providerSubjectId: '22' },
    { ...row, providerTenantId: '12' },
  ])('refuses a stale or mismatched stored binding %#', async (credential) => {
    mocks.authorize.mockResolvedValue({ credential })
    await expect(execute(args())).rejects.toThrow('Connection unavailable')
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('bounds the last repository page explicitly', async () => {
    const input = args()
    input.request = { kind: 'list', cursor: '100' }
    expect(await execute(input)).toMatchObject({
      diagnostics: { truncated: { reason: 'provider-cap', pages: 100 } },
    })
  })
})
