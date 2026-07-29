import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { buildKeyDispatchPlan, parseKeyCombo } from '@/main/browser-agent/keyboard'

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
  })

  it('rejects unknown keys and modifiers', () => {
    expect(() => parseKeyCombo('Hyper+X')).toThrow(/Unrecognized modifier/)
    expect(() => parseKeyCombo('NotAKey')).toThrow(/Unrecognized key/)
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
})
