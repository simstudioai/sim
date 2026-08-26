import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, type MenuItemConstructorOptions } from 'electron'
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
      'Server…',
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
    const file = submenu(template, 'File')
    expect(
      file.filter((item) => item.visible !== false).map((item) => item.label ?? item.type)
    ).toEqual(['New Window', 'New Chat', 'separator', 'Close Window'])
    // Resource-scoped shortcuts stay registered but never appear in the menu.
    expect(file.filter((item) => item.visible === false).map((item) => item.label)).toEqual([
      'New Tab',
      'Reopen Closed Tab',
      'Focus Address Bar',
      'Next Tab',
      'Previous Tab',
      'Tab 1',
      'Tab 2',
      'Tab 3',
      'Tab 4',
      'Tab 5',
      'Tab 6',
      'Tab 7',
      'Tab 8',
      'Last Tab',
      'Close Tab',
    ])
    expect(submenu(template, 'View').map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'Search',
      'Toggle Sidebar',
      'separator',
      'Back',
      'Reload',
      'Force Reload',
      'separator',
      'Actual Size',
      'Zoom In',
      'Zoom Out',
      'separator',
      'togglefullscreen',
    ])
  })

  it('keeps Help limited to documentation and Sim status', () => {
    const help = submenu(buildMenuTemplate(makeDeps()), 'Help')
    expect(help.map((item) => item.label)).toEqual(['Sim Documentation', 'Sim Status'])
  })

  // status.sim.ai reports on Sim's deployments only, so it is worse than
  // useless to an operator whose own server is the one that is down.
  it('drops Sim status for a self-hosted server', () => {
    const help = submenu(buildMenuTemplate(makeDeps('https://sim.example.com')), 'Help')
    expect(help.map((item) => item.label)).toEqual(['Sim Documentation'])
  })

  it('never exposes developer tools in the application menu', () => {
    const view = submenu(buildMenuTemplate(makeDeps()), 'View')
    expect(view.some((item) => item.role === 'toggleDevTools')).toBe(false)
  })

  it('reserves the close-tab accelerator for resources and never closes the window', () => {
    const handleFocusedResourceShortcut = vi.fn(() => true)
    const deps = Object.assign(makeDeps(), { handleFocusedResourceShortcut })
    const closeItem = submenu(buildMenuTemplate(deps), 'File').find(
      (item) => item.accelerator === 'CmdOrCtrl+W'
    )
    const focusedWindow = new BrowserWindow()

    expect(closeItem).toMatchObject({ label: 'Close Tab', accelerator: 'CmdOrCtrl+W' })
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
    expect(focusedWindow.close).not.toHaveBeenCalled()
  })

  it('always offers a separate close-window accelerator', () => {
    const deps = makeDeps()
    const closeWindow = submenu(buildMenuTemplate(deps), 'File').find(
      (item) => item.accelerator === 'CmdOrCtrl+Shift+W'
    )
    const focusedWindow = new BrowserWindow()

    ;(closeWindow?.click as unknown as (menuItem: unknown, browserWindow: BrowserWindow) => void)(
      {},
      focusedWindow
    )

    expect(closeWindow?.label).toBe('Close Window')
    expect(focusedWindow.close).toHaveBeenCalledOnce()
    expect(deps.handleFocusedResourceShortcut).not.toHaveBeenCalled()
  })

  it('routes next, previous, and numbered tab accelerators to the focused resource', () => {
    const handleFocusedResourceShortcut = vi.fn(() => true)
    const template = buildMenuTemplate(
      Object.assign(makeDeps(), {
        handleFocusedResourceShortcut,
      })
    )
    const file = submenu(template, 'File')
    const focusedWindow = new BrowserWindow()
    const invoke = (item: MenuItemConstructorOptions | undefined) =>
      (item?.click as unknown as (menuItem: unknown, browserWindow: BrowserWindow) => void)(
        {},
        focusedWindow
      )

    invoke(file.find((item) => item.accelerator === 'Ctrl+Tab'))
    invoke(file.find((item) => item.accelerator === 'Ctrl+Shift+Tab'))
    invoke(file.find((item) => item.accelerator === 'CmdOrCtrl+9'))

    expect(handleFocusedResourceShortcut).toHaveBeenNthCalledWith(1, focusedWindow, 'next-tab')
    expect(handleFocusedResourceShortcut).toHaveBeenNthCalledWith(2, focusedWindow, 'previous-tab')
    expect(handleFocusedResourceShortcut).toHaveBeenNthCalledWith(3, focusedWindow, 'select-tab-9')
  })

  it('routes new, reopen, and address-bar accelerators through the active resource', () => {
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
    const addressItem = submenu(template, 'File').find((item) => item.accelerator === 'CmdOrCtrl+L')

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
    ;(addressItem?.click as unknown as (menuItem: unknown, browserWindow: BrowserWindow) => void)(
      {},
      focusedWindow
    )
    expect(handleFocusedResourceShortcut).toHaveBeenNthCalledWith(1, focusedWindow, 'new-tab')
    expect(handleFocusedResourceShortcut).toHaveBeenNthCalledWith(
      2,
      focusedWindow,
      'reopen-closed-tab'
    )
    expect(handleFocusedResourceShortcut).toHaveBeenNthCalledWith(3, focusedWindow, 'focus-omnibox')
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

  it('opens the search palette from View with the platform Mod+K accelerator', () => {
    const deps = makeDeps()
    const item = submenu(buildMenuTemplate(deps), 'View').find(
      (entry) => entry.accelerator === 'CmdOrCtrl+K'
    )

    expect(item).toMatchObject({ label: 'Search' })
    ;(item?.click as unknown as () => void)()
    expect(deps.openSearch).toHaveBeenCalledOnce()
    expect(deps.handleFocusedResourceShortcut).not.toHaveBeenCalled()
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
