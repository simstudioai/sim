import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { globalShortcut } from 'electron'
import {
  createLauncherShortcutManager,
  DEFAULT_LAUNCHER_SHORTCUT,
  LAUNCHER_SHORTCUT_DISABLED,
  LAUNCHER_SHORTCUT_PRESETS,
  normalizeLauncherShortcut,
} from '@/main/shortcuts'

describe('normalizeLauncherShortcut', () => {
  it('accepts every preset unchanged', () => {
    for (const preset of LAUNCHER_SHORTCUT_PRESETS) {
      expect(normalizeLauncherShortcut(preset)).toBe(preset)
    }
  })

  it('falls back to the default for unknown or malformed values', () => {
    expect(normalizeLauncherShortcut(undefined)).toBe(DEFAULT_LAUNCHER_SHORTCUT)
    expect(normalizeLauncherShortcut('')).toBe(DEFAULT_LAUNCHER_SHORTCUT)
    expect(normalizeLauncherShortcut('MediaPlayPause')).toBe(DEFAULT_LAUNCHER_SHORTCUT)
    expect(normalizeLauncherShortcut('Cmd+Shift+P')).toBe(DEFAULT_LAUNCHER_SHORTCUT)
  })
})

describe('createLauncherShortcutManager', () => {
  beforeEach(() => {
    vi.mocked(globalShortcut.register).mockClear().mockReturnValue(true)
    vi.mocked(globalShortcut.unregister).mockClear()
  })

  it('registers the default shortcut and reports success', () => {
    const onActivate = vi.fn()
    const manager = createLauncherShortcutManager(onActivate)
    expect(manager.apply(undefined)).toBe('registered')
    expect(manager.current()).toBe(DEFAULT_LAUNCHER_SHORTCUT)
    expect(globalShortcut.register).toHaveBeenCalledWith(DEFAULT_LAUNCHER_SHORTCUT, onActivate)
  })

  it('reports failure when another app owns the accelerator', () => {
    vi.mocked(globalShortcut.register).mockReturnValue(false)
    const manager = createLauncherShortcutManager(vi.fn())
    expect(manager.apply('Alt+Space')).toBe('failed')
    expect(manager.status()).toBe('failed')
  })

  it('releases the previous registration when rebinding', () => {
    const manager = createLauncherShortcutManager(vi.fn())
    manager.apply('Alt+Space')
    manager.apply('Control+Space')
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Alt+Space')
    expect(manager.current()).toBe('Control+Space')
  })

  it('does not unregister a shortcut it never held', () => {
    vi.mocked(globalShortcut.register).mockReturnValue(false)
    const manager = createLauncherShortcutManager(vi.fn())
    manager.apply('Alt+Space')
    manager.apply('Control+Space')
    expect(globalShortcut.unregister).not.toHaveBeenCalled()
  })

  it('supports disabling and re-enabling', () => {
    const manager = createLauncherShortcutManager(vi.fn())
    manager.apply('Alt+Space')
    expect(manager.apply(LAUNCHER_SHORTCUT_DISABLED)).toBe('disabled')
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Alt+Space')
    expect(manager.apply('Alt+Space')).toBe('registered')
  })

  it('dispose releases the registration', () => {
    const manager = createLauncherShortcutManager(vi.fn())
    manager.apply('Alt+Space')
    manager.dispose()
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Alt+Space')
    expect(manager.status()).toBe('disabled')
  })
})
