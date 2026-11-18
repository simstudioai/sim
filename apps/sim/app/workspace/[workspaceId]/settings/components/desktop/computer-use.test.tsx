/** @vitest-environment jsdom */
import { act } from 'react'
import type {
  ComputerUseActivity,
  ComputerUseAppPermission,
  ComputerUseStatus,
} from '@sim/desktop-bridge'
import { toast } from '@sim/emcn'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
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
const availability = vi.hoisted(() => ({
  available: true,
  ready: true,
  owner: undefined as unknown,
}))
vi.mock('@/hooks/queries/computer-use', () => ({
  useComputerUseAvailability: (owner: unknown) => {
    availability.owner = owner
    return { data: availability.ready && owner ? availability.available : undefined }
  },
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

beforeEach(() => {
  availability.available = true
  availability.ready = true
  availability.owner = undefined
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

function renderSettings() {
  root.render(<ComputerUseSettings />)
}

it('withholds the device controls when the permission group withholds computer use', async () => {
  availability.available = false
  await act(async () => renderSettings())
  expect(availability.owner).toEqual({ workspaceId: 'ws-1' })
  expect(appRow('com.example.First')).toBeUndefined()
  expect(native.listAppPermissions).not.toHaveBeenCalled()
})

it('asks the organization on organization settings and shows its controls', async () => {
  nextNavigationMockFns.mockUseParams.mockReturnValue({ organizationId: 'org-1' })
  await act(async () => renderSettings())
  expect(availability.owner).toEqual({ organizationId: 'org-1' })
  expect(native.listAppPermissions).toHaveBeenCalled()
})

it('withholds the device controls where no workspace or organization governs them', async () => {
  nextNavigationMockFns.mockUseParams.mockReturnValue({})
  await act(async () => renderSettings())
  expect(availability.owner).toBeNull()
  expect(native.listAppPermissions).not.toHaveBeenCalled()
})

it('withholds the device controls until the availability read succeeds', async () => {
  availability.ready = false
  await act(async () => renderSettings())
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
  await act(async () => renderSettings())
  expect(container.querySelector('[aria-label="Ask before using a new app"]')).not.toBeNull()
  expect(appRow('com.example.First')).toBeUndefined()
  native.getStatus.mockResolvedValue(status(true))
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(appRow('com.example.First')).toBeDefined()
})

it('does not restore a revoked app when an earlier activity refresh settles late', async () => {
  await act(async () => renderSettings())
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
