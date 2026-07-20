import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { MenuItemConstructorOptions } from 'electron'
import type { ConfigStore } from '@/main/config'
import { buildMenuTemplate, type MenuDeps } from '@/main/menu'

function makeDeps(): MenuDeps {
  return {
    config: {
      filePath: '/tmp/settings.json',
      getOrigin: vi.fn(() => 'https://sim.ai'),
      setOrigin: vi.fn(),
      get: vi.fn(() => undefined),
      set: vi.fn(),
    } as unknown as ConfigStore,
    getMainWindow: vi.fn(() => null),
    allowHttpLocalhost: vi.fn(() => false),
    openSettings: vi.fn(),
    newChat: vi.fn(),
    toggleSidebar: vi.fn(),
    signOut: vi.fn(),
    checkForUpdates: vi.fn(),
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
  it('uses the requested native menu structure', () => {
    const template = buildMenuTemplate(makeDeps())
    expect(template.map((item) => item.label ?? item.role)).toEqual([
      'Sim',
      'File',
      'editMenu',
      'View',
      'windowMenu',
      'help',
    ])

    expect(submenu(template, 'Sim').map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'about',
      'Settings…',
      'Check for Updates…',
      'Sign Out',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ])
    expect(submenu(template, 'File').map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'New Chat',
      'separator',
      'close',
    ])
    expect(submenu(template, 'View').map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'Toggle Sidebar',
      'separator',
      'Reload',
      'separator',
      'Actual Size',
      'Zoom In',
      'Zoom Out',
      'separator',
      'togglefullscreen',
    ])
  })

  it('keeps Help limited to documentation and system status', () => {
    const help = submenu(buildMenuTemplate(makeDeps()), 'Help')
    expect(help.map((item) => item.label)).toEqual(['Sim Documentation', 'System Status'])
  })

  it('never exposes developer tools in the application menu', () => {
    const view = submenu(buildMenuTemplate(makeDeps()), 'View')
    expect(view.some((item) => item.role === 'toggleDevTools')).toBe(false)
  })
})
