import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

type DriverModule = typeof import('@/main/browser-agent/driver')

async function freshDriver(): Promise<DriverModule> {
  vi.resetModules()
  return await import('@/main/browser-agent/driver')
}

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
