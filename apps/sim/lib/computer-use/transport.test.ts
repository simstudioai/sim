/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => ({
    computerUse: { getStatus: mocks.status, executeTool: mocks.execute },
  }),
}))

import { executeComputerUseTool } from '@/lib/computer-use/transport'

describe('computer transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({ supported: true, enabled: true })
    mocks.execute.mockResolvedValue({ kind: 'apps', apps: [] })
  })
  it('does not dispatch when Stop happens during the asynchronous device status lookup', async () => {
    const controller = new AbortController()
    let resolveStatus: ((value: { supported: boolean; enabled: boolean }) => void) | undefined
    mocks.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve
        })
    )
    const result = executeComputerUseTool('call', { action: 'list_apps' }, controller.signal)
    controller.abort()
    resolveStatus?.({ supported: true, enabled: true })
    await expect(result).rejects.toThrow()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it.each([
    { supported: false, enabled: true },
    { supported: true, enabled: false },
  ])('refuses unavailable device state %j', async (status) => {
    mocks.status.mockResolvedValue(status)
    await expect(executeComputerUseTool('call', { action: 'list_apps' })).rejects.toThrow(
      'Enable Computer Use'
    )
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('validates native results at the renderer boundary', async () => {
    mocks.execute.mockResolvedValue({
      kind: 'action',
      action: 'click',
      bundleId: 'com.apple.Notes',
      dispatched: true,
    })
    await expect(executeComputerUseTool('call', { action: 'list_apps' })).rejects.toThrow()
  })
})
