import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  personal: vi.fn(),
  tokens: vi.fn(),
  context: vi.fn(),
  visibility: vi.fn(),
  resolve: vi.fn(),
  managed: vi.fn(),
  mcp: vi.fn(),
  admin: vi.fn(),
  resolveAdmin: vi.fn(),
  approvals: vi.fn(),
}))
vi.mock('@/lib/knowledge/search/integration-policy', () => ({
  listOrganizationSearchApprovals: mocks.approvals,
}))
vi.mock('@/lib/sim-search/live/gitlab-admin', () => ({
  listAdminGitLabAccounts: mocks.admin,
  resolveAdminGitLabAccount: mocks.resolveAdmin,
}))
vi.mock('@/lib/sim-search/live/mcp-accounts', () => ({ listCodaMcpSearchAccounts: mocks.mcp }))
vi.mock('@/lib/credentials/personal', () => ({ getPersonalOAuthCredentials: mocks.personal }))
vi.mock('@/lib/credentials/personal-tokens', () => ({
  getPersonalTokenCredentials: mocks.tokens,
  requirePersonalTokenEnrollment: vi.fn(),
}))
vi.mock('@/lib/credentials/organization-managed', () => ({
  getOwnOrganizationManagedOAuthCredentials: mocks.managed,
}))
vi.mock('@/lib/credentials/application/workspace-account-visibility', () => ({
  filterWorkspaceAccountCredentials: mocks.visibility,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.context,
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveCredentialTokenBundle: mocks.resolve }))
vi.mock('@/lib/credentials/managed-oauth', () => ({ resolveManagedOAuthToken: vi.fn() }))

import { listLiveAccounts, resolveLiveAccount } from '@/lib/sim-search/live/accounts'

const owner = { workspaceId: 'workspace' }
const account = { id: 'mine', providerId: 'google-drive', displayName: 'My Drive', type: 'oauth' }
function metadata(revokedAt: Date | null = null) {
  mocks.approvals.mockResolvedValue(new Map([['google_drive', true]]))
  queueTableRows(schemaMock.credential, []) // Coda discovery
  queueTableRows(schemaMock.credential, [
    { id: 'mine', scope: 'drive.readonly', grantedScopes: null, revokedAt },
  ])
}

describe('live account discovery boundaries', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.personal.mockResolvedValue([account])
    mocks.tokens.mockResolvedValue([])
    mocks.managed.mockResolvedValue([])
    mocks.mcp.mockResolvedValue([])
    mocks.admin.mockResolvedValue([])
    mocks.approvals.mockResolvedValue(new Map())
    mocks.context.mockResolvedValue({ workspaceId: 'workspace', workspaceOrganizationId: 'org' })
    mocks.visibility.mockImplementation(async (_context, rows) => rows)
  })
  it('uses only administrator-managed GitLab sources, never personal GitLab tokens', async () => {
    mocks.approvals.mockResolvedValue(new Map([['gitlab', true]]))
    mocks.tokens.mockResolvedValue([
      {
        id: 'personal-gitlab',
        providerId: 'gitlab',
        displayName: 'personal',
        type: 'personal_token',
      },
    ])
    mocks.admin.mockResolvedValue([
      {
        id: 'gitlab-source:source',
        provider: 'gitlab',
        type: 'admin_source',
        displayName: 'GitLab',
      },
    ])
    expect(await listLiveAccounts(owner, 'reader')).toMatchObject([
      { id: 'gitlab-source:source', type: 'admin_source' },
    ])
  })
  it('does not discover or decrypt admin-managed sources when GitLab is disabled', async () => {
    await listLiveAccounts(owner, 'reader')
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.resolveAdmin).not.toHaveBeenCalled()
  })
  it('discovers the current person and applies the workspace credential policy', async () => {
    metadata()
    expect(await listLiveAccounts(owner, 'reader')).toMatchObject([
      { id: 'mine', provider: 'google_drive', scopes: ['drive.readonly'] },
    ])
    expect(mocks.personal).toHaveBeenCalledWith('workspace', 'reader')
    expect(mocks.visibility).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceOrganizationId: 'org' }),
      expect.any(Array)
    )
  })
  it('honors an organization provider denial even in workspace search', async () => {
    mocks.approvals.mockResolvedValue(new Map([['google_drive', false]]))
    expect(await listLiveAccounts(owner, 'reader')).toEqual([])
    expect(mocks.visibility).toHaveBeenCalledWith(expect.anything(), [])
  })
  it('does not expose grants hidden by the workspace sharing policy', async () => {
    mocks.visibility.mockResolvedValue([])
    expect(await listLiveAccounts(owner, 'reader')).toEqual([])
  })
  it('rechecks revocation before resolving or decrypting a token', async () => {
    metadata(new Date())
    await expect(resolveLiveAccount(owner, 'reader', 'mine')).rejects.toMatchObject({
      status: 'reconnect',
    })
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('does not resolve another account even when the caller knows its ID', async () => {
    metadata()
    await expect(resolveLiveAccount(owner, 'reader', 'someone-else')).rejects.toMatchObject({
      status: 'reconnect',
    })
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
