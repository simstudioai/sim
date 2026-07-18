import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { ipcMain, shell } from 'electron'
import { createConfigStore } from '@/main/config'
import { type IpcDeps, registerIpcHandlers } from '@/main/ipc'
import { LocalFilesystemService } from '@/main/local-filesystem'

const APP = 'https://sim.ai'

type Handler = (event: { senderFrame: { url: string } | null }, ...args: unknown[]) => unknown

function collectHandlers() {
  const invoke = new Map<string, Handler>()
  const on = new Map<string, Handler>()
  for (const [channel, handler] of vi.mocked(ipcMain.handle).mock.calls) {
    invoke.set(channel as string, handler as Handler)
  }
  for (const [channel, handler] of vi.mocked(ipcMain.on).mock.calls) {
    on.set(channel as string, handler as Handler)
  }
  return { invoke, on }
}

const fileEvent = { senderFrame: { url: 'file:///app/static/settings.html' } }
const appEvent = { senderFrame: { url: `${APP}/workspace/ws1` } }
const evilEvent = { senderFrame: { url: 'https://evil.example/page' } }

describe('registerIpcHandlers', () => {
  let deps: IpcDeps

  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear()
    vi.mocked(ipcMain.on).mockClear()
    vi.mocked(shell.openExternal).mockClear()
    deps = {
      config: createConfigStore(join(mkdtempSync(join(tmpdir(), 'sim-ipc-')), 's.json'), {}),
      appOrigin: () => APP,
      allowHttpLocalhost: () => false,
      retryLoad: vi.fn(),
      openSettings: vi.fn(),
      closeSettings: vi.fn(),
      applyOrigin: vi.fn(async () => ({ ok: true as const, origin: 'https://sim.ai' })),
      localFilesystem: new LocalFilesystemService({
        chooseDirectory: vi.fn(async () => null),
      }),
    }
    registerIpcHandlers(deps)
  })

  it('validates open-external URLs regardless of sender', async () => {
    const { invoke } = collectHandlers()
    expect(await invoke.get('desktop:open-external')?.(evilEvent, 'https://docs.sim.ai')).toBe(true)
    expect(await invoke.get('desktop:open-external')?.(appEvent, 'javascript:alert(1)')).toBe(false)
    expect(await invoke.get('desktop:open-external')?.(appEvent, 42)).toBe(false)
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('restricts microphone consent to the app origin', async () => {
    const { invoke } = collectHandlers()
    expect(await invoke.get('desktop:request-mic-permission')?.(evilEvent)).toBe(false)
    expect(await invoke.get('desktop:request-mic-permission')?.(fileEvent)).toBe(false)
    expect(await invoke.get('desktop:request-mic-permission')?.(appEvent)).toBe(true)
  })

  it('restricts local filesystem access to the app origin', async () => {
    const { invoke } = collectHandlers()
    expect(
      await invoke.get('desktop:local-filesystem')?.(evilEvent, { operation: 'list_mounts' })
    ).toMatchObject({ ok: false, code: 'ACCESS_DENIED' })
    expect(
      await invoke.get('desktop:local-filesystem')?.(appEvent, { operation: 'list_mounts' })
    ).toEqual({ ok: true, data: { mounts: [] } })
  })

  it('restricts shell-control channels to bundled local pages', async () => {
    const { invoke, on } = collectHandlers()

    on.get('offline:retry')?.(appEvent)
    expect(deps.retryLoad).not.toHaveBeenCalled()
    on.get('offline:retry')?.(fileEvent)
    expect(deps.retryLoad).toHaveBeenCalledTimes(1)

    on.get('settings:open')?.(evilEvent)
    expect(deps.openSettings).not.toHaveBeenCalled()
    on.get('settings:open')?.(fileEvent)
    expect(deps.openSettings).toHaveBeenCalledTimes(1)

    expect(await invoke.get('settings:get')?.(appEvent)).toBeNull()
    expect(await invoke.get('settings:get')?.(fileEvent)).toEqual({
      origin: 'https://sim.ai',
      isDefault: true,
    })

    expect(await invoke.get('settings:save')?.(appEvent, 'https://other.example')).toEqual({
      ok: false,
      error: 'Not allowed',
    })
    await invoke.get('settings:save')?.(fileEvent, 'https://other.example')
    expect(deps.applyOrigin).toHaveBeenCalledWith('https://other.example')
  })

  it('handles a missing senderFrame safely', async () => {
    const { invoke } = collectHandlers()
    expect(await invoke.get('settings:get')?.({ senderFrame: null })).toBeNull()
  })

  it('restricts browser-agent tool execution to the app origin and known tools', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-agent:execute-tool')

    expect(await handler?.(evilEvent, 'browser_navigate', { url: 'https://x.dev' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('not allowed'),
    })
    expect(await handler?.(fileEvent, 'browser_navigate', {})).toMatchObject({ ok: false })
    expect(await handler?.(appEvent, 'not_a_browser_tool', {})).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unknown browser tool'),
    })
    // Allowed sender + known tool reaches the driver (which reports its own
    // tool-level failure since no browser session exists in this test).
    expect(await handler?.(appEvent, 'browser_snapshot', {})).toMatchObject({
      ok: false,
      error: expect.stringContaining('No page is open yet'),
    })
  })

  it('ignores browser-agent panel actions from outside the app origin', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:panel-action')
    // Malformed and foreign-origin actions are dropped without throwing.
    expect(() => handler?.(evilEvent, { action: 'reload' })).not.toThrow()
    expect(() => handler?.(appEvent, 'not-an-object')).not.toThrow()
    expect(() => handler?.(appEvent, { action: 'reload' })).not.toThrow()
  })
})
