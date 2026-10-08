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
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { ComputerUseSettings } from '@/app/workspace/[workspaceId]/settings/components/desktop/computer-use'

const native = vi.hoisted(() => ({
  getStatus: vi.fn<() => Promise<ComputerUseStatus>>(),
  listAppPermissions: vi.fn<() => Promise<ComputerUseAppPermission[]>>(),
  revokeApp: vi.fn<(bundleId: string) => Promise<void>>(),
  cancel: vi.fn<() => Promise<void>>(),
  onActivity: vi.fn<(listener: (activity: ComputerUseActivity | null) => void) => () => void>(),
}))
vi.mock('@/lib/desktop', () => libDesktopMock)

const initialPermissions = [
  { bundleId: 'com.example.First', displayName: 'First app' },
  { bundleId: 'com.example.Second', displayName: 'Second app' },
]
let permissions: ComputerUseAppPermission[]
let activity: ComputerUseActivity | null
let listeners: Set<(activity: ComputerUseActivity | null) => void>
let enabled: boolean
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  enabled = true
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
  root.render(
    <FeatureFlagsProvider
      flags={{
        dashboards: false,
        'table-row-ttl': false,
        'mothership-model-selector': false,
        'mothership-computer-use': enabled,
      }}
    >
      <ComputerUseSettings />
    </FeatureFlagsProvider>
  )
}

it('keeps settings dormant while rollout is off, including focus and activity changes', async () => {
  enabled = false
  await act(async () => renderSettings())
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(native.getStatus).not.toHaveBeenCalled()
  expect(native.listAppPermissions).not.toHaveBeenCalled()
  expect(container.textContent).toBe('')

  enabled = true
  await act(async () => renderSettings())
  expect(native.getStatus).toHaveBeenCalled()
  expect(appRow('com.example.First')).toBeDefined()
  await act(async () => {
    activity = { toolCallId: 'in-flight', scopeId: 'chat', action: 'click', startedAt: Date.now() }
    for (const listener of listeners) listener(activity)
  })
  enabled = false
  await act(async () => renderSettings())
  native.getStatus.mockClear()
  native.listAppPermissions.mockClear()
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    for (const listener of listeners) listener(activity)
  })
  expect(native.getStatus).not.toHaveBeenCalled()
  expect(native.listAppPermissions).not.toHaveBeenCalled()
  const stop = container.querySelector<HTMLButtonElement>('button')
  expect(stop?.textContent).toContain('Stop')
  await act(async () => stop?.click())
  expect(native.cancel).toHaveBeenCalledOnce()
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
