/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  ...emcnMock,
  Label: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Switch: ({ id, checked }: { id: string; checked: boolean }) => (
    <button type='button' role='switch' id={id} aria-checked={checked} />
  ),
}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/desktop', () => libDesktopMock)
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  })
)

import { Desktop } from '@/app/workspace/[workspaceId]/settings/components/desktop/desktop'

const PREFERENCES = {
  launchAtLogin: false,
  trayEnabled: true,
  autoDownloadUpdates: true,
  notificationsEnabled: true,
  notificationSounds: true,
  notificationsOnlyWhenUnfocused: true,
  preventSleepWhileRunning: true,
}

let root: Root | null = null

/** Renders the settings page in a shell whose executor has, or lacks, a registered device. */
async function render(device: { deviceId: string } | null) {
  libDesktopMockFns.mockGetDesktopBridge.mockReturnValue({
    settings: {
      getPreferences: async () => PREFERENCES,
      setPreventSleepWhileRunning: async () => PREFERENCES,
    },
    desktopExecutor: { getDevice: async () => device },
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<Desktop />))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  libDesktopMockFns.mockGetDesktopBridge.mockReturnValue(undefined)
})

describe('Desktop settings: prevent sleep', () => {
  it('hides the switch when Sim runs no chats on this device in the background', async () => {
    const container = await render(null)

    expect(container.querySelector('#desktop-launch-at-login')).not.toBeNull()
    expect(container.querySelector('#desktop-prevent-sleep')).toBeNull()
  })

  it('shows the switch once this device runs chats in the background', async () => {
    const container = await render({ deviceId: 'device-1' })

    expect(container.querySelector('#desktop-prevent-sleep')?.getAttribute('aria-checked')).toBe(
      'true'
    )
  })
})
