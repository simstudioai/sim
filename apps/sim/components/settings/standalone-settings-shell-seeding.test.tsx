/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSettingsSidebar } = vi.hoisted(() => ({
  mockSettingsSidebar: vi.fn((_props: { items: { id: string }[] }) => null),
}))

vi.mock('next/navigation', () => nextNavigationMock)
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

nextNavigationMockFns.mockUsePathname.mockReturnValue('/selfhost/settings/general')

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
})

describe('StandaloneSettingsShell', () => {
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
