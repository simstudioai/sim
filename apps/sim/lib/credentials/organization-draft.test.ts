import { pendingCredentialDraft } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  context: vi.fn(),
  clear: vi.fn(),
  deleteOrphan: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/credentials/organization', () => ({
  getCredentialCreationOrganizationContext: hoisted.context,
}))
vi.mock('@/lib/credentials/deletion', () => ({ deleteOrphanedOAuthAccount: hoisted.deleteOrphan }))
vi.mock('@/lib/oauth/refresh-coordination', () => ({ clearOAuthRefreshDeadFlag: hoisted.clear }))

import { completeOrganizationCredentialDraft } from '@/lib/credentials/organization-draft'

const mocks = {
  ...hoisted,
  lock: organizationMembershipMockFns.mockAcquireOrganizationUserMutationLocks,
}

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
