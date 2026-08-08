import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { WebContentsView } from 'electron'
import {
  buildKeyDispatchPlan,
  dispatchKeyCombo,
  KeyDispatchError,
  parseKeyCombo,
} from '@/main/browser-agent/keyboard'

describe('parseKeyCombo', () => {
  it('parses named keys, letters, and modifier combos', () => {
    expect(parseKeyCombo('Enter')).toMatchObject({ key: 'Enter', keyCode: 13 })
    expect(parseKeyCombo('esc')).toMatchObject({ key: 'Escape', keyCode: 27 })
    expect(parseKeyCombo('a')).toMatchObject({ key: 'a', code: 'KeyA' })
    expect(parseKeyCombo('Control+A')).toMatchObject({ key: 'a', ctrl: true })
    expect(parseKeyCombo('Shift+a')).toMatchObject({ key: 'A', shift: true })
    expect(parseKeyCombo('Cmd+Shift+Z')).toMatchObject({
      key: 'Z',
      meta: true,
      shift: true,
    })
    expect(parseKeyCombo('5')).toMatchObject({ key: '5', code: 'Digit5' })
    expect(parseKeyCombo('Cmd+,')).toMatchObject({
      key: ',',
      code: 'Comma',
      keyCode: 188,
      meta: true,
    })
    expect(parseKeyCombo('Mod+K', 'darwin')).toMatchObject({ meta: true, ctrl: false })
    expect(parseKeyCombo('Mod+K', 'linux')).toMatchObject({ meta: false, ctrl: true })
    expect(parseKeyCombo('ControlOrMeta+K', 'darwin')).toMatchObject({ meta: true })
  })

  it('rejects unknown keys and modifiers', () => {
    expect(() => parseKeyCombo('Hyper+X')).toThrow(/Unrecognized modifier/)
    expect(() => parseKeyCombo('NotAKey')).toThrow(/Unrecognized key/)
  })

  it('maps shifted digits and punctuation to their physical Chromium descriptors', () => {
    expect(parseKeyCombo('Shift+1')).toMatchObject({
      key: '!',
      code: 'Digit1',
      keyCode: 49,
      shift: true,
    })
    expect(parseKeyCombo('Shift+,')).toMatchObject({
      key: '<',
      code: 'Comma',
      keyCode: 188,
      shift: true,
    })
    expect(parseKeyCombo('?')).toMatchObject({
      key: '?',
      code: 'Slash',
      keyCode: 191,
      shift: true,
    })
    expect(parseKeyCombo('+')).toMatchObject({ key: '+', code: 'Equal', keyCode: 187, shift: true })
    expect(parseKeyCombo('Control++')).toMatchObject({
      key: '+',
      code: 'Equal',
      ctrl: true,
      shift: true,
    })
  })
})

describe('buildKeyDispatchPlan', () => {
  it('carries text for printable keys so Blink inserts the character', () => {
    const [down, up] = buildKeyDispatchPlan(parseKeyCombo('a'), 'linux')
    expect(down).toMatchObject({ type: 'keyDown', text: 'a', key: 'a', modifiers: 0 })
    expect(up).toMatchObject({ type: 'keyUp', key: 'a' })
  })

  it('sends Enter with a carriage return so defaults fire (form submit)', () => {
    const [down] = buildKeyDispatchPlan(parseKeyCombo('Enter'), 'linux')
    expect(down).toMatchObject({ type: 'keyDown', text: '\r', windowsVirtualKeyCode: 13 })
  })

  it('sends editing keys as rawKeyDown without text', () => {
    const [down] = buildKeyDispatchPlan(parseKeyCombo('Backspace'), 'linux')
    expect(down.type).toBe('rawKeyDown')
    expect(down.text).toBeUndefined()
  })

  it('maps Cmd shortcuts to Blink editing commands on macOS only', () => {
    const combo = parseKeyCombo('Cmd+A')
    const [macDown] = buildKeyDispatchPlan(combo, 'darwin')
    expect(macDown.commands).toEqual(['selectAll'])
    expect(macDown.modifiers).toBe(4)
    const [linuxDown] = buildKeyDispatchPlan(combo, 'linux')
    expect(linuxDown.commands).toBeUndefined()
  })

  it('treats Control shortcuts as Cmd on macOS (the model does not know the host OS)', () => {
    const combo = parseKeyCombo('Control+A')
    const [macDown] = buildKeyDispatchPlan(combo, 'darwin')
    expect(macDown.commands).toEqual(['selectAll'])
    expect(macDown.modifiers).toBe(4) // ctrl normalized away, meta set
    // On Linux/Windows Ctrl+A is Blink-native; no rewrite.
    const [linuxDown] = buildKeyDispatchPlan(combo, 'linux')
    expect(linuxDown.modifiers).toBe(2)
    expect(linuxDown.commands).toBeUndefined()
  })

  it('does not rewrite non-editing Control combos on macOS', () => {
    const [down] = buildKeyDispatchPlan(parseKeyCombo('Control+K'), 'darwin')
    expect(down.modifiers).toBe(2)
    expect(down.commands).toBeUndefined()
  })

  it('uses the Chromium punctuation descriptor for Cmd+,', () => {
    const [down, up] = buildKeyDispatchPlan(parseKeyCombo('Cmd+,'), 'darwin')

    expect(down).toMatchObject({
      type: 'rawKeyDown',
      key: ',',
      code: 'Comma',
      windowsVirtualKeyCode: 188,
      modifiers: 4,
    })
    expect(down).not.toHaveProperty('nativeVirtualKeyCode')
    expect(up).not.toHaveProperty('nativeVirtualKeyCode')
  })

  it('maps Cmd+Shift+Z to redo and Cmd+Z to undo on macOS', () => {
    const [redo] = buildKeyDispatchPlan(parseKeyCombo('Cmd+Shift+Z'), 'darwin')
    expect(redo.commands).toEqual(['redo'])
    const [undo] = buildKeyDispatchPlan(parseKeyCombo('Cmd+Z'), 'darwin')
    expect(undo.commands).toEqual(['undo'])
  })

  it('encodes the CDP modifier bitmask (Alt=1 Ctrl=2 Meta=4 Shift=8)', () => {
    const [down] = buildKeyDispatchPlan(parseKeyCombo('Control+Shift+K'), 'linux')
    expect(down.modifiers).toBe(2 | 8)
    // Modified letters must not carry text — they are shortcuts, not typing.
    expect(down.type).toBe('rawKeyDown')
    expect(down.text).toBeUndefined()
  })

  it('sends the shifted character as text and keeps Alt-printable combos non-textual', () => {
    const [shifted] = buildKeyDispatchPlan(parseKeyCombo('Shift+1'), 'linux')
    expect(shifted).toMatchObject({ key: '!', code: 'Digit1', text: '!', modifiers: 8 })

    const [alt] = buildKeyDispatchPlan(parseKeyCombo('Alt+a'), 'linux')
    expect(alt).toMatchObject({ type: 'rawKeyDown', key: 'a', modifiers: 1 })
    expect(alt.text).toBeUndefined()
  })
})

