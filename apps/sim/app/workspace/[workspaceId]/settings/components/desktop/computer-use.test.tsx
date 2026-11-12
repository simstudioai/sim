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
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { ComputerUseSettings } from '@/app/workspace/[workspaceId]/settings/components/desktop/computer-use'

const native = vi.hoisted(() => ({
  getStatus: vi.fn<() => Promise<ComputerUseStatus>>(),
  listAppPermissions: vi.fn<() => Promise<ComputerUseAppPermission[]>>(),
  revokeApp: vi.fn<(bundleId: string) => Promise<void>>(),
  cancel: vi.fn<() => Promise<void>>(),
  onActivity: vi.fn<(listener: (activity: ComputerUseActivity | null) => void) => () => void>(),
}))
const permission = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  ready: true,
}))
vi.mock('@/ee/access-control/hooks/permission-groups', () => ({
  useUserPermissionConfig: () =>
    permission.ready
      ? { isSuccess: true, data: { config: permission.config } }
      : { isSuccess: false, data: undefined },
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
  permission.config = null
  permission.ready = true
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

it.each(['disableComputerUse', 'hideCopilot'])(
  'withholds the device controls when the permission group sets %s',
  async (key) => {
    permission.config = { ...DEFAULT_PERMISSION_GROUP_CONFIG, [key]: true }
    await act(async () => renderSettings())
    expect(appRow('com.example.First')).toBeUndefined()
    expect(container.querySelector('[role="switch"]')).toBeNull()
  }
)

it('withholds the device controls until the permission read succeeds', async () => {
  permission.ready = false
  await act(async () => renderSettings())
  expect(appRow('com.example.First')).toBeUndefined()
  expect(container.querySelector('[role="switch"]')).toBeNull()
  expect(native.listAppPermissions).not.toHaveBeenCalled()
})

function appRow(bundleId: string) {
  return container.querySelector<HTMLElement>(`[title="${bundleId}"]`)?.parentElement
}

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
