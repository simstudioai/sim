/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import { warmSettingsSectionQuery } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-sidebar/settings-query-warmers'
import { apiKeysQueryOptions } from '@/hooks/queries/api-key-list'

let queryClient: QueryClient
const personalContext = { workspaceId: 'workspace-1', billingOrganizationId: null }

describe('settings query warmers', () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    })
    mockRequestJson.mockImplementation((contract: { path: string }) => {
      if (contract.path === '/api/mcp/servers' || contract.path === '/api/mcp/workflow-servers') {
        return Promise.resolve({ data: { servers: [] } })
      }
      if (contract.path === '/api/workspaces/[id]/sandboxes') {
        return Promise.resolve({ sandboxes: [], entitled: true, strategy: 'prebuilt' })
      }
      return Promise.resolve({ keys: [] })
    })
  })

  afterEach(() => {
    queryClient.clear()
    vi.clearAllMocks()
  })

  it('warms only the approved first-content list for each section', async () => {
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'apikeys')).toBe(true)
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'sandboxes')).toBe(true)
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'byok')).toBe(true)
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'mcp')).toBe(true)
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'workflow-mcp-servers')).toBe(
      true
    )

    await vi.waitFor(() => expect(mockRequestJson).toHaveBeenCalledTimes(6))
    expect(mockRequestJson.mock.calls.map(([contract]) => contract.path)).toEqual(
      expect.arrayContaining([
        '/api/workspaces/[id]/api-keys',
        '/api/users/me/api-keys',
        '/api/workspaces/[id]/sandboxes',
        '/api/workspaces/[id]/byok-keys',
        '/api/mcp/servers',
        '/api/mcp/workflow-servers',
      ])
    )
  })

  it('does not warm sensitive or broad settings data', () => {
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'secrets')).toBe(false)
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'custom-tools')).toBe(false)

    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('warms only the exact payer summary needed by Billing', async () => {
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'billing')).toBe(true)
    await vi.waitFor(() => expect(mockRequestJson).toHaveBeenCalledTimes(1))
    expect(mockRequestJson.mock.calls[0][0].path).toBe('/api/billing')

    queryClient.clear()
    mockRequestJson.mockClear()

    expect(
      warmSettingsSectionQuery(
        queryClient,
        { workspaceId: 'workspace-1', billingOrganizationId: 'org-1' },
        'billing'
      )
    ).toBe(true)
    await vi.waitFor(() => expect(mockRequestJson).toHaveBeenCalledTimes(1))
    expect(mockRequestJson.mock.calls[0][0].path).toBe('/api/organizations/[id]/billing-summary')
    expect(mockRequestJson.mock.calls[0][1]).toEqual(
      expect.objectContaining({ params: { id: 'org-1' } })
    )
  })

  it('deduplicates a successful API-key warm with the eventual consumer', async () => {
    warmSettingsSectionQuery(queryClient, personalContext, 'apikeys')
    await vi.waitFor(() => expect(mockRequestJson).toHaveBeenCalledTimes(2))

    await queryClient.fetchQuery(apiKeysQueryOptions('workspace-1', 'combined'))

    expect(mockRequestJson).toHaveBeenCalledTimes(2)
  })
})
