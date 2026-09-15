/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const { mockAuthorize, mockRecordAudit } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mockAuthorize,
}))
vi.mock('@/lib/core/application/authorized-workspace-use-case', () => ({
  recordProjectedUseCaseAuditEntries: mockRecordAudit,
}))

import { setPrimarySsoProvider } from '@/lib/auth/sso/application/set-primary-provider'

const principal = { kind: 'session', userId: 'u1', sessionId: 's1' } as const
const run = () => setPrimarySsoProvider.execute({ principal, input: { providerId: 'acme-okta' } })

describe('setPrimarySsoProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAuthorize.mockResolvedValue({ organizationId: 'org1', userId: 'u1', role: 'owner' })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'domain-1' }])
  })

  it('names the provider, authorizes against its organization, and records the switch', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', domain: 'acme.com' },
    ])
    await expect(run()).resolves.toEqual({
      providerId: 'acme-okta',
      organizationId: 'org1',
      domain: 'acme.com',
    })
    expect(mockAuthorize).toHaveBeenCalledWith(principal, setPrimarySsoProvider.operation, {
      organizationId: 'org1',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ primaryProviderId: 'acme-okta' })
    )
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an unknown provider', []],
    ['a personal provider', [{ id: 'row-1', organizationId: null, domain: 'acme.com' }]],
  ])('reads %s as not found before authorizing anything', async (_label, rows) => {
    queueTableRows(schemaMock.ssoProvider, rows)
    await expect(run()).rejects.toMatchObject({ code: 'not_found' })
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('changes nothing when authorization refuses', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', domain: 'acme.com' },
    ])
    mockAuthorize.mockRejectedValue(new OrchestrationError('forbidden', 'Admins only'))
    await expect(run()).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('refuses a provider whose domain is not verified, without recording anything', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', domain: 'acme.com' },
    ])
    dbChainMockFns.returning.mockResolvedValue([])
    await expect(run()).rejects.toMatchObject({
      code: 'conflict',
      message: 'Verify acme.com before making this provider primary.',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
