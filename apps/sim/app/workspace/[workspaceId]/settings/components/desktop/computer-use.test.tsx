/** @vitest-environment jsdom */
import { act } from 'react'
import type {
  ComputerUseActivity,
  ComputerUseAppPermission,
  ComputerUseStatus,
} from '@sim/desktop-bridge'
import { toast } from '@sim/emcn'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComputerUseSettings } from '@/app/workspace/[workspaceId]/settings/components/desktop/computer-use'

const native = vi.hoisted(() => ({
  getStatus: vi.fn<() => Promise<ComputerUseStatus>>(),
  listAppPermissions: vi.fn<() => Promise<ComputerUseAppPermission[]>>(),
  revokeApp: vi.fn<(bundleId: string) => Promise<void>>(),
  cancel: vi.fn<() => Promise<void>>(),
  onActivity: vi.fn<(listener: (activity: ComputerUseActivity | null) => void) => () => void>(),
}))
vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)
vi.mock('@/lib/desktop', () => libDesktopMock)

const initialPermissions = [
  { bundleId: 'com.example.First', displayName: 'First app' },
  { bundleId: 'com.example.Second', displayName: 'Second app' },
]
let permissions: ComputerUseAppPermission[]
let activity: ComputerUseActivity | null
let listeners: Set<(activity: ComputerUseActivity | null) => void>
let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let available: boolean
let availabilitySettles: boolean
let requestedPaths: string[]

beforeEach(() => {
  available = true
  availabilitySettles = true
  requestedPaths = []
  queryClient = new QueryClient()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requestedPaths.push(new URL(String(input), 'http://localhost').pathname)
      return availabilitySettles ? jsonResponse({ available }) : new Promise<Response>(() => {})
    })
  )
  nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'ws-1' })
  permissions = [...initialPermissions]
  activity = null
  listeners = new Set()
  native.getStatus.mockImplementation(async () => ({
    supported: true,
    enabled: true,
    permissions: { accessibility: true, screenCapture: true },
    activeAction: activity,
  }))
  native.listAppPermissions.mockImplementation(async () => [...permissions])
  native.revokeApp.mockImplementation(async (bundleId) => {
    permissions = permissions.filter((app) => app.bundleId !== bundleId)
  })
  native.cancel.mockResolvedValue(undefined)
  native.onActivity.mockImplementation((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  libDesktopMockFns.mockGetDesktopBridge.mockReturnValue({ computerUse: native })
  vi.spyOn(toast, 'error').mockImplementation(() => '')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

/** Retries the assertion, committing React's pending updates before each attempt. */
async function eventually(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(() => flushMacrotask())
    assertion()
  })
}

async function renderSettings({ awaitAvailability = true } = {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ComputerUseSettings />
      </QueryClientProvider>
    )
  })
  if (awaitAvailability) await eventually(() => expect(queryClient.isFetching()).toBe(0))
}

it('withholds the device controls when the workspace group withholds computer use', async () => {
  available = false
  await renderSettings()
  expect(requestedPaths).toEqual(['/api/workspaces/ws-1/computer-use/availability'])
  expect(appRow('com.example.First')).toBeUndefined()
  expect(native.listAppPermissions).not.toHaveBeenCalled()
})

it('asks the organization on organization settings and shows its controls', async () => {
  nextNavigationMockFns.mockUseParams.mockReturnValue({ organizationId: 'org-1' })
  await renderSettings()
  expect(requestedPaths).toEqual(['/api/organizations/org-1/computer-use/availability'])
  await eventually(() => expect(native.listAppPermissions).toHaveBeenCalled())
})

it('withholds the device controls where no workspace or organization governs them', async () => {
  nextNavigationMockFns.mockUseParams.mockReturnValue({})
  await renderSettings()
  expect(requestedPaths).toEqual([])
  expect(native.listAppPermissions).not.toHaveBeenCalled()
})

it('withholds the device controls until the availability read succeeds', async () => {
  availabilitySettles = false
  await renderSettings({ awaitAvailability: false })
  await eventually(() => expect(requestedPaths).toHaveLength(1))
  expect(appRow('com.example.First')).toBeUndefined()
  expect(container.querySelector('[role="switch"]')).toBeNull()
  expect(native.listAppPermissions).not.toHaveBeenCalled()
})

function appRow(bundleId: string) {
  return container.querySelector<HTMLElement>(`[title="${bundleId}"]`)?.parentElement
}

it('lists approved apps only while first use of an app needs approval', async () => {
  const status = (askForApps: boolean): ComputerUseStatus => ({
    supported: true,
    enabled: true,
    permissions: { accessibility: true, screenCapture: true },
    activeAction: null,
    askForApps,
  })
  libDesktopMockFns.mockGetDesktopBridge.mockReturnValue({
    computerUse: { ...native, setAskForApps: vi.fn(async (ask: boolean) => status(ask)) },
  })
  native.getStatus.mockResolvedValue(status(false))
  await renderSettings()
  await eventually(() =>
    expect(container.querySelector('[aria-label="Ask before using a new app"]')).not.toBeNull()
  )
  expect(appRow('com.example.First')).toBeUndefined()
  native.getStatus.mockResolvedValue(status(true))
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(appRow('com.example.First')).toBeDefined()
})

it('does not restore a revoked app when an earlier activity refresh settles late', async () => {
  await renderSettings()
  const stale = createDeferred<ComputerUseAppPermission[]>()
  native.listAppPermissions.mockImplementationOnce(() => stale.promise)
  await act(async () => {
    activity = { toolCallId: 'in-flight', scopeId: 'chat', action: 'click', startedAt: Date.now() }
    for (const listener of listeners) listener(activity)
  })
  const revoke = appRow('com.example.First')?.querySelector<HTMLButtonElement>('button')
  expect(revoke).toBeTruthy()
  await act(async () => revoke?.click())
  expect(appRow('com.example.First')).toBeUndefined()
  expect(appRow('com.example.Second')).toBeDefined()
  await act(async () => stale.resolve(initialPermissions))
  expect(appRow('com.example.First')).toBeUndefined()
  expect(appRow('com.example.Second')).toBeDefined()
})
