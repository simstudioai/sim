/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { toast } from '@sim/emcn-legacy'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Admin } from '@/components/settings/sections/admin/admin'
import { UsageLimitField } from '@/components/settings/sections/billing/components/usage-limit-field/usage-limit-field'
import { Mothership } from '@/components/settings/sections/mothership/mothership'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import * as workspacePermissions from '@/components/workspace-providers/workspace-permissions-provider'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { resetDeploymentShape } from '@/lib/core/config/deployment-shape'
import { type SubscriptionApiResponse, useSubscriptionData } from '@/hooks/queries/subscription'
import { subscriptionKeys } from '@/hooks/queries/utils/subscription-keys'
import * as stores from '@/stores'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)
vi.mock('@/lib/auth/client', () => authClientMock)

function UsageEditor() {
  const { data } = useSubscriptionData({ includeOrg: false })
  return (
    <UsageLimitField
      currentLimit={data?.data.usage.limit ?? 5}
      minimumLimit={5}
      canEdit
      context='user'
    />
  )
}

const PRO_BILLING = {
  success: true,
  context: 'user',
  data: {
    type: 'individual',
    plan: 'pro',
    currentUsage: 0,
    usageLimit: 5,
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    daysRemaining: 10,
    creditBalance: 0,
    billingInterval: 'month',
    isPaid: true,
    isPro: true,
    isTeam: false,
    isEnterprise: false,
    isOrgScoped: false,
    organizationId: null,
    status: 'active',
    seats: null,
    metadata: null,
    stripeSubscriptionId: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    billingBlocked: false,
    billingBlockedReason: null,
    blockedByOrgOwner: false,
    upgradeWorkspaceId: null,
    usage: {
      current: 0,
      limit: 5,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost: 0,
      lastPeriodCopilotCost: 0,
      daysRemaining: 10,
      copilotCost: 0,
    },
  },
}

let root: Root
let container: HTMLDivElement
let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.spyOn(toast, 'success').mockReturnValue('toast-a')
  vi.spyOn(toast, 'error').mockReturnValue('toast-a')
  nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-a' })
  vi.spyOn(workspacePermissions, 'useUserPermissionsContext').mockReturnValue({
    canAdmin: true,
    canEdit: true,
    canRead: true,
    userPermissions: 'admin',
    isLoading: false,
    error: null,
  })
  useSettingsDirtyStore.getState().reset()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
    await flushMicrotasks()
  })
  client.clear()
  container.remove()
  nextNavigationMockFns.mockUseParams.mockReset()
  authClientMockFns.mockUseSession.mockReset()
  authClientMockFns.mockClient.admin.listUsers.mockReset()
  authClientMockFns.mockClient.admin.impersonateUser.mockReset()
  nextNavigationMockFns.router.push.mockReset()
  resetDeploymentShape()
  vi.useRealTimers()
})

async function render(children: ReactNode, searchParams = '') {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <SettingsHeaderProvider>
            <SettingsHeaderShell>{children}</SettingsHeaderShell>
          </SettingsHeaderProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
    await vi.advanceTimersByTimeAsync(1)
  })
}

function input(selector: string) {
  const field = container.querySelector<HTMLInputElement>(selector)
  if (!field) throw new Error(`Missing input ${selector}`)
  return field
}

function edit(selector: string, value: string) {
  const field = input(selector)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Missing input setter')
  act(() => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  )
  if (!button) throw new Error(`Missing button ${text}`)
  act(() => button.click())
}

function expectLeave(allowed: boolean) {
  let left = false
  act(() =>
    useSettingsDirtyStore.getState().requestLeave(() => {
      left = true
    })
  )
  expect(left).toBe(allowed)
  useSettingsDirtyStore.getState().cancelLeave()
}

