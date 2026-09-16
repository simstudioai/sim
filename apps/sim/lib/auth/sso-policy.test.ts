/**
 * @vitest-environment node
 */
import { organization } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEntitled, mockHasProvider } = vi.hoisted(() => ({
  mockIsEntitled: vi.fn(),
  mockHasProvider: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationFeatureEntitled: mockIsEntitled,
}))

vi.mock('@/lib/auth/sso/verified-provider', () => ({
  hasSignInCapableSsoProvider: mockHasProvider,
}))

import { SSO_REQUIRED_MESSAGE } from '@/lib/auth/constants'
import {
  assertSsoRequirementSatisfied,
  invalidateSsoPolicyCache,
  isSsoRequiredForOrganization,
  satisfiesSsoRequirement,
} from '@/lib/auth/sso-policy'

const ORG_ID = 'org-1'

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  invalidateSsoPolicyCache(ORG_ID)
  invalidateSsoPolicyCache('org-owned')
  mockIsEntitled.mockResolvedValue(true)
  mockHasProvider.mockResolvedValue(true)
})

describe('satisfiesSsoRequirement', () => {
  /**
   * Better Auth dispatches the hook with the declared endpoint path, so each SSO callback is
   * covered in both the declared and the concrete form. The SAML ACS endpoint is the one an
   * identity provider posts to when the admin configured Sim from its SP metadata.
   */
  it.each([
    '/sso/callback',
    '/sso/callback/okta',
    '/sso/callback/:providerId',
    '/sso/saml2/callback/okta',
    '/sso/saml2/callback/:providerId',
    '/sso/saml2/sp/acs/okta',
    '/sso/saml2/sp/acs/:providerId',
  ])('accepts the identity-provider callback %s', (path) => {
    expect(satisfiesSsoRequirement(path)).toBe(true)
  })

  it.each(['/one-time-token/verify', '/admin/impersonate-user', '/change-password'])(
    'accepts the derived session path %s',
    (path) => {
      expect(satisfiesSsoRequirement(path)).toBe(true)
    }
  )

  it('accepts a session created outside any endpoint', () => {
    expect(satisfiesSsoRequirement(undefined)).toBe(true)
  })

  it.each([
    '/sign-in/email',
    '/sign-up/email',
    '/verify-email',
    '/callback/google',
    '/email-otp/verify-email',
    '/sign-in/email-otp',
  ])('refuses the credential path %s', (path) => {
    expect(satisfiesSsoRequirement(path)).toBe(false)
  })

  it('refuses an endpoint it has never seen', () => {
    expect(satisfiesSsoRequirement('/sign-in/passkey')).toBe(false)
  })
})

describe('isSsoRequiredForOrganization', () => {
  it('is false without an organization', async () => {
    await expect(isSsoRequiredForOrganization(null)).resolves.toBe(false)
  })

  it('is false while the organization is not entitled to SSO', async () => {
    queueTableRows(organization, [{ requireSso: true }])
    mockIsEntitled.mockResolvedValue(false)
    await expect(isSsoRequiredForOrganization(ORG_ID)).resolves.toBe(false)
  })

  it('stops enforcing once no provider is left to sign anyone in', async () => {
    queueTableRows(organization, [{ requireSso: true }])
    mockHasProvider.mockResolvedValue(false)
    await expect(isSsoRequiredForOrganization(ORG_ID)).resolves.toBe(false)
  })

  it('is true for an entitled organization that set the requirement', async () => {
    queueTableRows(organization, [{ requireSso: true }])
    await expect(isSsoRequiredForOrganization(ORG_ID)).resolves.toBe(true)
  })

  it('serves a repeat read from cache until it is invalidated', async () => {
    queueTableRows(organization, [{ requireSso: true }])
    await expect(isSsoRequiredForOrganization(ORG_ID)).resolves.toBe(true)
    await expect(isSsoRequiredForOrganization(ORG_ID)).resolves.toBe(true)
    expect(mockIsEntitled).toHaveBeenCalledTimes(1)

    invalidateSsoPolicyCache(ORG_ID)
    queueTableRows(organization, [{ requireSso: false }])
    await expect(isSsoRequiredForOrganization(ORG_ID)).resolves.toBe(false)
  })
})

describe('assertSsoRequirementSatisfied', () => {
  const membership = { userId: 'user-1', organizationId: ORG_ID, role: 'member' }

  it('refuses a password sign-in when the organization requires SSO', async () => {
    queueTableRows(organization, [{ requireSso: true }])
    await expect(assertSsoRequirementSatisfied(membership, '/sign-in/email')).rejects.toThrow(
      SSO_REQUIRED_MESSAGE
    )
  })

  it('allows a SAML sign-in that lands on the ACS endpoint', async () => {
    queueTableRows(organization, [{ requireSso: true }])
    await expect(
      assertSsoRequirementSatisfied(membership, '/sso/saml2/sp/acs/:providerId')
    ).resolves.toBeUndefined()
  })

  it('leaves owners a password sign-in as a break-glass path', async () => {
    queueTableRows(organization, [{ requireSso: true }])
    await expect(
      assertSsoRequirementSatisfied({ ...membership, role: 'owner' }, '/sign-in/email')
    ).resolves.toBeUndefined()
  })

  it('allows every method while the requirement is off', async () => {
    queueTableRows(organization, [{ requireSso: false }])
    await expect(
      assertSsoRequirementSatisfied(membership, '/sign-in/email')
    ).resolves.toBeUndefined()
  })
})
