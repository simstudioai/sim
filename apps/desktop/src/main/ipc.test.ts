import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { ipcMain, shell } from 'electron'
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
      appOrigin: () => APP,
      allowHttpLocalhost: () => false,
      retryLoad: vi.fn(),
      beginOAuthConnect: vi.fn(async () => true),
      openSettings: vi.fn(),
      closeSettings: vi.fn(),
      applyOrigin: vi.fn(async () => ({ ok: true as const, origin: 'https://sim.ai' })),
      localFilesystem: new LocalFilesystemService({
        chooseDirectory: vi.fn(async () => null),
      }),
      launcher: {
        openChat: vi.fn(),
        openApp: vi.fn(),
        hide: vi.fn(),
        resize: vi.fn(),
      },
      launcherShortcut: {
        get: vi.fn(() => ({
          shortcut: 'Alt+Space',
          presets: ['Alt+Space'],
          status: 'registered' as const,
        })),
        set: vi.fn(() => ({
          shortcut: 'Control+Space',
          presets: ['Alt+Space'],
          status: 'registered' as const,
        })),
      },
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

  it('restricts the OAuth connect handoff to the app origin', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:oauth-connect')
    expect(await handler?.(evilEvent, 'slack')).toBe(false)
    expect(await handler?.(fileEvent, 'slack')).toBe(false)
    expect(deps.beginOAuthConnect).not.toHaveBeenCalled()
    expect(await handler?.(appEvent, 42)).toBe(false)
    expect(await handler?.(appEvent, 'slack')).toBe(true)
    expect(deps.beginOAuthConnect).toHaveBeenCalledWith('slack', {})

    // Chip-initiated connects carry workspace/credential scope; malformed
    // scopes (wrong types, unsafe ids) are rejected before the handoff.
    expect(
      await handler?.(appEvent, 'slack', { workspaceId: 'ws1', credentialId: 'cred_1' })
    ).toBe(true)
    expect(deps.beginOAuthConnect).toHaveBeenCalledWith('slack', {
      workspaceId: 'ws1',
      credentialId: 'cred_1',
    })
    expect(await handler?.(appEvent, 'slack', { workspaceId: 'ws/../evil' })).toBe(false)
    expect(await handler?.(appEvent, 'slack', 'not-an-object')).toBe(false)
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

  it('restricts launcher channels to the app origin and validates ids', () => {
    const { on } = collectHandlers()
    const openChat = on.get('launcher:open-chat')

    openChat?.(evilEvent, { workspaceId: 'ws1' })
    openChat?.(fileEvent, { workspaceId: 'ws1' })
    expect(deps.launcher.openChat).not.toHaveBeenCalled()

    // Ids that could escape the URL path are rejected.
    openChat?.(appEvent, { workspaceId: 'ws1/../../admin' })
    openChat?.(appEvent, { workspaceId: 'ws1', chatId: 'c1?x=1' })
    openChat?.(appEvent, { workspaceId: '' })
    openChat?.(appEvent, 'not-an-object')
    expect(deps.launcher.openChat).not.toHaveBeenCalled()

    openChat?.(appEvent, { workspaceId: 'ws1', chatId: 'chat_2-a' })
    expect(deps.launcher.openChat).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      chatId: 'chat_2-a',
    })
    openChat?.(appEvent, { workspaceId: 'ws1' })
    expect(deps.launcher.openChat).toHaveBeenCalledWith({ workspaceId: 'ws1' })

    on.get('launcher:open-app')?.(evilEvent)
    expect(deps.launcher.openApp).not.toHaveBeenCalled()
    on.get('launcher:open-app')?.(appEvent)
    expect(deps.launcher.openApp).toHaveBeenCalledTimes(1)

    on.get('launcher:close')?.(evilEvent)
    expect(deps.launcher.hide).not.toHaveBeenCalled()
    on.get('launcher:close')?.(appEvent)
    expect(deps.launcher.hide).toHaveBeenCalledTimes(1)

    on.get('launcher:resize')?.(appEvent, 'tall')
    on.get('launcher:resize')?.(appEvent, Number.NaN)
    expect(deps.launcher.resize).not.toHaveBeenCalled()
    on.get('launcher:resize')?.(appEvent, 400)
    expect(deps.launcher.resize).toHaveBeenCalledWith(400)
  })

  it('restricts launcher shortcut settings to bundled local pages', async () => {
    const { invoke } = collectHandlers()
    expect(await invoke.get('settings:launcher-shortcut-get')?.(appEvent)).toBeNull()
    expect(await invoke.get('settings:launcher-shortcut-get')?.(fileEvent)).toMatchObject({
      shortcut: 'Alt+Space',
      status: 'registered',
    })
    expect(await invoke.get('settings:launcher-shortcut-set')?.(appEvent, 'Control+Space')).toBe(
      null
    )
    expect(await invoke.get('settings:launcher-shortcut-set')?.(fileEvent, 42)).toBeNull()
    await invoke.get('settings:launcher-shortcut-set')?.(fileEvent, 'Control+Space')
    expect(deps.launcherShortcut.set).toHaveBeenCalledWith('Control+Space')
  })
})
