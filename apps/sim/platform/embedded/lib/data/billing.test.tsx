/**
 * @vitest-environment jsdom
 *
 * The usage limit and the on-demand switch write the same number. Failure modes: the limit's waiting
 * save landing after the switch and undoing it, either write starting while the other is in flight,
 * and a waiting save judged against a minimum that has since changed.
 */
import { act } from 'react'
import { toast } from '@sim/emcn'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/auth/client', () => authClientMock)

import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { organizationKeys } from '@/hooks/queries/organization'
import { useBillingSection } from '@/platform/embedded/lib/data/billing'
import { renderDataHook, unmountDataHooks } from '@/platform/embedded/lib/render-hook.test-support'

const ORGANIZATION = { organization: { id: 'org-1' } } as OrganizationSurfaceContext

function summary(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      subscriptionPlan: 'team',
      subscriptionStatus: 'active',
      subscriptionState: 'active',
      userRole: 'admin',
      minimumBillingAmount: 100,
      totalUsageLimit: 200,
      totalCurrentUsage: 10,
      creditBalance: 0,
      billingBlocked: false,
      totalSeats: 2,
      ...overrides,
    },
  }
}

function limitWrites(): number[] {
  return apiClientRequestMockFns.mockRequestJson.mock.calls.flatMap(([contract, args]) =>
    contract.method === 'PUT' && typeof args?.body?.limit === 'number' ? [args.body.limit] : []
  )
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useBillingSection usage limit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiClientRequestMockFns.mockRequestJson.mockImplementation(
      async (contract: { path: string; method: string }) =>
        contract.method === 'PUT' ? { success: true } : summary()
    )
  })
  afterEach(async () => {
    await unmountDataHooks()
    vi.useRealTimers()
  })

  async function render() {
    const rendered = await renderDataHook(() => useBillingSection(ORGANIZATION))
    await advance(0)
    return rendered
  }

  it('saves a typed limit once typing stops', async () => {
    const { result } = await render()

    act(() => result.current.usageLimit.change('60000'))
    expect(result.current.usageLimit.value).toBe('60000')
    expect(limitWrites()).toEqual([])

    await advance(1000)

    expect(limitWrites()).toEqual([300])
  })

  it('lets the on-demand switch overtake a limit still waiting to save', async () => {
    const { result } = await render()

    act(() => result.current.usageLimit.change('60000'))
    await act(async () => result.current.onDemand.toggle())
    const written = limitWrites()
    expect(written).toHaveLength(1)

    await advance(5000)

    expect(limitWrites()).toEqual(written)
    expect(result.current.usageLimit.value).not.toBe('60000')
  })

  it('holds each control while the other is saving', async () => {
    const { result } = await render()
    let answer: (value: unknown) => void = () => {}
    apiClientRequestMockFns.mockRequestJson.mockImplementation((contract: { method: string }) =>
      contract.method === 'PUT'
        ? new Promise((resolve) => {
            answer = resolve
          })
        : Promise.resolve(summary())
    )

    await act(async () => {
      void result.current.onDemand.toggle()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.usageLimit.disabled).toBe(true)
    await act(async () => answer({ success: true }))
    await advance(0)

    act(() => result.current.usageLimit.change('60000'))
    await advance(1050)
    expect(limitWrites()).toHaveLength(2)
    expect(result.current.onDemand.disabled).toBe(true)
    await act(async () => answer({ success: true }))
  })

  it('judges a waiting save against the minimum as it stands when the wait ends', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '')
    const { result, queryClient } = await render()

    act(() => result.current.usageLimit.change('60000'))
    await act(async () => {
      queryClient.setQueryData(
        organizationKeys.billingSummary('org-1'),
        summary({ minimumBillingAmount: 500, totalUsageLimit: 500 })
      )
    })
    await advance(1000)

    expect(limitWrites()).toEqual([])
    expect(error).toHaveBeenCalledWith(expect.stringContaining('at least'))
  })
})
