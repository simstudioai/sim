import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

// Same module instance the vi.mock factory returns, with mock-typed statics.
import { BrowserWindow } from '@/test/electron-mock'
import {
  clampLauncherHeight,
  createLauncherWindow,
  LAUNCHER_MAX_HEIGHT,
  LAUNCHER_MIN_HEIGHT,
  LAUNCHER_WIDTH,
  launcherBoundsFor,
  type LauncherWindowDeps,
} from '@/main/launcher-window'

type MockWindow = InstanceType<typeof BrowserWindow>

function makeDeps(): LauncherWindowDeps {
  return {
    appOrigin: () => 'https://sim.ai',
    partition: () => 'persist:sim',
    preloadPath: '/app/preload.cjs',
    isPackaged: true,
    themeBackground: () => 'dark',
    openMainWindow: vi.fn(),
    events: { filePath: '/tmp/events.log', record: vi.fn() },
  }
}

function handlerOf(win: MockWindow, source: 'window' | 'webContents', event: string) {
  const calls = source === 'window' ? win.on.mock.calls : win.webContents.on.mock.calls
  const entry = calls.find(([name]: unknown[]) => name === event)
  return entry?.[1] as ((...args: unknown[]) => void) | undefined
}

describe('launcherBoundsFor', () => {
  const workArea = { x: 0, y: 25, width: 1728, height: 1092 }

  it('centers horizontally and sits a quarter down the work area', () => {
    const bounds = launcherBoundsFor(workArea, LAUNCHER_MIN_HEIGHT)
    expect(bounds.x).toBe(Math.round((1728 - LAUNCHER_WIDTH) / 2))
    expect(bounds.y).toBe(Math.round(25 + 1092 * 0.25))
    expect(bounds.width).toBe(LAUNCHER_WIDTH)
    expect(bounds.height).toBe(LAUNCHER_MIN_HEIGHT)
  })

  it('clamps the height into the panel range', () => {
    expect(clampLauncherHeight(10)).toBe(LAUNCHER_MIN_HEIGHT)
    expect(clampLauncherHeight(10_000)).toBe(LAUNCHER_MAX_HEIGHT)
    expect(clampLauncherHeight(Number.NaN)).toBe(LAUNCHER_MIN_HEIGHT)
    expect(clampLauncherHeight(300.6)).toBe(301)
  })
})

describe('createLauncherWindow', () => {
  beforeEach(() => {
    BrowserWindow.instances.length = 0
    BrowserWindow.lastOptions = undefined
  })

  it('creates a non-activating panel over all workspaces and loads the launcher route', () => {
    const deps = makeDeps()
    const launcher = createLauncherWindow(deps)
    launcher.toggle()

    expect(BrowserWindow.instances).toHaveLength(1)
    const win = BrowserWindow.instances[0]
    expect(BrowserWindow.lastOptions).toMatchObject({
      type: 'panel',
      frame: false,
      resizable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      show: false,
    })
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(win.webContents.loadURL).toHaveBeenCalledWith('https://sim.ai/desktop/launcher')
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.webContents.send).toHaveBeenCalledWith('launcher:shown')
  })

  it('toggle hides a visible panel and re-shows a hidden one without recreating', () => {
    const launcher = createLauncherWindow(makeDeps())
    launcher.toggle()
    const win = BrowserWindow.instances[0]

    win.isVisible.mockReturnValue(true)
    launcher.toggle()
    expect(win.hide).toHaveBeenCalledTimes(1)

    win.isVisible.mockReturnValue(false)
    launcher.toggle()
    expect(BrowserWindow.instances).toHaveLength(1)
    expect(win.show).toHaveBeenCalledTimes(2)
  })

  it('hides on blur unless DevTools has focus', () => {
    const launcher = createLauncherWindow(makeDeps())
    launcher.toggle()
    const win = BrowserWindow.instances[0]
    const onBlur = handlerOf(win, 'window', 'blur')

    win.webContents.isDevToolsOpened.mockReturnValue(true)
    onBlur?.()
    expect(win.hide).not.toHaveBeenCalled()

    win.webContents.isDevToolsOpened.mockReturnValue(false)
    onBlur?.()
    expect(win.hide).toHaveBeenCalledTimes(1)
  })

  it('falls back to the main window when the route returns an HTTP error', () => {
    const deps = makeDeps()
    const launcher = createLauncherWindow(deps)
    launcher.toggle()
    const win = BrowserWindow.instances[0]
    win.isVisible.mockReturnValue(true)

    const onNavigate = handlerOf(win, 'webContents', 'did-navigate')
    onNavigate?.({}, 'https://sim.ai/desktop/launcher', 404)

    expect(win.hide).toHaveBeenCalledTimes(1)
    expect(deps.openMainWindow).toHaveBeenCalledTimes(1)
    expect(deps.events.record).toHaveBeenCalledWith('launcher_load_failed', {
      code: 404,
      reason: 'http',
    })
  })

  it('retries the load on the next summon after a failure', () => {
    const launcher = createLauncherWindow(makeDeps())
    launcher.toggle()
    const win = BrowserWindow.instances[0]
    win.isVisible.mockReturnValue(true)
    handlerOf(win, 'webContents', 'did-navigate')?.({}, 'https://sim.ai/desktop/launcher', 404)

    win.isVisible.mockReturnValue(false)
    launcher.toggle()
    expect(win.webContents.loadURL).toHaveBeenCalledTimes(2)
  })

  it('resize clamps into the panel range and keeps position', () => {
    const launcher = createLauncherWindow(makeDeps())
    launcher.toggle()
    const win = BrowserWindow.instances[0]
    launcher.resize(10_000)
    expect(win.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ height: LAUNCHER_MAX_HEIGHT, width: LAUNCHER_WIDTH })
    )
  })

  it('destroy tears down and the next toggle recreates', () => {
    const launcher = createLauncherWindow(makeDeps())
    launcher.toggle()
    const first = BrowserWindow.instances[0]
    launcher.destroy()
    expect(first.destroy).toHaveBeenCalledTimes(1)
    launcher.toggle()
    expect(BrowserWindow.instances).toHaveLength(2)
  })
})