it('protects a usage-limit edit before its debounce and permits equivalent numeric values', async () => {
  await render(<UsageLimitField currentLimit={5} minimumLimit={5} canEdit context='user' />)
  expectLeave(true)
  edit('input[inputmode="numeric"]', '1000.0')
  expectLeave(true)
  edit('input[inputmode="numeric"]', '2000')
  expectLeave(false)
  edit('input[inputmode="numeric"]', '1000')
  expectLeave(true)
})

it('retains an authored usage limit after its optimistic update rolls back', async () => {
  const request = createDeferred<Response>()
  const billing = PRO_BILLING
  client.setQueryData(subscriptionKeys.user(false), billing)
  let payload: unknown
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        payload = JSON.parse(String(init.body))
        return request.promise
      }
      return Promise.resolve(jsonResponse(billing))
    })
  )
  await render(<UsageEditor />)
  expectLeave(true)
  edit('input[inputmode="numeric"]', '2000')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1001)
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(payload).toEqual({ context: 'user', limit: 10 })
  expect(
    client.getQueryData<SubscriptionApiResponse>(subscriptionKeys.user(false))?.data.usage.limit
  ).toBe(10)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50)
  })
  expectLeave(false)
  await act(async () => {
    request.resolve(jsonResponse({ error: 'Unable to save' }, 503))
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(50)
  })
  expect(input('input[inputmode="numeric"]').value).toBe('2000')
  expectLeave(false)
})

it('resumes saved billing values after reverting an uncapped field to its original blank', async () => {
  await render(
    <UsageLimitField currentLimit={ON_DEMAND_UNLIMITED} minimumLimit={5} canEdit context='user' />
  )
  edit('input[inputmode="numeric"]', '2000')
  edit('input[inputmode="numeric"]', '')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1001)
  })
  expectLeave(true)
  await render(<UsageLimitField currentLimit={5} minimumLimit={5} canEdit context='user' />)
  expect(input('input[inputmode="numeric"]').value).toBe('1000')
  expectLeave(true)
})

it.each([
  ['input[placeholder="e.g. Acme Corp"]', 'Draft enterprise'],
  ['input[placeholder="Signed order form or written approval"]', 'Draft approval'],
  ['input[type="date"]', '2027-01-01'],
])('protects a license draft entered in %s and clears on discard', async (selector, value) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ licenses: [] }))
  )
  await render(<Mothership />, '?tab=licenses')
  expectLeave(true)
  edit(selector, value)
  expectLeave(false)
  edit(selector, '')
  expectLeave(true)
  edit(selector, value)
  act(() => {
    useSettingsDirtyStore.getState().requestLeave(() => {})
    useSettingsDirtyStore.getState().confirmLeave()
  })
  expect(input(selector).value).toBe('')
  expectLeave(true)
})

it.each(['Source workflow ID', 'Target workspace ID'])(
  'protects a partial admin import draft in %s',
  async (placeholder) => {
    await render(<Admin />)
    const selector = `input[placeholder="${placeholder}"]`
    expectLeave(true)
    edit(selector, 'draft-id')
    expectLeave(false)
    edit(selector, '')
    expectLeave(true)
  }
)

