/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSettingsSidebar } = vi.hoisted(() => ({
  mockSettingsSidebar: vi.fn((_props: { items: { id: string }[] }) => null),
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/selfhost/settings/general' }))
vi.mock('@/components/settings/settings-sidebar', () => ({ SettingsSidebar: mockSettingsSidebar }))
vi.mock('@/components/settings/settings-header', () => ({
  SettingsHeaderProvider: ({ children }: { children: ReactNode }) => children,
  SettingsHeaderShell: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/settings/settings-panel', () => ({
  SettingsSectionProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/settings/use-settings-before-unload', () => ({
  useSettingsBeforeUnload: vi.fn(),
}))

import { StandaloneSettingsShell } from '@/components/settings/standalone-settings-shell'
import {
  getDeploymentShape,
  resetDeploymentShape,
  resolveDeploymentShape,
} from '@/lib/core/config/deployment-shape'
import { useSidebarStore } from '@/stores/sidebar/store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const originalInnerWidth = window.innerWidth

beforeEach(() => {
  resetDeploymentShape()
  window.innerWidth = 1600
  localStorage.clear()
  useSidebarStore.setState({ sidebarWidth: 400, isCollapsed: false, _hasHydrated: false })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.innerWidth = originalInnerWidth
  localStorage.clear()
  vi.clearAllMocks()
})

describe('StandaloneSettingsShell', () => {
  it.each([false, true])(
    'resizes consistently with workspace chrome (collapsed: %s)',
    async (isCollapsed) => {
      useSidebarStore.setState({ isCollapsed })
      act(() =>
        root.render(
          <StandaloneSettingsShell plane='selfhost' deployment={resolveDeploymentShape()}>
            {null}
          </StandaloneSettingsShell>
        )
      )
      const expandedWidth = () =>
        document.documentElement.style.getPropertyValue('--sidebar-expanded-width')
      expect(expandedWidth()).toBe('400px')

      await act(async () => {
        window.innerWidth = 800
        window.dispatchEvent(new Event('resize'))
        await vi.waitFor(() => expect(expandedWidth()).toBe('240px'))
      })
      expect(useSidebarStore.getState().sidebarWidth).toBe(isCollapsed ? 400 : 240)

      await act(async () => {
        window.innerWidth = 1600
        window.dispatchEvent(new Event('resize'))
        await vi.waitFor(() => expect(expandedWidth()).toBe(isCollapsed ? '400px' : '240px'))
      })
      act(() => useSidebarStore.getState().syncWidth())
      expect(expandedWidth()).toBe(isCollapsed ? '400px' : '240px')
    }
  )

  it('filters its navigation by the server-resolved shape, not the env fallback', () => {
    /** Inverts the fallback's hosted and billing switches, which decide the Billing and Chat keys items. */
    const fallback = resolveDeploymentShape()
    const deployment = {
      ...fallback,
      hosted: !fallback.hosted,
      billingEnabled: !fallback.billingEnabled,
    }

    act(() =>
      root.render(
        <StandaloneSettingsShell plane='selfhost' deployment={deployment}>
          {null}
        </StandaloneSettingsShell>
      )
    )

    const itemIds = mockSettingsSidebar.mock.calls[0][0].items.map((item) => item.id)
    expect(itemIds.includes('billing')).toBe(deployment.billingEnabled)
    expect(itemIds.includes('chat-keys')).toBe(deployment.hosted)
    expect(getDeploymentShape()).toBe(deployment)
  })
})
