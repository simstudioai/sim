/** @vitest-environment node */
import { pendingCredentialDraft } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  context: vi.fn(),
  clear: vi.fn(),
  deleteOrphan: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@sim/audit', () => ({
  recordAudit: mocks.audit,
  AuditAction: { CREDENTIAL_CREATED: 'created', CREDENTIAL_RECONNECTED: 'reconnected' },
  AuditResourceType: { CREDENTIAL: 'credential' },
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mocks.lock,
}))
vi.mock('@/lib/credentials/organization', () => ({
  getCredentialCreationOrganizationContext: mocks.context,
}))
vi.mock('@/lib/credentials/deletion', () => ({ deleteOrphanedOAuthAccount: mocks.deleteOrphan }))
vi.mock('@/lib/oauth/refresh-coordination', () => ({ clearOAuthRefreshDeadFlag: mocks.clear }))

import { completeOrganizationCredentialDraft } from '@/lib/credentials/organization-draft'

const input = {
  organizationId: 'org-1',
  draftId: 'draft-1',
  userId: 'admin-1',
  providerId: 'google-drive',
  accountId: 'account-1',
}
const draft = {
  ...input,
  workspaceId: null,
  id: 'draft-1',
  displayName: 'Drive',
  description: null,
  credentialId: null,
}

describe('organization OAuth callback completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.context.mockResolvedValue({ canWrite: true })
  })
  it('atomically creates a connection with its membership and consumes the exact actor-bound draft', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([draft])
      .mockResolvedValueOnce([{ id: 'account-1' }])
      .mockResolvedValueOnce([])
    await completeOrganizationCredentialDraft(input)
    expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), {
      userId: 'admin-1',
      organizationIds: ['org-1'],
    })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workspaceId: null,
        type: 'oauth',
        accountId: 'account-1',
        createdBy: 'admin-1',
      })
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(pendingCredentialDraft)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        metadata: expect.objectContaining({ organizationId: 'org-1' }),
      })
    )
  })
  it('refuses a callback after membership or admin role removal before reading secrets', async () => {
    mocks.context.mockResolvedValue(null)
    await expect(completeOrganizationCredentialDraft(input)).rejects.toThrow('administrator')
    expect(dbChainMockFns.from).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
  it('does not accept a draft from another owner or an expired launch', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(completeOrganizationCredentialDraft(input)).rejects.toThrow('invalid or expired')
    const predicate = dbChainMockFns.where.mock.calls[0][0]
    for (const value of ['org-1', 'admin-1', 'draft-1', 'google-drive'])
      expect(hasMockCondition(predicate, (c) => c.type === 'eq' && c.right === value)).toBe(true)
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
  it('refuses a linked provider account belonging to another actor', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([draft]).mockResolvedValueOnce([])
    await expect(completeOrganizationCredentialDraft(input)).rejects.toThrow('does not belong')
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
  it('does not reconnect a credential whose canonical organization lookup failed', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ ...draft, credentialId: 'credential-foreign' }])
      .mockResolvedValueOnce([{ id: 'account-1' }])
      .mockResolvedValueOnce([])
    await expect(completeOrganizationCredentialDraft(input)).rejects.toThrow('not found')
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
})
