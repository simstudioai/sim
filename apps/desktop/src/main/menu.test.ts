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
    handleFocusedResourceShortcut: vi.fn(() => false),
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
      'New Tab',
      'New Window',
      'New Chat',
      'separator',
      'Reopen Closed Tab',
      'Close Window',
    ])
    expect(submenu(template, 'View').map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'Toggle Sidebar',
      'separator',
      'Back',
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

  it('routes the close accelerator through the focused resource before closing a window', () => {
    const handleFocusedResourceShortcut = vi.fn(() => true)
    const deps = Object.assign(makeDeps(), { handleFocusedResourceShortcut })
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

    expect(handleFocusedResourceShortcut).toHaveBeenCalledWith(focusedWindow, 'close-tab')
    expect(focusedWindow.close).not.toHaveBeenCalled()

    handleFocusedResourceShortcut.mockReturnValue(false)
    click({}, focusedWindow)
    expect(focusedWindow.close).toHaveBeenCalledOnce()
  })

  it('routes new and reopen accelerators through the focused resource', () => {
    const handleFocusedResourceShortcut = vi.fn(() => true)
    const template = buildMenuTemplate(
      Object.assign(makeDeps(), {
        handleFocusedResourceShortcut,
      })
    )
    const newItem = submenu(template, 'File').find((item) => item.accelerator === 'CmdOrCtrl+T')
    const reopenItem = submenu(template, 'File').find(
      (item) => item.accelerator === 'CmdOrCtrl+Shift+T'
    )

    expect(reopenItem).toMatchObject({
      label: 'Reopen Closed Tab',
      accelerator: 'CmdOrCtrl+Shift+T',
    })
    const focusedWindow = new BrowserWindow()
    ;(newItem?.click as unknown as (menuItem: unknown, browserWindow: BrowserWindow) => void)(
      {},
      focusedWindow
    )
    ;(reopenItem?.click as unknown as (menuItem: unknown, browserWindow: BrowserWindow) => void)(
      {},
      focusedWindow
    )
    expect(handleFocusedResourceShortcut).toHaveBeenNthCalledWith(1, focusedWindow, 'new-tab')
    expect(handleFocusedResourceShortcut).toHaveBeenNthCalledWith(
      2,
      focusedWindow,
      'reopen-closed-tab'
    )
  })

  it('routes reload through the focused resource before falling back to the Sim renderer', () => {
    const handleFocusedResourceShortcut = vi.fn(() => true)
    const template = buildMenuTemplate(
      Object.assign(makeDeps(), {
        handleFocusedResourceShortcut,
      })
    )
    const reloadItem = submenu(template, 'View').find((item) => item.accelerator === 'CmdOrCtrl+R')
    const focusedWindow = new BrowserWindow()
    const click = reloadItem?.click as unknown as (
      menuItem: unknown,
      browserWindow: BrowserWindow
    ) => void

    click({}, focusedWindow)

    expect(handleFocusedResourceShortcut).toHaveBeenCalledWith(focusedWindow, 'reload-or-clear')
    expect(focusedWindow.webContents.reload).not.toHaveBeenCalled()

    handleFocusedResourceShortcut.mockReturnValue(false)
    click({}, focusedWindow)
    expect(focusedWindow.webContents.reload).toHaveBeenCalledOnce()
  })

  it('routes zoom accelerators to the focused resource before changing Sim zoom', () => {
    const handleFocusedResourceShortcut = vi.fn(() => true)
    const deps = Object.assign(makeDeps(), { handleFocusedResourceShortcut })
    const template = buildMenuTemplate(deps)
    const focusedWindow = new BrowserWindow()
    const view = submenu(template, 'View')
    const commands = [
      { accelerator: 'CmdOrCtrl+Plus', action: 'in' },
      { accelerator: 'CmdOrCtrl+-', action: 'out' },
      { accelerator: 'CmdOrCtrl+0', action: 'reset' },
    ] as const

    for (const command of commands) {
      const item = view.find((entry) => entry.accelerator === command.accelerator)
      ;(item?.click as unknown as (menuItem: unknown, browserWindow: BrowserWindow) => void)(
        {},
        focusedWindow
      )
      expect(handleFocusedResourceShortcut).toHaveBeenLastCalledWith(
        focusedWindow,
        `zoom-${command.action}`
      )
    }
    expect(focusedWindow.webContents.setZoomLevel).not.toHaveBeenCalled()

    handleFocusedResourceShortcut.mockReturnValue(false)
    const actualSize = view.find((entry) => entry.accelerator === 'CmdOrCtrl+0')
    ;(actualSize?.click as unknown as (menuItem: unknown, browserWindow: BrowserWindow) => void)(
      {},
      focusedWindow
    )
    expect(focusedWindow.webContents.setZoomLevel).toHaveBeenCalledWith(0)
    expect(deps.config.set).toHaveBeenCalledWith('zoomLevel', 0)
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
