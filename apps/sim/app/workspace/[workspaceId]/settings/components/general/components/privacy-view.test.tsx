/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mutate, toastError, settings } = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastError: vi.fn(),
  settings: { telemetryEnabled: true },
}))

vi.mock('@/hooks/queries/general-settings', () => ({
  useGeneralSettings: () => ({ data: settings }),
  useUpdateGeneralSetting: () => ({ mutateAsync: mutate, isPending: false }),
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({ hosted: false }),
}))
vi.mock('@sim/emcn', () => ({
  ArrowLeft: () => null,
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean
    disabled: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      type='checkbox'
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
  toast: { error: toastError },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/general/components/cookie-preferences',
  () => ({ CookiePreferences: () => null })
)
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  })
)

import {
  getBrowserTelemetryPreference,
  setBrowserTelemetryPreference,
} from '@/lib/telemetry/browser-preference'
import { PrivacyView } from '@/app/workspace/[workspaceId]/settings/components/general/components/privacy-view'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  root = createRoot(container)
  setBrowserTelemetryPreference(true)
  settings.telemetryEnabled = true
})

afterEach(() => {
  act(() => root.unmount())
  localStorage.clear()
  vi.clearAllMocks()
})

function clickToggle() {
  act(() => root.render(<PrivacyView onBack={() => {}} />))
  const input = container.querySelector('input')
  if (!input) throw new Error('Missing telemetry switch')
  act(() => input.click())
}

describe('PrivacyView telemetry preference', () => {
  it('withdraws locally before waiting for the account update', async () => {
    const pending = Promise.withResolvers<void>()
    mutate.mockReturnValue(pending.promise)
    clickToggle()
    expect(getBrowserTelemetryPreference()).toBe(false)
    expect(mutate).toHaveBeenCalledWith({ key: 'telemetryEnabled', value: false })
    await act(async () => pending.resolve())
    expect(getBrowserTelemetryPreference()).toBe(false)
  })

  it('restores the previous preference and reports a failed save', async () => {
    const pending = Promise.withResolvers<void>()
    mutate.mockReturnValue(pending.promise)
    clickToggle()
    expect(getBrowserTelemetryPreference()).toBe(false)
    await act(async () => pending.reject(new Error('Unable to save')))
    expect(getBrowserTelemetryPreference()).toBe(true)
    expect(toastError).toHaveBeenCalledWith('Unable to save')
  })

  it.each([false, true])(
    'waits for an enable update with browser preference %s',
    async (preference) => {
      settings.telemetryEnabled = false
      setBrowserTelemetryPreference(preference)
      const pending = Promise.withResolvers<void>()
      mutate.mockReturnValue(pending.promise)
      clickToggle()
      expect(getBrowserTelemetryPreference()).toBe(false)
      await act(async () => pending.resolve())
      expect(getBrowserTelemetryPreference()).toBe(true)
    }
  )
})
