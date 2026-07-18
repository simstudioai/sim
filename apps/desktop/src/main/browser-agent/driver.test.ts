import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

type DriverModule = typeof import('@/main/browser-agent/driver')

async function freshDriver(): Promise<DriverModule> {
  vi.resetModules()
  return await import('@/main/browser-agent/driver')
}

describe('parseKeyCombo', () => {
  let driver: DriverModule

  beforeEach(async () => {
    driver = await freshDriver()
  })

  it('parses named keys, letters, and modifier combos', () => {
    expect(driver.parseKeyCombo('Enter')).toMatchObject({ key: 'Enter', keyCode: 13 })
    expect(driver.parseKeyCombo('esc')).toMatchObject({ key: 'Escape', keyCode: 27 })
    expect(driver.parseKeyCombo('a')).toMatchObject({ key: 'a', code: 'KeyA' })
    expect(driver.parseKeyCombo('Control+A')).toMatchObject({ key: 'a', ctrl: true })
    expect(driver.parseKeyCombo('Shift+a')).toMatchObject({ key: 'A', shift: true })
    expect(driver.parseKeyCombo('Cmd+Shift+Z')).toMatchObject({
      key: 'Z',
      meta: true,
      shift: true,
    })
    expect(driver.parseKeyCombo('5')).toMatchObject({ key: '5', code: 'Digit5' })
  })

  it('rejects unknown keys and modifiers', () => {
    expect(() => driver.parseKeyCombo('Hyper+X')).toThrow(/Unrecognized modifier/)
    expect(() => driver.parseKeyCombo('NotAKey')).toThrow(/Unrecognized key/)
  })
})

describe('buildKeyDispatchPlan', () => {
  let driver: DriverModule

  beforeEach(async () => {
    driver = await freshDriver()
  })

  it('carries text for printable keys so Blink inserts the character', () => {
    const [down, up] = driver.buildKeyDispatchPlan(driver.parseKeyCombo('a'), 'linux')
    expect(down).toMatchObject({ type: 'keyDown', text: 'a', key: 'a', modifiers: 0 })
    expect(up).toMatchObject({ type: 'keyUp', key: 'a' })
  })

  it('sends Enter with a carriage return so defaults fire (form submit)', () => {
    const [down] = driver.buildKeyDispatchPlan(driver.parseKeyCombo('Enter'), 'linux')
    expect(down).toMatchObject({ type: 'keyDown', text: '\r', windowsVirtualKeyCode: 13 })
  })

  it('sends editing keys as rawKeyDown without text', () => {
    const [down] = driver.buildKeyDispatchPlan(driver.parseKeyCombo('Backspace'), 'linux')
    expect(down.type).toBe('rawKeyDown')
    expect(down.text).toBeUndefined()
  })

  it('maps Cmd shortcuts to Blink editing commands on macOS only', () => {
    const combo = driver.parseKeyCombo('Cmd+A')
    const [macDown] = driver.buildKeyDispatchPlan(combo, 'darwin')
    expect(macDown.commands).toEqual(['selectAll'])
    expect(macDown.modifiers).toBe(4)
    const [linuxDown] = driver.buildKeyDispatchPlan(combo, 'linux')
    expect(linuxDown.commands).toBeUndefined()
  })

  it('treats Control shortcuts as Cmd on macOS (the model does not know the host OS)', () => {
    const combo = driver.parseKeyCombo('Control+A')
    const [macDown] = driver.buildKeyDispatchPlan(combo, 'darwin')
    expect(macDown.commands).toEqual(['selectAll'])
    expect(macDown.modifiers).toBe(4) // ctrl normalized away, meta set
    // On Linux/Windows Ctrl+A is Blink-native; no rewrite.
    const [linuxDown] = driver.buildKeyDispatchPlan(combo, 'linux')
    expect(linuxDown.modifiers).toBe(2)
    expect(linuxDown.commands).toBeUndefined()
  })

  it('does not rewrite non-editing Control combos on macOS', () => {
    const [down] = driver.buildKeyDispatchPlan(driver.parseKeyCombo('Control+K'), 'darwin')
    expect(down.modifiers).toBe(2)
    expect(down.commands).toBeUndefined()
  })

  it('maps Cmd+Shift+Z to redo and Cmd+Z to undo on macOS', () => {
    const [redo] = driver.buildKeyDispatchPlan(driver.parseKeyCombo('Cmd+Shift+Z'), 'darwin')
    expect(redo.commands).toEqual(['redo'])
    const [undo] = driver.buildKeyDispatchPlan(driver.parseKeyCombo('Cmd+Z'), 'darwin')
    expect(undo.commands).toEqual(['undo'])
  })

  it('encodes the CDP modifier bitmask (Alt=1 Ctrl=2 Meta=4 Shift=8)', () => {
    const [down] = driver.buildKeyDispatchPlan(driver.parseKeyCombo('Control+Shift+K'), 'linux')
    expect(down.modifiers).toBe(2 | 8)
    // Modified letters must not carry text — they are shortcuts, not typing.
    expect(down.type).toBe('rawKeyDown')
    expect(down.text).toBeUndefined()
  })
})

describe('executeTool', () => {
  let driver: DriverModule

  beforeEach(async () => {
    driver = await freshDriver()
  })

  it('returns ok:false instead of throwing for tool-level failures', async () => {
    // No session exists, so any page-dependent tool fails with guidance.
    const result = await driver.executeTool('browser_click', { elementId: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/No page is open yet/)
  })

  it('validates navigation URLs before touching the session', async () => {
    const result = await driver.executeTool('browser_navigate', { url: 'file:///etc/passwd' })
    expect(result).toEqual({
      ok: false,
      error: 'URL must be absolute and start with http:// or https://',
    })
  })

  it('reports missing required parameters by name', async () => {
    const result = await driver.executeTool('browser_navigate', {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Missing required parameter "url"/)
  })

  it('serializes tool calls: a queued failure never rejects the next call', async () => {
    const first = await driver.executeTool('browser_snapshot', {})
    expect(first.ok).toBe(false)
    const second = await driver.executeTool('browser_list_tabs', {})
    // list_tabs works without a session (empty list).
    expect(second.ok).toBe(true)
    expect(second.result).toMatchObject({ tabs: [] })
  })
})
