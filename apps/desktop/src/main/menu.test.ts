import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { MenuItemConstructorOptions } from 'electron'
import type { ConfigStore } from '@/main/config'
import { buildMenuTemplate, type MenuDeps } from '@/main/menu'

function makeDeps(platform: NodeJS.Platform = 'darwin', origin = 'https://sim.ai'): MenuDeps {
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
    openFolderAccess: vi.fn(),
    newWindow: vi.fn(),
    newChat: vi.fn(),
    handleFocusedResourceShortcut: vi.fn(() => false),
    toggleSidebar: vi.fn(),
    openSearch: vi.fn(),
    signOut: vi.fn(),
    checkForUpdates: vi.fn(),
    openDiagnostics: vi.fn(),
    platform,
  }
}

/** Every item at any depth, so hidden resource items count too. */
function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu as MenuItemConstructorOptions[]) : []),
  ])
}

function accelerators(template: MenuItemConstructorOptions[]): Set<string> {
  return new Set(
    flatten(template).flatMap((item) =>
      typeof item.accelerator === 'string' ? [item.accelerator] : []
    )
  )
}

describe('buildMenuTemplate', () => {
  it.each(['darwin', 'win32'] as const)('never exposes developer tools on %s', (platform) => {
    const items = flatten(buildMenuTemplate(makeDeps(platform)))
    expect(items.some((item) => item.role === 'toggleDevTools')).toBe(false)
  })

  it('keeps every macOS shortcut working on Windows', () => {
    const windows = accelerators(buildMenuTemplate(makeDeps('win32')))
    for (const accelerator of accelerators(buildMenuTemplate(makeDeps('darwin')))) {
      expect(windows).toContain(accelerator)
    }
    expect(windows).toContain('Alt+Left')
    expect(windows).toContain('Alt+Right')
  })

  it('builds the Windows menu without macOS-only app roles', () => {
    // windowMenu is excluded too: off macOS it adds a Close item on Ctrl+W
    // that would steal the hidden Close Tab accelerator.
    const roles = flatten(buildMenuTemplate(makeDeps('win32'))).map((item) => item.role)
    for (const role of ['hide', 'hideOthers', 'unhide', 'services', 'windowMenu', 'appMenu']) {
      expect(roles).not.toContain(role)
    }
    expect(roles).toContain('editMenu')
    expect(roles).toContain('quit')
  })

  it('binds each Windows accelerator to exactly one item', () => {
    const counts = new Map<string, number>()
    for (const item of flatten(buildMenuTemplate(makeDeps('win32')))) {
      if (typeof item.accelerator === 'string') {
        counts.set(item.accelerator, (counts.get(item.accelerator) ?? 0) + 1)
      }
    }
    expect([...counts].filter(([, count]) => count > 1)).toEqual([])
  })
})
