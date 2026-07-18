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
