import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { MenuItemConstructorOptions } from 'electron'
import type { ConfigStore } from '@/main/config'
import { buildMenuTemplate, type MenuDeps } from '@/main/menu'

function makeDeps(origin = 'https://sim.ai'): MenuDeps {
  return {
    config: {
      filePath: '/tmp/settings.json',
      getOrigin: vi.fn(() => origin),
      setOrigin: vi.fn(),
      get: vi.fn(() => undefined),
      set: vi.fn(),
    } as unknown as ConfigStore,
    getMainWindow: vi.fn(() => null),
    isMainWindow: vi.fn(() => true),
    allowHttpLocalhost: vi.fn(() => false),
    openSettings: vi.fn(),
    openServerSettings: vi.fn(),
    newWindow: vi.fn(),
    newChat: vi.fn(),
    handleFocusedResourceShortcut: vi.fn(() => false),
    toggleSidebar: vi.fn(),
    openSearch: vi.fn(),
    signOut: vi.fn(),
    checkForUpdates: vi.fn(),
    openDiagnostics: vi.fn(),
  }
}

function submenu(
  template: MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions[] {
  return (template.find((item) => item.label === label || item.role === label.toLowerCase())
    ?.submenu ?? []) as MenuItemConstructorOptions[]
}

describe('buildMenuTemplate', () => {
  it('never exposes developer tools in the application menu', () => {
    const view = submenu(buildMenuTemplate(makeDeps()), 'View')
    expect(view.some((item) => item.role === 'toggleDevTools')).toBe(false)
  })
})
