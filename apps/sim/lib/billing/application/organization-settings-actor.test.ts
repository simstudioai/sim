import type { OrganizationDelegatedPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorization = vi.hoisted(() => vi.fn())
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: authorization,
}))

import { organizationBillingSettingsActor } from './organization-settings-actor'

const operation = { id: 'organization_usage.summary.read', capability: 'none' } as const
const principal: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  organizationId: 'org',
  subjectUserId: 'actor',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
}

describe('organization billing settings actor', () => {
  beforeEach(() => {
    authorization.mockReset()
  })
  it('reauthorizes exact organization, audience and current administrator', async () => {
    authorization.mockResolvedValue({ userId: 'actor', role: 'admin' })
    expect(await organizationBillingSettingsActor(principal, operation, 'org')).toBe('actor')
    expect(authorization).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        id: operation.id,
        minimumRole: 'admin',
        delegationAudience: 'sim:settings',
        delegatedServices: ['copilot'],
      }),
      { organizationId: 'org' }
    )
  })
  it('does not substitute a payer when delegated authority is refused', async () => {
    authorization.mockRejectedValue(new Error('forbidden'))
    await expect(
      organizationBillingSettingsActor(principal, operation, 'other-org')
    ).rejects.toThrow('forbidden')
  })
  it('preserves the authenticated session actor for existing billing authorization', async () => {
    const session: SessionPrincipal = { kind: 'session', userId: 'human', sessionId: 'session' }
    expect(await organizationBillingSettingsActor(session, operation, 'org')).toBe('human')
    expect(authorization).not.toHaveBeenCalled()
  })
})
