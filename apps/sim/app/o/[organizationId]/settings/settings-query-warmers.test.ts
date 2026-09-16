/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, mockGetOrganization } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  mockGetOrganization: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))
vi.mock('@/lib/auth/auth-client', () => ({
  client: { organization: { getFullOrganization: mockGetOrganization } },
}))

import { warmOrganizationSettingsSectionQuery } from '@/app/o/[organizationId]/settings/settings-query-warmers'
import {
  organizationBillingQueryOptions,
  organizationDetailQueryOptions,
  organizationRosterQueryOptions,
} from '@/hooks/queries/organization'
import { organizationBillingSummaryOptions } from '@/hooks/queries/organization-billing-summary'

let queryClient: QueryClient
const adminContext = { organizationId: 'org-1', isAdmin: true }

beforeEach(() => {
  vi.clearAllMocks()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockGetOrganization.mockResolvedValue({ data: { id: 'org-1' } })
  mockRequestJson.mockResolvedValue({ success: true, data: { organizationId: 'org-1' } })
})

afterEach(() => queryClient.clear())

describe('organization settings query warming', () => {
  it('starts member data together and reuses it through the consumer options', async () => {
    warmOrganizationSettingsSectionQuery(queryClient, adminContext, 'members')
    expect(mockGetOrganization).toHaveBeenCalledExactlyOnceWith({
      query: { organizationId: 'org-1' },
      fetchOptions: { signal: expect.any(AbortSignal) },
    })
    expect(mockRequestJson).toHaveBeenCalledTimes(2)

    await Promise.all([
      queryClient.fetchQuery(organizationDetailQueryOptions('org-1')),
      queryClient.fetchQuery(organizationRosterQueryOptions('org-1')),
      queryClient.fetchQuery(organizationBillingQueryOptions('org-1')),
    ])
    warmOrganizationSettingsSectionQuery(queryClient, adminContext, 'members')

    expect(mockGetOrganization).toHaveBeenCalledTimes(1)
    expect(mockRequestJson).toHaveBeenCalledTimes(2)
    expect(mockRequestJson.mock.calls.map(([, input]) => input)).toEqual([
      { params: { id: 'org-1' }, signal: expect.any(AbortSignal) },
      { query: { context: 'organization', id: 'org-1' }, signal: expect.any(AbortSignal) },
    ])
  })

  it('does not request billing for ordinary members', async () => {
    const memberContext = { ...adminContext, isAdmin: false }
    warmOrganizationSettingsSectionQuery(queryClient, memberContext, 'members')
    warmOrganizationSettingsSectionQuery(queryClient, memberContext, 'billing')
    await queryClient.fetchQuery(organizationRosterQueryOptions('org-1'))

    expect(mockRequestJson).toHaveBeenCalledTimes(1)
    expect(mockRequestJson.mock.calls[0][0].path).toBe('/api/organizations/[id]/roster')
  })

  it('warms Subscription using only its summary and keeps organizations separate', async () => {
    warmOrganizationSettingsSectionQuery(queryClient, adminContext, 'billing')
    warmOrganizationSettingsSectionQuery(
      queryClient,
      { ...adminContext, organizationId: 'org-2' },
      'billing'
    )
    await Promise.all([
      queryClient.fetchQuery(organizationBillingSummaryOptions('org-1')),
      queryClient.fetchQuery(organizationBillingSummaryOptions('org-2')),
    ])

    expect(mockGetOrganization).not.toHaveBeenCalled()
    expect(mockRequestJson).toHaveBeenCalledTimes(2)
    expect(mockRequestJson.mock.calls.map(([contract]) => contract.path)).toEqual([
      '/api/organizations/[id]/billing-summary',
      '/api/organizations/[id]/billing-summary',
    ])
    expect(mockRequestJson.mock.calls.map(([, input]) => input.params.id)).toEqual([
      'org-1',
      'org-2',
    ])
  })

  it('does not fetch unrelated sections or an empty organization', () => {
    warmOrganizationSettingsSectionQuery(queryClient, adminContext, 'general')
    warmOrganizationSettingsSectionQuery(queryClient, adminContext, 'audit-logs')
    warmOrganizationSettingsSectionQuery(
      queryClient,
      { ...adminContext, organizationId: '' },
      'members'
    )

    expect(mockGetOrganization).not.toHaveBeenCalled()
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})
