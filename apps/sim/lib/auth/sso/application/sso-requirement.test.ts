/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorize,
  mockRecordAudit,
  mockIsEntitled,
  mockHasProvider,
  mockIsRequired,
  mockInvalidate,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockIsEntitled: vi.fn(),
  mockHasProvider: vi.fn(),
  mockIsRequired: vi.fn(),
  mockInvalidate: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mockAuthorize,
}))
vi.mock('@/lib/core/application/authorized-workspace-use-case', () => ({
  recordProjectedUseCaseAuditEntries: mockRecordAudit,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationFeatureEntitled: mockIsEntitled,
}))
vi.mock('@/lib/auth/sso/verified-provider', () => ({
  hasSignInCapableSsoProvider: mockHasProvider,
}))
vi.mock('@/lib/auth/sso-policy', () => ({
  invalidateSsoPolicyCache: mockInvalidate,
  isSsoRequiredForOrganization: mockIsRequired,
}))

import { readSsoRequirement, setSsoRequirement } from '@/lib/auth/sso/application/sso-requirement'

const principal = { kind: 'session', userId: 'u1', sessionId: 's1' } as const
const ORG_ID = 'org1'

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mockAuthorize.mockResolvedValue({ organizationId: ORG_ID, userId: 'u1', role: 'owner' })
  mockIsEntitled.mockResolvedValue(true)
  mockHasProvider.mockResolvedValue(true)
  mockIsRequired.mockResolvedValue(true)
  dbChainMockFns.returning.mockResolvedValue([{ name: 'Acme' }])
})

describe('readSsoRequirement', () => {
  it('reports the stored setting alongside whether it is actually enforced', async () => {
    queueTableRows(schemaMock.organization, [{ requireSso: true }])

    await expect(
      readSsoRequirement.execute({ principal, input: { organizationId: ORG_ID } })
    ).resolves.toEqual({ requireSso: true, hasVerifiedProvider: true, isEnforced: true })
    expect(mockAuthorize).toHaveBeenCalledWith(principal, readSsoRequirement.operation, {
      organizationId: ORG_ID,
    })
  })

  it('reports a stored requirement that nothing can satisfy as not enforced', async () => {
    queueTableRows(schemaMock.organization, [{ requireSso: true }])
    mockHasProvider.mockResolvedValue(false)
    mockIsRequired.mockResolvedValue(false)

    await expect(
      readSsoRequirement.execute({ principal, input: { organizationId: ORG_ID } })
    ).resolves.toMatchObject({ requireSso: true, isEnforced: false })
  })

  it('reads an unknown organization as not found', async () => {
    queueTableRows(schemaMock.organization, [])
    await expect(
      readSsoRequirement.execute({ principal, input: { organizationId: ORG_ID } })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('setSsoRequirement', () => {
  const run = (requireSso: boolean) =>
    setSsoRequirement.execute({ principal, input: { organizationId: ORG_ID, requireSso } })

  it('turns the requirement on, invalidates the cache, and records the change', async () => {
    await expect(run(true)).resolves.toEqual({
      requireSso: true,
      hasVerifiedProvider: true,
      isEnforced: true,
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ requireSso: true }))
    expect(mockInvalidate).toHaveBeenCalledWith(ORG_ID)
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
  })

  it('refuses to require SSO with no provider that could satisfy it', async () => {
    mockHasProvider.mockResolvedValue(false)
    await expect(run(true)).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses to require SSO without the entitlement', async () => {
    mockIsEntitled.mockResolvedValue(false)
    await expect(run(true)).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('can always be turned off, even with no entitlement and no provider left', async () => {
    mockIsEntitled.mockResolvedValue(false)
    mockHasProvider.mockResolvedValue(false)

    await expect(run(false)).resolves.toMatchObject({ requireSso: false, isEnforced: false })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ requireSso: false }))
    expect(mockInvalidate).toHaveBeenCalledWith(ORG_ID)
  })

  it('changes nothing when authorization refuses', async () => {
    mockAuthorize.mockRejectedValue(new Error('forbidden'))
    await expect(run(true)).rejects.toThrow('forbidden')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
