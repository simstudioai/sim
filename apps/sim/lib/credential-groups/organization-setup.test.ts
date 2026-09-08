/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ policy: vi.fn() }))
vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.policy,
  ResourcePolicyNotFoundError: class extends Error {},
}))

import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
import { ResourcePolicyNotFoundError } from '@/lib/resource-policies/repository'

describe('fresh organization account setup', () => {
  beforeEach(() => vi.clearAllMocks())
  it('requires an existing org policy instead of creating grants for a legacy group', async () => {
    mocks.policy.mockRejectedValue(
      new ResourcePolicyNotFoundError('credential_group', 'legacy-group')
    )
    await expect(requireOrganizationAccountsSetup('org-1', 'legacy-group')).rejects.toMatchObject({
      code: 'conflict',
    })
  })
  it('does not conceal a malformed policy', async () => {
    mocks.policy.mockRejectedValue(new Error('Malformed policy'))
    await expect(requireOrganizationAccountsSetup('org-1', 'group-1')).rejects.toThrow(
      'Malformed policy'
    )
  })
})
