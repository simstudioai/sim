/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, context } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  context: {
    organization: { id: 'org-1' },
    viewer: { isAdmin: true },
    connectedAccountsAvailable: true,
    searchAccess: { memberScoped: true },
    settingsFeatures: {
      billingEnabled: true,
      hosted: true,
      hasEnterprisePlan: true,
      selfHosted: {},
    },
  },
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => context,
}))
vi.mock('@/components/settings/settings-sidebar', () => ({
  SettingsSidebar: ({ items }: { items: { id: string; label: string }[] }) => (
    <nav>
      {items.map((item) => (
        <span key={item.id}>{item.label}</span>
      ))}
    </nav>
  ),
}))

import { ApiClientError } from '@/lib/api/client/errors'
import { OrganizationSettingsSidebar } from '@/app/o/[organizationId]/settings/organization-settings-sidebar'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

const activeEnterpriseSummary = {
  success: true,
  data: {
    subscriptionState: 'active',
    subscriptionPlan: 'enterprise',
    subscriptionStatus: 'active',
    billingBlocked: false,
  },
}

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mockRequestJson.mockImplementation(() => new Promise(() => {}))
  context.viewer.isAdmin = true
  context.settingsFeatures.hosted = true
  context.settingsFeatures.billingEnabled = true
  context.settingsFeatures.hasEnterprisePlan = true
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  queryClient.clear()
  focusManager.setFocused(undefined)
  vi.useRealTimers()
})

async function renderSidebar() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <OrganizationSettingsSidebar isCollapsed={false} showCollapsedTooltips={false} />
      </QueryClientProvider>
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}

describe('organization settings navigation first paint', () => {
  it('renders enterprise sections while only the lightweight summary refreshes in the background', async () => {
    await renderSidebar()

    expect(container).toHaveTextContent('Audit logs')
    expect(container).toHaveTextContent('Data retention')
    expect(container).toHaveTextContent('Sources')
    expect(mockRequestJson).toHaveBeenCalledTimes(1)
    expect(mockRequestJson.mock.calls[0][0].path).toBe('/api/organizations/[id]/billing-summary')
  })

  it('keeps admin sections hidden from ordinary members even with enterprise features', async () => {
    context.viewer.isAdmin = false
    await renderSidebar()

    expect(container).toHaveTextContent('Search MCP')
    expect(container).not.toHaveTextContent('Audit logs')
    expect(container).not.toHaveTextContent('Subscription')
    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it.each([
    { hosted: false, billingEnabled: false },
    { hosted: true, billingEnabled: false },
  ])(
    'does not refresh billing when hosted=$hosted and billingEnabled=$billingEnabled',
    async (deployment) => {
      Object.assign(context.settingsFeatures, deployment)
      await renderSidebar()

      expect(mockRequestJson).not.toHaveBeenCalled()
      expect(container).not.toHaveTextContent('Subscription')
    }
  )

  it('refreshes entitlement changes after returning from the billing portal', async () => {
    mockRequestJson.mockResolvedValue(activeEnterpriseSummary)
    await renderSidebar()
    expect(container).toHaveTextContent('Audit logs')

    mockRequestJson.mockResolvedValue({
      ...activeEnterpriseSummary,
      data: { ...activeEnterpriseSummary.data, subscriptionPlan: 'team' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container).not.toHaveTextContent('Audit logs')

    mockRequestJson.mockResolvedValue(activeEnterpriseSummary)
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: organizationKeys.billingSummary('org-1') })
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container).toHaveTextContent('Audit logs')
  })

  it.each([
    { subscriptionState: 'lapsed', subscriptionStatus: 'canceled', billingBlocked: false },
    { subscriptionState: 'active', subscriptionStatus: 'past_due', billingBlocked: false },
    { subscriptionState: 'active', subscriptionStatus: 'active', billingBlocked: true },
  ])(
    'hides unusable enterprise plans: $subscriptionStatus, blocked=$billingBlocked',
    async (state) => {
      mockRequestJson.mockResolvedValue({
        ...activeEnterpriseSummary,
        data: { ...activeEnterpriseSummary.data, ...state },
      })
      await renderSidebar()

      expect(container).not.toHaveTextContent('Audit logs')
      expect(container).toHaveTextContent('Subscription')
    }
  )

  it('hides admin sections if a refresh revokes billing access, even with cached data', async () => {
    mockRequestJson.mockResolvedValue(activeEnterpriseSummary)
    await renderSidebar()
    expect(container).toHaveTextContent('Audit logs')

    mockRequestJson.mockRejectedValue(
      new ApiClientError({ status: 403, message: 'Forbidden', body: null })
    )
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: organizationKeys.billingSummary('org-1') })
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(container).not.toHaveTextContent('Audit logs')
    expect(container).not.toHaveTextContent('Subscription')
    expect(container).toHaveTextContent('Search MCP')
  })

  it('does not display enterprise sections for a team plan', async () => {
    context.settingsFeatures.hasEnterprisePlan = false
    await renderSidebar()

    expect(container).toHaveTextContent('Subscription')
    expect(container).not.toHaveTextContent('Audit logs')
    expect(mockRequestJson).toHaveBeenCalledTimes(1)
  })
})
