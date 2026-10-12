/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { providersModelsMock } from '@sim/testing/mocks/providers-models.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionGroup } from '@/lib/api/contracts/permission-groups'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { AccessControl } from '@/ee/access-control/components/access-control'
import { GroupDetail } from '@/ee/access-control/components/group-detail'
import { allowedProvidersKeys } from '@/hooks/queries/allowed-providers'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { permissionGroupKeys } from '@/hooks/queries/utils/permission-group-keys'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

vi.mock('@/lib/auth/auth-client', () => authClientMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/providers/models', () => providersModelsMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const group: PermissionGroup = {
  id: 'group-1',
  name: 'Engineering',
  description: null,
  config: { ...DEFAULT_PERMISSION_GROUP_CONFIG },
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  creatorName: null,
  creatorEmail: null,
  memberCount: 0,
  isDefault: false,
  workspaces: [],
}

let root: Root
let container: HTMLDivElement
let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  providersUtilsMockFns.mockGetAllProviderIds.mockReturnValue(['openai', 'anthropic'])
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(permissionGroupKeys.members('org-1', 'group-1'), [])
  client.setQueryData(organizationKeys.roster('org-1'), {
    members: [],
    pendingInvitations: [],
    workspaces: [],
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  client.clear()
  container.remove()
  providersUtilsMockFns.mockGetAllProviderIds.mockReset()
  vi.useRealTimers()
})

function render(currentGroup = group) {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter hasMemory searchParams='?group-tab=providers'>
          <GroupDetail
            group={currentGroup}
            organizationId='org-1'
            workspaceOptions={[]}
            organizationWorkspaces={[]}
            workspacesLoading={false}
            onBack={() => {}}
            onDeleted={() => {}}
          />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
}

function expectNoProviderControls() {
  expect(container.querySelector('[id^="provider-"]')).toBeNull()
  expect(container.querySelector('input[placeholder="Search providers..."]')).toBeNull()
  expect(
    [...container.querySelectorAll('button')].some((button) =>
      /^(De)?select All$/i.test(button.textContent ?? '')
    )
  ).toBe(false)
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}

describe('permission group settings availability', () => {
  it.each([{}, { workspaceId: 'workspace-1' }])(
    'edits groups without reading billing and retains the draft through a failed refresh (%j)',
    async (params) => {
      setEnvFlags({ isHosted: true, isBillingEnabled: true, isAccessControlEnabled: false })
      nextNavigationMockFns.mockUseParams.mockReturnValue(params)
      client.setQueryData(permissionGroupKeys.list('org-1'), [group])
      client.setQueryData(permissionGroupKeys.orgWorkspaces('org-1'), [])
      client.setQueryData(allowedProvidersKeys.blacklisted(), { blacklistedProviders: [] })
      const requests: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          requests.push(url)
          return jsonResponse({ error: 'Service temporarily unavailable' }, 503)
        })
      )
      act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <NuqsTestingAdapter hasMemory searchParams='?group-id=group-1&group-tab=providers'>
              <AccessControl organizationId='org-1' isOrganizationAdmin requestsHref='/requests' />
            </NuqsTestingAdapter>
          </QueryClientProvider>
        )
      )
      await settle()
      const toggle = container.querySelector<HTMLButtonElement>('#provider-openai')
      if (!toggle) throw new Error('Authorized group editor was blocked by an unrelated read')
      act(() => toggle.click())
      let left = false
      act(() =>
        useSettingsDirtyStore.getState().requestLeave(() => {
          left = true
        })
      )
      expect(left).toBe(false)
      await act(async () => {
        await client.invalidateQueries({ queryKey: permissionGroupKeys.list('org-1') })
      })
      await settle()
      const refreshedToggle = container.querySelector<HTMLButtonElement>('#provider-openai')
      if (!refreshedToggle) throw new Error('Group editor disappeared after refresh')
      expect(refreshedToggle.getAttribute('aria-checked')).toBe('false')
      left = false
      act(() =>
        useSettingsDirtyStore.getState().requestLeave(() => {
          left = true
        })
      )
      expect(left).toBe(false)
      expect(requests.some((url) => url.startsWith('/api/billing'))).toBe(false)
    }
  )
})

describe('provider permission policy availability', () => {
  it('stops warning after restoring the same provider membership in a different order', async () => {
    providersUtilsMockFns.mockGetAllProviderIds.mockReturnValue(['openai', 'anthropic', 'google'])
    client.setQueryData(allowedProvidersKeys.blacklisted(), { blacklistedProviders: [] })
    render({
      ...group,
      config: { ...group.config, allowedModelProviders: ['openai', 'anthropic'] },
    })
    const toggle = container.querySelector<HTMLButtonElement>('#provider-openai')
    if (!toggle) throw new Error('Missing provider toggle')
    act(() => toggle.click())
    let left = false
    act(() =>
      useSettingsDirtyStore.getState().requestLeave(() => {
        left = true
      })
    )
    expect(left).toBe(false)
    act(() => toggle.click())
    act(() =>
      useSettingsDirtyStore.getState().requestLeave(() => {
        left = true
      })
    )
    expect(left).toBe(true)
  })

  it('withholds provider edits until the server policy is known', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => createDeferred<Response>().promise)
    )
    render()
    expectNoProviderControls()
  })

  it.each([
    { status: 503, body: { error: 'Policy temporarily unavailable' }, blacklist: ['openai'] },
    { status: 401, body: { error: 'Session expired' }, blacklist: [] },
    { status: 200, body: { blacklistedProviders: 'invalid' }, blacklist: ['openai'] },
  ])(
    'withholds edits after a $status response and recovers through retry',
    async ({ status, body, blacklist }) => {
      const retry = createDeferred<Response>()
      let requests = 0
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url !== '/api/settings/allowed-providers')
            throw new Error(`Unexpected request: ${url}`)
          requests++
          return requests === 1 ? Promise.resolve(jsonResponse(body, status)) : retry.promise
        })
      )
      render()
      await settle()
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
      expectNoProviderControls()
      const retryButton = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Try again'
      )
      expect(retryButton).toBeDefined()
      act(() => retryButton!.click())
      await settle()
      expect(requests).toBe(2)
      expectNoProviderControls()
      await act(async () => {
        retry.resolve(jsonResponse({ blacklistedProviders: blacklist }))
      })
      await settle()
      expect(container.querySelector('[role="alert"]')).toBeNull()
      const anthropic = container.querySelector<HTMLButtonElement>('#provider-anthropic')
      expect(anthropic?.getAttribute('aria-checked')).toBe('true')
      expect(Boolean(container.querySelector('#provider-openai'))).toBe(
        !blacklist.includes('openai')
      )
      act(() => anthropic!.click())
      expect(anthropic?.getAttribute('aria-checked')).toBe('false')
    }
  )
})