describe('dispatchKeyCombo', () => {
  it('keeps agent-issued modifier shortcuts out of the Electron application menu', async () => {
    const contents = new WebContentsView().webContents

    await dispatchKeyCombo(contents, parseKeyCombo('Cmd+A'))

    expect(contents.setIgnoreMenuShortcuts).toHaveBeenNthCalledWith(1, true)
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenNthCalledWith(2, false)
    expect(contents.debugger.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'rawKeyDown', key: 'a' })
    )
  })

  it('restores application-menu shortcuts when CDP dispatch fails', async () => {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.debugger.sendCommand).mockRejectedValueOnce(new Error('CDP unavailable'))

    await expect(dispatchKeyCombo(contents, parseKeyCombo('Cmd+A'))).rejects.toThrow(
      'CDP unavailable'
    )

    expect(contents.setIgnoreMenuShortcuts).toHaveBeenNthCalledWith(1, true)
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenNthCalledWith(2, false)
  })

  it('best-effort releases a key and reports a partial dispatch when key-up fails', async () => {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.debugger.sendCommand)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('key-up response lost'))
      .mockRejectedValueOnce(new Error('cleanup unavailable'))

    const dispatch = dispatchKeyCombo(contents, parseKeyCombo('Cmd+A'))

    await expect(dispatch).rejects.toEqual(
      expect.objectContaining({
        name: KeyDispatchError.name,
        message: 'key-up response lost',
        keyDownDispatched: true,
      })
    )

    const keyEvents = vi
      .mocked(contents.debugger.sendCommand)
      .mock.calls.filter(([method]) => method === 'Input.dispatchKeyEvent')
    expect(keyEvents).toHaveLength(3)
    expect(keyEvents[1]).toEqual(keyEvents[2])
    expect(keyEvents[1]).toEqual([
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyUp', key: 'a' }),
    ])
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenNthCalledWith(1, true)
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenNthCalledWith(2, false)
  })

  it('treats a rejected key-down acknowledgement as ambiguous and releases it', async () => {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.debugger.sendCommand)
      .mockRejectedValueOnce(new Error('key-down response lost'))
      .mockResolvedValueOnce({})

    await expect(dispatchKeyCombo(contents, parseKeyCombo('Enter'))).rejects.toMatchObject({
      name: KeyDispatchError.name,
      message: 'key-down response lost',
      keyDownDispatched: true,
    })

    const keyEvents = vi.mocked(contents.debugger.sendCommand).mock.calls
    expect(keyEvents).toHaveLength(2)
    expect(keyEvents[1]).toEqual([
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyUp', key: 'Enter' }),
    ])
  })

  it('does not turn menu-restoration cleanup failure into a duplicate key retry signal', async () => {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.setIgnoreMenuShortcuts).mockImplementation((ignored: boolean) => {
      if (!ignored) throw new Error('menu cleanup failed')
    })

    await expect(dispatchKeyCombo(contents, parseKeyCombo('Cmd+A'))).resolves.toBeUndefined()
    expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(2)
  })

  it('keeps the application menu isolated until overlapping dispatches finish', async () => {
    const contents = new WebContentsView().webContents
    let releaseFirstDown: (() => void) | undefined
    vi.mocked(contents.debugger.sendCommand).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirstDown = () => resolve({})
        })
    )

    const first = dispatchKeyCombo(contents, parseKeyCombo('Cmd+A'))
    await Promise.resolve()
    const second = dispatchKeyCombo(contents, parseKeyCombo('Cmd+Z'))
    await second

    expect(contents.setIgnoreMenuShortcuts).toHaveBeenCalledTimes(1)
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenCalledWith(true)

    releaseFirstDown?.()
    await first

    expect(contents.setIgnoreMenuShortcuts).toHaveBeenNthCalledWith(2, false)
  })

  it('does not change application-menu handling for ordinary page keys', async () => {
    const contents = new WebContentsView().webContents

    await dispatchKeyCombo(contents, parseKeyCombo('Enter'))

    expect(contents.setIgnoreMenuShortcuts).not.toHaveBeenCalled()
  })
})