it.each(['leave', 'edit', 'overwrite', 'acknowledge', 'discard'])(
  'protects a generated one-time license key during %s',
  async (action) => {
    let issuedKeys = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const endpoint = new URL(String(url), 'http://localhost').searchParams.get('endpoint')
        return jsonResponse(
          endpoint === 'licenses/generate'
            ? { license_key: `one-time-license-${++issuedKeys}` }
            : { licenses: [] }
        )
      })
    )
    await render(<Mothership />, '?tab=licenses')
    edit('input[placeholder="e.g. Acme Corp"]', 'Review enterprise')
    edit('input[placeholder="Signed order form or written approval"]', 'Review approval')
    click('Generate')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
      await flushMicrotasks()
    })
    expect(
      [...container.querySelectorAll('input')].some((field) => field.value === 'one-time-license-1')
    ).toBe(true)
    expect(input('input[placeholder="e.g. Acme Corp"]').value).toBe('')
    if (action === 'leave') {
      expectLeave(false)
      return
    }
    edit('input[placeholder="e.g. Acme Corp"]', 'Next enterprise')
    edit('input[placeholder="Signed order form or written approval"]', 'Next approval')
    if (action === 'discard') {
      act(() => {
        useSettingsDirtyStore.getState().requestLeave(() => {})
        useSettingsDirtyStore.getState().confirmLeave()
      })
      expect(
        [...container.querySelectorAll('input')].some(
          (field) => field.value === 'one-time-license-1'
        )
      ).toBe(false)
      expect(input('input[placeholder="e.g. Acme Corp"]').value).toBe('')
      expectLeave(true)
      return
    }
    if (action === 'acknowledge') {
      click('Done')
      expect(input('input[placeholder="e.g. Acme Corp"]').value).toBe('Next enterprise')
      expectLeave(false)
    } else if (action === 'edit') {
      expect(
        [...container.querySelectorAll('input')].some(
          (field) => field.value === 'one-time-license-1'
        )
      ).toBe(true)
      return
    }
    click('Generate')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
      await flushMicrotasks()
    })
    expect(issuedKeys).toBe(action === 'overwrite' ? 1 : 2)
    expectLeave(false)
  }
)

it.each(['request', 'cleanup', 'reopened-request', 'reopened-cleanup', 'failed', 'rejected'])(
  'serializes impersonation targets during the %s phase',
  async (phase) => {
    const firstTransition = createDeferred<unknown>()
    const cleanup = createDeferred<boolean>()
    const requestedIdentities: string[] = []
    vi.spyOn(stores, 'clearUserData').mockImplementation(() => cleanup.promise)
    authClientMockFns.mockUseSession.mockReturnValue({
      data: { user: { id: 'admin-a', role: 'admin' } },
      isPending: false,
      error: null,
    })
    authClientMockFns.mockClient.admin.listUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'user-a', name: 'A', email: 'a@example.com', role: 'user' },
          { id: 'user-b', name: 'B', email: 'b@example.com', role: 'user' },
        ],
        total: 2,
      },
      error: null,
    })
    authClientMockFns.mockClient.admin.impersonateUser.mockImplementation(
      ({ userId }: { userId: string }) => {
        requestedIdentities.push(userId)
        return phase.endsWith('cleanup')
          ? Promise.resolve({ data: {}, error: null })
          : firstTransition.promise
      }
    )
    await render(<Admin />, '?q=example')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
      await flushMicrotasks()
    })
    const first = container.querySelector<HTMLButtonElement>(
      '[aria-label="Impersonate a@example.com"]'
    )
    if (!first) throw new Error('Impersonation rows did not load')
    await act(async () => {
      first.click()
      await vi.advanceTimersByTimeAsync(10)
    })
    if (phase === 'failed') {
      await act(async () => {
        firstTransition.reject(new Error('Identity switch failed'))
        await vi.advanceTimersByTimeAsync(10)
      })
    } else if (phase === 'rejected') {
      await act(async () => {
        firstTransition.resolve({
          data: null,
          error: { message: 'Identity switch failed', status: 403, statusText: 'Forbidden' },
        })
        await vi.advanceTimersByTimeAsync(10)
      })
    }
    if (phase.startsWith('reopened-')) {
      let left = false
      act(() =>
        useSettingsDirtyStore.getState().requestLeave(() => {
          left = true
        })
      )
      if (left) {
        await render(null)
        await render(<Admin />, '?q=example')
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10)
          await flushMicrotasks()
        })
      }
    }
    const second = container.querySelector<HTMLButtonElement>(
      '[aria-label="Impersonate b@example.com"]'
    )
    if (!second) throw new Error('Impersonation rows did not load')
    await act(async () => {
      second.click()
      await vi.advanceTimersByTimeAsync(10)
    })
    const switchFailed = phase === 'failed' || phase === 'rejected'
    expect(requestedIdentities).toEqual(switchFailed ? ['user-a', 'user-b'] : ['user-a'])
    expectLeave(switchFailed)
  }
)
