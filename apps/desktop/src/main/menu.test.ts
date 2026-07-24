import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, type MenuItemConstructorOptions } from 'electron'
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
    newWindow: vi.fn(),
    newChat: vi.fn(),
    closeFocusedBrowserTab: vi.fn(() => false),
    reopenClosedBrowserTab: vi.fn(() => false),
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
      'New Window',
      'New Chat',
      'separator',
      'Reopen Closed Tab',
      'Close Window',
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

  it('routes the close accelerator through the focused browser tab before closing a window', () => {
    const closeFocusedBrowserTab = vi.fn((_win: BrowserWindow | null) => true)
    const deps = Object.assign(makeDeps(), { closeFocusedBrowserTab })
    const closeItem = submenu(buildMenuTemplate(deps), 'File').find(
      (item) => item.accelerator === 'CmdOrCtrl+W'
    )
    const focusedWindow = new BrowserWindow()

    expect(closeItem).toMatchObject({ label: 'Close Window', accelerator: 'CmdOrCtrl+W' })
    expect(closeItem?.role).toBeUndefined()

    const click = closeItem?.click as unknown as (
      menuItem: unknown,
      browserWindow: BrowserWindow
    ) => void
    click({}, focusedWindow)

    expect(closeFocusedBrowserTab).toHaveBeenCalledWith(focusedWindow)
    expect(focusedWindow.close).not.toHaveBeenCalled()

    closeFocusedBrowserTab.mockReturnValue(false)
    click({}, focusedWindow)
    expect(focusedWindow.close).toHaveBeenCalledOnce()
  })

  it('routes the reopen accelerator through the focused browser session', () => {
    const reopenClosedBrowserTab = vi.fn((_win: BrowserWindow | null) => true)
    const template = buildMenuTemplate(
      Object.assign(makeDeps(), {
        reopenClosedBrowserTab,
      })
    )
    const reopenItem = submenu(template, 'File').find(
      (item) => item.accelerator === 'CmdOrCtrl+Shift+T'
    )

    expect(reopenItem).toMatchObject({
      label: 'Reopen Closed Tab',
      accelerator: 'CmdOrCtrl+Shift+T',
    })
    const focusedWindow = new BrowserWindow()
    ;(reopenItem?.click as unknown as (menuItem: unknown, browserWindow: BrowserWindow) => void)(
      {},
      focusedWindow
    )
    expect(reopenClosedBrowserTab).toHaveBeenCalledWith(focusedWindow)
  })

  it('offers the standard new-window command', () => {
    const deps = makeDeps()
    const item = submenu(buildMenuTemplate(deps), 'File').find(
      (entry) => entry.accelerator === 'CmdOrCtrl+Shift+N'
    )

    expect(item).toMatchObject({ label: 'New Window' })
    ;(item?.click as unknown as () => void)()
    expect(deps.newWindow).toHaveBeenCalledOnce()
  })
})
