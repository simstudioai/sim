import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { ipcMain, shell } from 'electron'
import { type IpcDeps, registerIpcHandlers } from '@/main/ipc'
import { LocalFilesystemService } from '@/main/local-filesystem'

const APP = 'https://sim.ai'

type Handler = (
  event: {
    senderFrame: { url: string; executeJavaScript?: (source: string) => Promise<unknown> } | null
    sender?: { session: { fetch: (url: string, init?: RequestInit) => Promise<Response> } }
  },
  ...args: unknown[]
) => unknown

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

const fileEvent = { senderFrame: { url: 'file:///app/static/offline.html' } }
const appEvent = { senderFrame: { url: `${APP}/workspace/ws1` } }
const activeAppEvent = {
  senderFrame: {
    url: `${APP}/workspace/ws1`,
    executeJavaScript: vi.fn(async () => true),
  },
}
const inactiveAppEvent = {
  senderFrame: {
    url: `${APP}/workspace/ws1`,
    executeJavaScript: vi.fn(async () => false),
  },
}
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
      localFilesystem: new LocalFilesystemService({
        chooseDirectory: vi.fn(async () => null),
      }),
      settings: {
        getPreferences: vi.fn(() => ({
          notificationsEnabled: true,
          notificationSounds: true,
          notificationsOnlyWhenUnfocused: true,
          launchAtLogin: false,
          autoDownloadUpdates: true,
        })),
        setPreference: vi.fn(),
        notify: vi.fn(() => true),
        applySystemPreferences: vi.fn(),
      },
      getWindowState: vi.fn(() => ({ isFullScreen: true })),
      updates: {
        getState: vi.fn(() => ({ status: 'ready' as const, version: '1.2.3' })),
        check: vi.fn(),
        install: vi.fn(),
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
    expect(await handler?.(appEvent, 'slack', { workspaceId: 'ws1', credentialId: 'cred_1' })).toBe(
      true
    )
    expect(deps.beginOAuthConnect).toHaveBeenCalledWith('slack', {
      workspaceId: 'ws1',
      credentialId: 'cred_1',
    })
    expect(await handler?.(appEvent, 'slack', { workspaceId: 'ws/../evil' })).toBe(false)
    expect(await handler?.(appEvent, 'slack', 'not-an-object')).toBe(false)
  })

  it('restricts the updates surface to the app origin', async () => {
    const { invoke, on } = collectHandlers()
    const getState = invoke.get('desktop:updates:get-state')
    expect(await getState?.(evilEvent)).toEqual({ status: 'idle' })
    expect(await getState?.(appEvent)).toEqual({ status: 'ready', version: '1.2.3' })

    on.get('desktop:updates:check')?.(evilEvent)
    on.get('desktop:updates:install')?.(evilEvent)
    expect(deps.updates.check).not.toHaveBeenCalled()
    expect(deps.updates.install).not.toHaveBeenCalled()

    on.get('desktop:updates:check')?.(appEvent)
    on.get('desktop:updates:install')?.(appEvent)
    expect(deps.updates.check).toHaveBeenCalledTimes(1)
    expect(deps.updates.install).toHaveBeenCalledTimes(1)
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

  it('requires an active user gesture for granting or revoking folder access', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:local-filesystem')

    expect(await handler?.(inactiveAppEvent, { operation: 'mount_directory' })).toMatchObject({
      ok: false,
      code: 'ACCESS_DENIED',
      error: expect.stringContaining('explicit user click'),
    })
    expect(await handler?.(activeAppEvent, { operation: 'mount_directory' })).toMatchObject({
      ok: true,
      data: { cancelled: true, mount: null },
    })
  })

  it('requires server authorization for every privileged filesystem tool request', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:local-filesystem')
    const handle = vi.spyOn(deps.localFilesystem, 'handle')

    expect(
      await handler?.(appEvent, {
        operation: 'read',
        uri: 'localfs://mount-1/README.md',
        requestId: 'tool-1',
      })
    ).toMatchObject({
      ok: false,
      code: 'ACCESS_DENIED',
      error: expect.stringContaining('authorized pending Copilot tool call'),
    })
    expect(handle).not.toHaveBeenCalled()

    const fetchAuthorization = vi.fn(async () =>
      Response.json({
        toolName: 'read',
        args: { path: 'user-local/Project--mount-1/README.md' },
      })
    )
    const authorizedEvent = {
      senderFrame: { url: `${APP}/workspace/ws1` },
      sender: { session: { fetch: fetchAuthorization } },
    }
    vi.spyOn(deps.localFilesystem, 'isAuthorizedClientToolRequest').mockReturnValueOnce(true)
    handle.mockResolvedValueOnce({ ok: true, data: { forgotten: false } })

    await expect(
      handler?.(authorizedEvent, {
        operation: 'read',
        uri: 'localfs://mount-1/README.md',
        requestId: 'tool-1',
      })
    ).resolves.toEqual({ ok: true, data: { forgotten: false } })
    expect(fetchAuthorization).toHaveBeenCalledWith(
      `${APP}/api/desktop/tool/authorize`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ toolCallId: 'tool-1' }),
      })
    )
  })

  it('restricts desktop settings to the app origin and validates mutations', async () => {
    const { invoke } = collectHandlers()
    const get = invoke.get('desktop:settings:get')
    const set = invoke.get('desktop:settings:set')
    const notify = invoke.get('desktop:settings:notify')

    expect(await get?.(evilEvent)).toBeNull()
    expect(await get?.(appEvent)).toMatchObject({ notificationsEnabled: true })

    await set?.(evilEvent, 'notificationsEnabled', false)
    await set?.(appEvent, 'not-a-setting', false)
    await set?.(appEvent, 'notificationsEnabled', 'no')
    expect(deps.settings.setPreference).not.toHaveBeenCalled()

    await set?.(appEvent, 'notificationsEnabled', false)
    expect(deps.settings.setPreference).toHaveBeenCalledWith('notificationsEnabled', false)

    expect(await notify?.(evilEvent, { title: 'Done', body: 'Ready' })).toBe(false)
    expect(await notify?.(appEvent, { title: '', body: 'Ready' })).toBe(false)
    expect(
      await notify?.(appEvent, { title: 'Done', body: 'Ready', route: '//evil.example' })
    ).toBe(false)
    expect(deps.settings.notify).not.toHaveBeenCalled()

    expect(
      await notify?.(appEvent, {
        title: 'Task complete',
        body: 'Sim finished responding.',
        route: '/workspace/ws1/chat/c1',
      })
    ).toBe(true)
    expect(deps.settings.notify).toHaveBeenCalledWith({
      title: 'Task complete',
      body: 'Sim finished responding.',
      route: '/workspace/ws1/chat/c1',
    })
  })

  it('reports native fullscreen state only to the app origin', async () => {
    const { invoke } = collectHandlers()
    const getWindowState = invoke.get('desktop:window-state:get')

    expect(await getWindowState?.(evilEvent)).toEqual({ isFullScreen: false })
    expect(await getWindowState?.(appEvent)).toEqual({ isFullScreen: true })
    expect(deps.getWindowState).toHaveBeenCalledTimes(1)
  })

  it('restricts shell-control channels to bundled local pages', () => {
    const { on } = collectHandlers()

    on.get('offline:retry')?.(appEvent)
    expect(deps.retryLoad).not.toHaveBeenCalled()
    on.get('offline:retry')?.(fileEvent)
    expect(deps.retryLoad).toHaveBeenCalledTimes(1)
  })

  it('handles a missing senderFrame safely', async () => {
    const { invoke } = collectHandlers()
    expect(await invoke.get('desktop:oauth-connect')?.({ senderFrame: null }, 'slack')).toBe(false)
    expect(deps.beginOAuthConnect).not.toHaveBeenCalled()
  })

  it('restricts browser-agent tool execution to the app origin and known tools', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-agent:execute-tool')

    expect(
      await handler?.(evilEvent, 'tool-1', 'browser_navigate', { url: 'https://x.dev' })
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('not allowed'),
    })
    expect(await handler?.(fileEvent, 'tool-1', 'browser_navigate', {})).toMatchObject({
      ok: false,
    })
    expect(await handler?.(appEvent, 'tool-1', 'browser_snapshot', {})).toMatchObject({
      ok: false,
      error: expect.stringContaining('authorized pending Copilot tool call'),
    })

    const fetchAuthorization = vi.fn(async () =>
      Response.json({ toolName: 'browser_snapshot', args: {} })
    )
    const authorizedEvent = {
      senderFrame: { url: `${APP}/workspace/ws1` },
      sender: { session: { fetch: fetchAuthorization } },
    }
    // The server-persisted name must match the renderer's requested name.
    expect(
      await handler?.(authorizedEvent, 'tool-1', 'browser_navigate', {
        url: 'https://evil.example',
      })
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('authorized pending Copilot tool call'),
    })
    // An authorized call reaches the driver with the server-persisted args
    // (which reports its own tool-level failure because no session exists).
    expect(
      await handler?.(authorizedEvent, 'tool-1', 'browser_snapshot', {
        ignored: 'renderer cannot choose params',
      })
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('No page is open yet'),
    })
    expect(fetchAuthorization).toHaveBeenCalledWith(
      `${APP}/api/desktop/tool/authorize`,
      expect.objectContaining({ body: JSON.stringify({ toolCallId: 'tool-1' }) })
    )
  })

  it('ignores browser-agent panel actions from outside the app origin', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:panel-action')
    // Malformed and foreign-origin actions are dropped without throwing.
    expect(() => handler?.(evilEvent, { action: 'reload' })).not.toThrow()
    expect(() => handler?.(appEvent, 'not-an-object')).not.toThrow()
    expect(() => handler?.(appEvent, { action: 'reload' })).not.toThrow()
  })

  it('restricts browser-panel occlusion updates to boolean app-origin messages', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-occluded')

    expect(() => handler?.(evilEvent, true)).not.toThrow()
    expect(() => handler?.(appEvent, 'yes')).not.toThrow()
    expect(() => handler?.(appEvent, true)).not.toThrow()
  })

  it('restricts browser-panel focus updates to boolean app-origin messages', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-focused')

    expect(() => handler?.(evilEvent, true)).not.toThrow()
    expect(() => handler?.(appEvent, 'yes')).not.toThrow()
    expect(() => handler?.(appEvent, true)).not.toThrow()
  })

  it('restricts browser theme updates to known app-origin preferences', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-theme')

    expect(() => handler?.(evilEvent, 'dark')).not.toThrow()
    expect(() => handler?.(appEvent, 'sepia')).not.toThrow()
    expect(() => handler?.(appEvent, 'system')).not.toThrow()
  })
})
