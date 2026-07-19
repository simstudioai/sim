/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', async () => {
  const messages = (await import('@/messages/en/auto.json')).default as Record<string, string>
  return {
    useTranslations: () => (key: string) => messages[key] ?? key,
  }
})

const {
  mockOrganizationQuery,
  mockPersonalQuery,
  mockUpdateOrganizationLimit,
  mockUpdateUserLimit,
  mockUseOrganizationBilling,
  mockUseSubscriptionData,
  mockUseUsageLimitData,
} = vi.hoisted(() => ({
  mockOrganizationQuery: { current: null as unknown },
  mockPersonalQuery: { current: null as unknown },
  mockUpdateOrganizationLimit: vi.fn(),
  mockUpdateUserLimit: vi.fn(),
  mockUseOrganizationBilling: vi.fn(),
  mockUseSubscriptionData: vi.fn(),
  mockUseUsageLimitData: vi.fn(),
}))

vi.mock('@/lib/billing/client/provider', () => ({
  isLagoBillingClient: () => false,
  getBillingPortalLabelKey: () => 'manage_in_stripe',
}))

vi.mock('@sim/emcn', () => ({
  ArrowRight: () => <span />,
  ChipInput: (props: Record<string, unknown>) => <input {...(props as object)} />,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Chip: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button type='button' disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  ChipLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  Credit: () => <span />,
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean
    disabled?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
  chipVariants: () => '',
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'viewer-a' } } }),
  useSubscription: () => ({
    cancel: vi.fn(),
    restore: vi.fn(),
  }),
}))

vi.mock('@/hooks/queries/general-settings', () => ({
  useBillingUsageNotifications: () => false,
  useUpdateGeneralSetting: () => ({ isPending: false, mutate: vi.fn() }),
}))

vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: (...args: unknown[]) => {
    mockUseOrganizationBilling(...args)
    return mockOrganizationQuery.current
  },
  useUpdateOrganizationUsageLimit: () => ({
    isPending: false,
    mutateAsync: mockUpdateOrganizationLimit,
  }),
}))

vi.mock('@/hooks/queries/subscription', () => ({
  useInvoices: () => ({ data: { invoices: [], hasMore: false } }),
  usePurchaseCredits: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
  useOpenBillingPortal: () => ({ isPending: false, mutate: vi.fn() }),
  useSubscriptionData: (...args: unknown[]) => {
    mockUseSubscriptionData(...args)
    return mockPersonalQuery.current
  },
  useUpdateUsageLimit: () => ({ isPending: false, mutateAsync: mockUpdateUserLimit }),
  useUsageLimitData: (...args: unknown[]) => {
    mockUseUsageLimitData(...args)
    return {
      data: {
        data: {
          currentLimit: 999,
          minimumLimit: 999,
        },
      },
      isLoading: false,
    }
  },
}))

vi.mock('@/hooks/queries/workspace', () => ({
  prefetchWorkspaceSettings: vi.fn(),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/billing/components/credit-usage-section/credit-usage-section',
  () => ({
    CreditUsageSection: () => <div>Personal credit usage</div>,
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/billing/components/usage-limit-field/usage-limit-field',
  () => ({
    UsageLimitField: ({
      context,
      currentLimit,
      organizationId,
    }: {
      context: string
      currentLimit: number
      organizationId?: string
    }) => (
      <div
        data-testid='usage-limit'
        data-context={context}
        data-current-limit={currentLimit}
        data-organization-id={organizationId}
      />
    ),
  })
)

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children, label }: { children: ReactNode; label: string }) => (
      <section aria-label={label}>{children}</section>
    ),
  })
)

import { Billing } from '@/app/workspace/[workspaceId]/settings/components/billing/billing'

const PERSONAL_DATA = {
  plan: 'pro_6000',
  status: 'active',
  usageLimit: 30,
  creditBalance: 500,
  billingInterval: 'month',
  periodEnd: '2026-08-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  billingBlocked: false,
  upgradeWorkspaceId: 'personal-workspace',
  usage: {
    current: 10,
    limit: 30,
    percentUsed: 33,
  },
}

function organizationResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    context: 'organization',
    userRole: 'owner',
    billingBlocked: false,
    billingBlockedReason: null,
    blockedByOrgOwner: false,
    data: {
      organizationId: 'org-target',
      organizationName: 'Target organization',
      subscriptionState: 'active',
      hasSubscription: true,
      subscriptionPlan: 'team_25000',
      subscriptionStatus: 'active',
      creditBalance: 5,
      billingInterval: 'year',
      cancelAtPeriodEnd: true,
      totalSeats: 3,
      usedSeats: 2,
      seatsCount: 3,
      totalCurrentUsage: 100,
      totalUsageLimit: 150,
      minimumBillingAmount: 125,
      averageUsagePerMember: 50,
      billingPeriodStart: '2026-07-01T00:00:00.000Z',
      billingPeriodEnd: '2026-08-01T00:00:00.000Z',
      members: [],
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
      upgradeWorkspaceId: 'organization-workspace',
      ...overrides,
    },
  }
}

let container: HTMLDivElement
let root: Root

describe('Billing payer scope', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPersonalQuery.current = {
      data: { success: true, context: 'user', data: PERSONAL_DATA },
      isLoading: false,
      refetch: vi.fn(),
    }
    mockOrganizationQuery.current = {
      data: organizationResponse(),
      isLoading: false,
      refetch: vi.fn(),
    }
    mockUpdateOrganizationLimit.mockResolvedValue(undefined)
    mockUpdateUserLimit.mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('uses the target organization DTO for annual, canceled, credit, cap, and link state', async () => {
    await act(async () => {
      root.render(<Billing scope='organization' organizationId='org-target' />)
    })

    expect(mockUseSubscriptionData).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    )
    expect(mockUseUsageLimitData).not.toHaveBeenCalled()
    expect(
      container.querySelector('a[href="/workspace/organization-workspace/upgrade"]')?.textContent
    ).toBe('Explore organization plans')
    expect(container.textContent).toContain('Organization Max for Teams plan')
    expect(container.textContent).toContain('billed annually')
    expect(container.textContent).toContain('Access until')
    expect(container.textContent).toContain('Subscription canceled')
    expect(container.textContent).toContain('Restore')
    expect(container.querySelector('[data-testid="usage-limit"]')).toHaveAttribute(
      'data-organization-id',
      'org-target'
    )

    const onDemandSwitch = container.querySelector<HTMLButtonElement>('[role="switch"]')
    expect(onDemandSwitch).toHaveAttribute('aria-checked', 'true')
    await act(async () => {
      onDemandSwitch?.click()
    })
    expect(mockUpdateOrganizationLimit).toHaveBeenCalledWith({
      organizationId: 'org-target',
      limit: 130,
    })
    expect(mockUpdateUserLimit).not.toHaveBeenCalled()
  })

  it('uses a guaranteed personal payer workspace for account upgrades', async () => {
    await act(async () => {
      root.render(<Billing scope='account' />)
    })

    expect(
      container.querySelector('a[href="/workspace/personal-workspace/upgrade"]')?.textContent
    ).toBe('Explore personal plans')
    expect(container.textContent).toContain('Personal Pro plan')
  })

  it('renders an explicit free organization state without subscription controls', async () => {
    mockOrganizationQuery.current = {
      data: organizationResponse({
        subscriptionState: 'free',
        hasSubscription: false,
        subscriptionPlan: 'free',
        subscriptionStatus: null,
        billingInterval: 'month',
        cancelAtPeriodEnd: false,
        billingPeriodStart: null,
        billingPeriodEnd: null,
      }),
      isLoading: false,
      refetch: vi.fn(),
    }

    await act(async () => {
      root.render(<Billing scope='organization' organizationId='org-target' />)
    })

    expect(container.textContent).toContain('Organization Free plan')
    expect(container.textContent).toContain('No active organization subscription')
    expect(container.textContent).not.toContain('Payment method')
  })

  it('renders lapsed organization plans as ended rather than active', async () => {
    mockOrganizationQuery.current = {
      data: organizationResponse({
        subscriptionState: 'lapsed',
        subscriptionStatus: 'canceled',
        billingInterval: 'year',
        cancelAtPeriodEnd: false,
        billingPeriodStart: null,
        billingPeriodEnd: '2026-06-01T00:00:00.000Z',
      }),
      isLoading: false,
      refetch: vi.fn(),
    }

    await act(async () => {
      root.render(<Billing scope='organization' organizationId='org-target' />)
    })

    expect(container.textContent).toContain('Organization Max for Teams plan ended')
    expect(container.textContent).toContain('Choose a new plan for this organization')
    expect(container.textContent).not.toContain('Cancel subscription')
    expect(
      container.querySelector('a[href="/workspace/organization-workspace/upgrade"]')?.textContent
    ).toBe('Explore organization plans')
  })
})
