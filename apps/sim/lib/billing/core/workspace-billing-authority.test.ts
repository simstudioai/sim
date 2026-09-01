/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { canUserManageWorkspaceBilling } from '@/lib/billing/core/workspace-billing-authority'

const personalWorkspace = {
  workspaceOrganizationId: null,
  billedAccountUserId: 'billing-owner-1',
}
const organizationWorkspace = {
  workspaceOrganizationId: 'organization-1',
  billedAccountUserId: 'billing-owner-1',
}

describe('canUserManageWorkspaceBilling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('grants the billed account holder of a personally hosted workspace', async () => {
    await expect(canUserManageWorkspaceBilling(personalWorkspace, 'billing-owner-1')).resolves.toBe(
      true
    )
  })

  it('refuses any other member of a personally hosted workspace', async () => {
    await expect(canUserManageWorkspaceBilling(personalWorkspace, 'user-1')).resolves.toBe(false)
  })

  it('grants an admin of the hosting organization', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])

    await expect(canUserManageWorkspaceBilling(organizationWorkspace, 'user-1')).resolves.toBe(true)
  })

  it('grants the owner of the hosting organization', async () => {
    queueTableRows(schemaMock.member, [{ role: 'owner' }])

    await expect(canUserManageWorkspaceBilling(organizationWorkspace, 'user-1')).resolves.toBe(true)
  })

  it('refuses a plain member of the hosting organization', async () => {
    queueTableRows(schemaMock.member, [{ role: 'member' }])

    await expect(canUserManageWorkspaceBilling(organizationWorkspace, 'user-1')).resolves.toBe(
      false
    )
  })

  it('refuses a non-member, including the billed account holder, on an organization host', async () => {
    queueTableRows(schemaMock.member, [])

    await expect(
      canUserManageWorkspaceBilling(organizationWorkspace, 'billing-owner-1')
    ).resolves.toBe(false)
  })
})
