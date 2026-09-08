/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'

const { mockGetFullOrganization, mockRequestJson } = vi.hoisted(() => ({
  mockGetFullOrganization: vi.fn(),
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    organization: {
      getFullOrganization: mockGetFullOrganization,
    },
    subscription: {
      list: vi.fn(),
    },
  },
}))

import {
  getOrganizationBillingSummaryContract,
  getOrganizationRosterContract,
  type OrganizationRoster,
} from '@/lib/api/contracts/organization'
import {
  getOrganizationBillingContract,
  type OrganizationBillingApiResponse,
} from '@/lib/api/contracts/subscription'
import {
  organizationKeys,
  useOrganization,
  useOrganizationBilling,
  useOrganizationRoster,
} from '@/hooks/queries/organization'
import {
  organizationBillingSummaryOptions,
  shouldRetryOrganizationBillingSummary,
} from '@/hooks/queries/organization-billing-summary'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

const ORGANIZATION_A = {
  id: 'org-a',
  name: 'Organization A',
}

const ROSTER_A: { success: true; data: OrganizationRoster } = {
  success: true,
  data: {
    members: [
      {
        memberId: 'member-a',
        userId: 'user-a',
        role: 'owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        name: 'Member A',
        email: 'member-a@example.com',
        image: null,
        suspendedAt: null,
        workspaces: [],
      },
    ],
    pendingInvitations: [],
    workspaces: [],
  },
}

const BILLING_A = {
  data: {
    organizationId: 'org-a',
    subscriptionPlan: 'enterprise',
  },
} as OrganizationBillingApiResponse

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

function OrganizationProbe({ organizationId }: { organizationId: string }) {
  const organization = useOrganization(organizationId)
  const roster = useOrganizationRoster(organizationId)
  const billing = useOrganizationBilling(organizationId)
  const canManage = Boolean(organization.data && roster.data && billing.data)

  return (
    <div>
      <span data-testid='organization-name'>{organization.data?.name ?? ''}</span>
      <span data-testid='member-name'>{roster.data?.members[0]?.name ?? ''}</span>
      <span data-testid='billing-organization'>{billing.data?.data.organizationId ?? ''}</span>
      {canManage && <button type='button'>Manage organization</button>}
    </div>
  )
}

function renderOrganization(organizationId: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProbe organizationId={organizationId} />
      </QueryClientProvider>
    )
  })
}

async function flushQueries() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await Promise.resolve()
      await sleep(0)
    }
  })
}

describe('organization identity transitions', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.clearAllMocks()
  })

  it('clears organization detail, roster, billing, and actions while the next org loads', async () => {
    const organizationB = createDeferred<{ data: typeof ORGANIZATION_A }>()
    const rosterB = createDeferred<typeof ROSTER_A>()
    const billingB = createDeferred<OrganizationBillingApiResponse>()

    mockGetFullOrganization.mockImplementation(
      ({ query }: { query: { organizationId: string } }) =>
        query.organizationId === 'org-a'
          ? Promise.resolve({ data: ORGANIZATION_A })
          : organizationB.promise
    )
    mockRequestJson.mockImplementation(
      (
        contract: unknown,
        input: {
          params?: { id?: string }
          query?: { id?: string }
        }
      ) => {
        if (contract === getOrganizationRosterContract) {
          return input.params?.id === 'org-a' ? Promise.resolve(ROSTER_A) : rosterB.promise
        }
        if (contract === getOrganizationBillingContract) {
          return input.query?.id === 'org-a' ? Promise.resolve(BILLING_A) : billingB.promise
        }
        throw new Error('Unexpected contract')
      }
    )

    renderOrganization('org-a')
    await flushQueries()

    expect(container).toHaveTextContent('Organization A')
    expect(container).toHaveTextContent('Member A')
    expect(container).toHaveTextContent('org-a')
    expect(container.querySelector('button')).toHaveTextContent('Manage organization')

    renderOrganization('org-b')
    await flushQueries()

    expect(container).not.toHaveTextContent('Organization A')
    expect(container).not.toHaveTextContent('Member A')
    expect(container).not.toHaveTextContent('org-a')
    expect(container.querySelector('button')).toBeNull()
    expect(mockGetFullOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ query: { organizationId: 'org-b' } })
    )
  })

  it('forwards the query signal so an in-flight org fetch can be cancelled', async () => {
    mockGetFullOrganization.mockResolvedValue({ data: ORGANIZATION_A })

    renderOrganization('org-a')

    await flushQueries()

    const [args] = mockGetFullOrganization.mock.calls[0]
    expect(args.fetchOptions?.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses a shape-specific recoverable cache entry for the navigation billing summary', async () => {
    const summary = {
      success: true as const,
      data: {
        organizationId: 'org-a',
        subscriptionState: 'active' as const,
        subscriptionPlan: 'team_25000',
        subscriptionStatus: 'active',
        creditBalance: 0,
        billingInterval: 'month' as const,
        cancelAtPeriodEnd: false,
        totalSeats: 2,
        totalCurrentUsage: 3,
        totalUsageLimit: 125,
        minimumBillingAmount: 125,
        billingPeriodEnd: '2026-09-01T00:00:00.000Z',
        billingBlocked: false,
        billingBlockedReason: null,
        blockedByOrgOwner: false,
        upgradeWorkspaceId: 'workspace-a',
        userRole: 'owner' as const,
      },
    }
    mockRequestJson.mockResolvedValue(summary)

    const options = organizationBillingSummaryOptions('org-a')
    expect(options.queryKey).toEqual(organizationKeys.billingSummary('org-a'))
    expect(options.queryKey).not.toEqual(organizationKeys.billing('org-a'))
    expect(options.retryOnMount).toBe(true)

    await expect(queryClient.fetchQuery(options)).resolves.toEqual(summary)
    expect(mockRequestJson).toHaveBeenCalledWith(
      getOrganizationBillingSummaryContract,
      expect.objectContaining({
        params: { id: 'org-a' },
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('retries one transient billing-summary failure without retrying authorization errors', () => {
    const serverError = new ApiClientError({
      status: 503,
      message: 'Unavailable',
      body: null,
    })
    const forbiddenError = new ApiClientError({
      status: 403,
      message: 'Forbidden',
      body: null,
    })

    expect(shouldRetryOrganizationBillingSummary(0, serverError)).toBe(true)
    expect(shouldRetryOrganizationBillingSummary(1, serverError)).toBe(false)
    expect(shouldRetryOrganizationBillingSummary(0, forbiddenError)).toBe(false)
    expect(shouldRetryOrganizationBillingSummary(0, new TypeError('Network error'))).toBe(true)
  })
})
