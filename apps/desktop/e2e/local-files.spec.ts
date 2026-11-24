import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import type {
  DesktopLocalFileRequest,
  DesktopPreferences,
  SimDesktopApi,
} from '@sim/desktop-bridge'
import { answerShellDialog } from './executor-sim'
import {
  test as base,
  type DesktopApp,
  type DesktopBridge,
  expect,
  focusFirstWindow,
  serve,
} from './harness'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='

/**
 * The app's own page stands in for Sim: a Forget button and a Full file access switch that drive
 * the same bridge calls Sim's Desktop settings make (a real click supplies the user activation the
 * setter requires), and the switch shows whatever the desktop last reported.
 */
const FIXTURE_PAGE = `<!doctype html><title>Local file fixture</title><h1>Local files</h1>
<button id="forget">Forget folders</button>
<label><input id="full-access" type="checkbox" role="switch" disabled> Full file access</label>
<output id="full-access-status"></output>
<script>
  const api = window.simDesktop
  const forget = document.getElementById('forget')
  forget.addEventListener('click', async () => {
    const result = await api.localFilesystem({ operation: 'list_mounts' })
    for (const mount of result.data.mounts)
      await api.localFilesystem({ operation: 'forget_mount', uri: mount.uri })
    forget.textContent = 'Forgotten'
  })
  const toggle = document.getElementById('full-access')
  const status = document.getElementById('full-access-status')
  const show = (preferences) => {
    toggle.checked = preferences.fullFileAccess === true
    toggle.disabled = false
  }
  api.settings.getPreferences().then(show)
  api.settings.onFullFileAccessChanged(show)
  toggle.addEventListener('change', () => {
    toggle.disabled = true
    status.textContent = ''
    api.settings.setFullFileAccess(toggle.checked).then(show, () => {
      status.textContent = 'Not saved'
      toggle.disabled = false
    })
  })
</script>`

type LocalFileResponse = Awaited<ReturnType<NonNullable<SimDesktopApi['localFiles']>>>

interface ToolCall {
  toolName: 'read_local_file' | 'import_local_files'
  args: Record<string, unknown>
  chatId?: string
}

interface Session {
  desktop: DesktopApp
  app: ElectronApplication
  window: Page
  fullAccess: Locator
  invoke(request: DesktopLocalFileRequest): Promise<LocalFileResponse>
  /** Starts a request and resolves once its folder prompt is up. */
  requestPermission(
    request: DesktopLocalFileRequest
  ): Promise<{ prompt: Page; result: Promise<LocalFileResponse> }>
  preferences(): Promise<DesktopPreferences>
}

interface LocalFilesFixture {
  root: string
  /** `Reports`: report.txt, image.png, and an empty subfolder. */
  source: string
  /** `Reports-other`, a sibling holding private.txt that no call is meant to reach. */
  outside: string
  /** The calls the fixture Sim authorizes, by tool call id; any other id is refused. */
  calls: Record<string, ToolCall | undefined>
  /** Calls Sim refuses after their first authorization, as it does once a call has ended. */
  expireAfterAuthorization: Set<string>
  origin: string
  signIn(): void
  /** Launches the app, on `userData` when relaunching the same profile. */
  open(userData?: string): Promise<Session>
  close(session: Session): Promise<void>
}

type FsPatchRuntime = typeof globalThis & {
  e2eFsPatch?: { fired: string[]; restore(): void | Promise<void> }
}

/** Undoes a step's fs/promises patch in the main process and returns the race actions that ran. */
async function restoreFsPatch(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(async () => {
    const runtime = globalThis as FsPatchRuntime
    const patch = runtime.e2eFsPatch
    runtime.e2eFsPatch = undefined
    await patch?.restore()
    return patch?.fired ?? []
  })
}

const test = base.extend<{ localFiles: LocalFilesFixture }>({
  localFiles: async ({ desktop }, use) => {
    const root = desktop.tempDir('sim-native-files-e2e-')
    const source = join(root, 'Reports')
    const outside = join(root, 'Reports-other')
    mkdirSync(outside)
    writeFileSync(join(outside, 'private.txt'), 'outside contents')
    mkdirSync(join(source, 'empty'), { recursive: true })
    writeFileSync(join(source, 'report.txt'), 'native file contents')
    writeFileSync(join(source, 'image.png'), Buffer.from(PNG, 'base64'))
    const claimed = new Set<string>()
    const expireAfterAuthorization = new Set<string>()
    let signedIn = true
    const calls: Record<string, ToolCall | undefined> = {
      directory: { toolName: 'read_local_file', args: { path: source } },
      text: { toolName: 'read_local_file', args: { path: join(source, 'report.txt') } },
      otherChat: {
        toolName: 'read_local_file',
        args: { path: join(source, 'report.txt') },
        chatId: 'other-chat',
      },
      image: { toolName: 'read_local_file', args: { path: join(source, 'image.png') } },
      import: {
        toolName: 'import_local_files',
        args: { path: source, targetWorkspaceId: 'target-workspace' },
      },
    }
    const server = await serve(async (request, response, url) => {
      if (url.pathname === '/api/auth/get-session') {
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify(
              signedIn
                ? { user: { id: 'local-file-user' }, session: { id: 'local-file-session' } }
                : null
            )
          )
        return
      }
      if (url.pathname === '/api/auth/sign-out') {
        signedIn = false
        response
          .writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'better-auth.session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
          })
          .end('{}')
        return
      }
      if (url.pathname === '/api/desktop/tool/authorize') {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const input = JSON.parse(body)
        const call = calls[input.toolCallId]
        if (
          !call ||
          (input.claim && call.toolName === 'import_local_files' && claimed.has(input.toolCallId))
        ) {
          response.writeHead(call ? 409 : 403, { 'Content-Type': 'application/json' }).end('{}')
          return
        }
        if (input.claim) claimed.add(input.toolCallId)
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ...call, chatId: call.chatId ?? 'org-chat' }))
        if (expireAfterAuthorization.has(input.toolCallId)) calls[input.toolCallId] = undefined
        return
      }
      response
        .writeHead(200, {
          'Content-Type': 'text/html',
          ...(signedIn
            ? { 'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/' }
            : {}),
        })
        .end(FIXTURE_PAGE)
    })
    const sessions: Session[] = []

    const open = async (userData?: string): Promise<Session> => {
      const launched = await desktop.launch({
        origin: server.origin,
        userData,
        main: process.env.SIM_DESKTOP_E2E_MAIN,
        args: ['--use-mock-keychain'],
      })
      const { app } = launched
      const window = await app.firstWindow()
      await focusFirstWindow(app)
      await expect(window.getByRole('heading', { name: 'Local files', exact: true })).toBeVisible()
      const invoke = (request: DesktopLocalFileRequest) =>
        window.evaluate(async (input) => {
          const api = (globalThis as DesktopBridge).simDesktop
          if (!api.localFiles) throw new Error('Native file bridge missing')
          return api.localFiles(input)
        }, request)
      await expect
        .poll(() =>
          window.evaluate(
            async () =>
              (
                await (globalThis as DesktopBridge).simDesktop.localFilesystem?.({
                  operation: 'list_mounts',
                })
              )?.ok
          )
        )
        .toBe(true)
      if (userData === undefined) {
        await window.evaluate(async () => {
          const settings = (globalThis as DesktopBridge).simDesktop.settings
          await settings.setPreference('browserEnabled', false)
          await settings.setPreference('terminalEnabled', false)
        })
      }
      const session: Session = {
        desktop: launched,
        app,
        window,
        fullAccess: window.getByRole('switch', { name: 'Full file access', exact: true }),
        invoke,
        async requestPermission(request) {
          const shown = app.waitForEvent('window', { timeout: 10_000 })
          const result = invoke(request)
          void result.catch(() => {})
          const prompt = await shown
          await expect(
            prompt.getByRole('button', { name: "Don't allow", exact: true })
          ).toBeVisible()
          return { prompt, result }
        },
        preferences: () =>
          window.evaluate(() => (globalThis as DesktopBridge).simDesktop.settings.getPreferences()),
      }
      sessions.push(session)
      return session
    }

    await use({
      root,
      source,
      outside,
      calls,
      expireAfterAuthorization,
      origin: server.origin,
      signIn: () => {
        signedIn = true
      },
      open,
      close: (session) => desktop.close(session.desktop),
    })
    // The apps quit while their server still answers, as they would against a live Sim.
    try {
      for (const session of sessions) await desktop.close(session.desktop)
    } finally {
      await server.close()
    }
  },
})

test('folder consent is asked once per folder, shared across chats, and bound to the authorized call', async ({
  localFiles,
}) => {
  const { root, source, outside, calls, expireAfterAuthorization } = localFiles
  const { app, window, invoke, requestPermission } = await localFiles.open()

  await test.step('declining consent fails every read waiting on that folder', async () => {
    const shown = app.waitForEvent('window', { timeout: 10_000 })
    const reads = ['text', 'otherChat'].map((toolCallId) =>
      invoke({ operation: 'read', toolCallId })
    )
    for (const read of reads) void read.catch(() => {})
    const denial = await shown
    await expect(denial.getByRole('button', { name: "Don't allow", exact: true })).toBeFocused()
    await answerShellDialog(denial, "Don't allow")
    expect(await Promise.all(reads)).toEqual([
      { ok: false, error: expect.any(String) },
      { ok: false, error: expect.any(String) },
    ])
  })

  await test.step('an allowed folder serves the queued read, the authorized path, and images', async () => {
    const shown = app.waitForEvent('window')
    const folderRead = invoke({ operation: 'read', toolCallId: 'directory' })
    void folderRead.catch(() => {})
    const consent = await shown
    const queuedRead = invoke({ operation: 'read', toolCallId: 'text' })
    void queuedRead.catch(() => {})
    await expect(consent.getByRole('button', { name: 'Allow folder', exact: true })).toBeVisible()
    expect(
      await consent.evaluate(() => typeof (globalThis as { simDesktop?: unknown }).simDesktop)
    ).toBe('undefined')
    await answerShellDialog(consent, 'Allow folder')
    expect(await folderRead).toMatchObject({ ok: true, data: { representation: 'directory' } })
    expect(await queuedRead).toMatchObject({ ok: true, data: { text: 'native file contents' } })
    // The renderer's path is ignored: Sim's authorized arguments decide what is read.
    const redirected = {
      operation: 'read' as const,
      toolCallId: 'text',
      path: join(outside, 'private.txt'),
    }
    expect(await invoke(redirected)).toMatchObject({
      ok: true,
      data: { representation: 'text', text: 'native file contents' },
    })
    expect(await invoke({ operation: 'read', toolCallId: 'image' })).toMatchObject({
      ok: true,
      data: { observations: [{ mediaType: 'image/png', data: PNG }] },
    })
  })

  await test.step('a folder grant works in another chat but does not permit symlink escapes', async () => {
    expect(await invoke({ operation: 'read', toolCallId: 'otherChat' })).toMatchObject({
      ok: true,
      data: { text: 'native file contents' },
    })
    writeFileSync(join(source, 'empty', 'new.txt'), 'new file in a subfolder')
    calls.nested = {
      toolName: 'read_local_file',
      args: { path: join(source, 'empty', 'new.txt') },
      chatId: 'another-chat',
    }
    expect(await invoke({ operation: 'read', toolCallId: 'nested' })).toMatchObject({
      ok: true,
      data: { text: 'new file in a subfolder' },
    })
    rmSync(join(source, 'empty', 'new.txt'))
    symlinkSync(join(outside, 'private.txt'), join(source, 'linked.txt'))
    calls.escape = { toolName: 'read_local_file', args: { path: join(source, 'linked.txt') } }
    const escaped = await requestPermission({ operation: 'read', toolCallId: 'escape' })
    await expect(escaped.prompt.getByRole('dialog')).toContainText(
      JSON.stringify(realpathSync(outside))
    )
    await answerShellDialog(escaped.prompt, "Don't allow")
    expect(await escaped.result).toMatchObject({ ok: false })
    rmSync(join(source, 'linked.txt'))
  })

  await test.step('cancelled calls and changed arguments cannot acquire a grant', async () => {
    for (const changed of [false, true]) {
      calls.stale = { toolName: 'read_local_file', args: { path: join(outside, 'private.txt') } }
      const stale = await requestPermission({ operation: 'read', toolCallId: 'stale' })
      if (changed) calls.stale.args.path = join(source, 'report.txt')
      else calls.stale = undefined
      await answerShellDialog(stale.prompt, 'Allow folder')
      expect(await stale.result).toMatchObject({ ok: false })
    }
  })

  await test.step('Stop cancels only its own request while chats share a folder prompt', async () => {
    const sharedFolder = join(root, 'Shared')
    mkdirSync(sharedFolder)
    writeFileSync(join(sharedFolder, 'shared.txt'), 'shared contents')
    for (const toolCallId of ['sharedLeader', 'sharedFollower', 'sharedSurvivor']) {
      calls[toolCallId] = {
        toolName: 'read_local_file',
        args: { path: join(sharedFolder, 'shared.txt') },
        chatId: toolCallId,
      }
    }
    // A request joins the pending prompt in the same turn its stat of the file settles, so the
    // count of those stats says how many requests share the prompt. Sim's authorization lands
    // before that, which is why it cannot stand in for the join.
    await app.evaluate(
      (_electron, file) => {
        const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
        const original = fs.stat
        const fired: string[] = []
        ;(globalThis as FsPatchRuntime).e2eFsPatch = {
          fired,
          restore: () => {
            fs.stat = original
          },
        }
        fs.stat = (async (...args: Parameters<typeof fs.stat>) => {
          const result = await original(...args)
          if (args[0] === file) fired.push('joined')
          return result
        }) as typeof fs.stat
      },
      realpathSync(join(sharedFolder, 'shared.txt'))
    )
    const joined = () =>
      app.evaluate(() => (globalThis as FsPatchRuntime).e2eFsPatch?.fired.length ?? 0)
    try {
      const leader = await requestPermission({ operation: 'read', toolCallId: 'sharedLeader' })
      expect(await joined()).toBe(1)
      const follower = invoke({ operation: 'read', toolCallId: 'sharedFollower' })
      void follower.catch(() => {})
      await expect.poll(joined).toBe(2)
      await invoke({ operation: 'cancel', toolCallId: 'sharedFollower' })
      expect(await follower).toMatchObject({ ok: false })
      const survivor = invoke({ operation: 'read', toolCallId: 'sharedSurvivor' })
      void survivor.catch(() => {})
      await expect.poll(joined).toBe(3)
      await invoke({ operation: 'cancel', toolCallId: 'sharedLeader' })
      expect(await leader.result).toMatchObject({ ok: false })
      // The leader's own prompt is still the one to answer: neither cancel closed it.
      await answerShellDialog(leader.prompt, 'Allow folder')
      expect(await survivor).toMatchObject({ ok: true, data: { text: 'shared contents' } })
    } finally {
      await restoreFsPatch(app)
    }
  })

  await test.step('cancelling in the renderer closes consent without remembering access', async () => {
    calls.cancelled = { toolName: 'read_local_file', args: { path: join(outside, 'private.txt') } }
    const cancelled = await requestPermission({ operation: 'read', toolCallId: 'cancelled' })
    const closed = cancelled.prompt.waitForEvent('close')
    await invoke({ operation: 'cancel', toolCallId: 'cancelled' })
    await closed
    expect(await cancelled.result).toMatchObject({ ok: false })
    const again = await requestPermission({ operation: 'read', toolCallId: 'cancelled' })
    await answerShellDialog(again.prompt, "Don't allow")
    expect(await again.result).toMatchObject({ ok: false })
  })

  await test.step('consent escapes direction controls in folder names', async () => {
    const folder = join(root, 'Bidi؜‎‏')
    mkdirSync(folder)
    calls.bidi = { toolName: 'read_local_file', args: { path: folder } }
    const bidi = await requestPermission({ operation: 'read', toolCallId: 'bidi' })
    await expect(bidi.prompt.getByRole('dialog')).toContainText('Bidi\\u061c\\u200e\\u200f')
    await answerShellDialog(bidi.prompt, "Don't allow")
    expect(await bidi.result).toMatchObject({ ok: false })
  })

  await test.step('an unanswered prompt does not block approved folders', async () => {
    calls.blocker = { toolName: 'read_local_file', args: { path: join(outside, 'private.txt') } }
    const blocker = await requestPermission({ operation: 'read', toolCallId: 'blocker' })
    expect(await invoke({ operation: 'read', toolCallId: 'text' })).toMatchObject({ ok: true })
    await answerShellDialog(blocker.prompt, "Don't allow")
    expect(await blocker.result).toMatchObject({ ok: false })
  })

  await test.step('a call that ended after authorization cannot use an approved folder', async () => {
    calls.expired = { toolName: 'read_local_file', args: { path: join(source, 'report.txt') } }
    expireAfterAuthorization.add('expired')
    expect(await invoke({ operation: 'read', toolCallId: 'expired' })).toMatchObject({ ok: false })
  })

  await test.step('replacing the proposed folder during consent does not expose its new target', async () => {
    const proposed = join(root, 'Proposed')
    mkdirSync(proposed)
    calls.retargeted = { toolName: 'read_local_file', args: { path: proposed } }
    const retargeted = await requestPermission({ operation: 'read', toolCallId: 'retargeted' })
    renameSync(proposed, join(root, 'Original'))
    mkdirSync(proposed)
    writeFileSync(join(proposed, 'unapproved.txt'), 'replacement folder contents')
    await answerShellDialog(retargeted.prompt, 'Allow folder')
    expect(await retargeted.result).toMatchObject({ ok: false })
  })

  await test.step('an approved folder imports once per call and to any destination without prompting', async () => {
    const manifest = await invoke({ operation: 'manifest', toolCallId: 'import' })
    if (!manifest.ok || manifest.data.kind !== 'manifest') throw new Error(JSON.stringify(manifest))
    expect(manifest.data.targetWorkspaceId).toBe('target-workspace')
    expect(manifest.data.entries.map((entry) => entry.relativePath)).toEqual([
      '',
      'empty',
      'image.png',
      'report.txt',
    ])
    const file = manifest.data.entries.find((entry) => entry.relativePath === 'report.txt')
    if (!file) throw new Error('Missing import file')
    const chunkRequest = {
      operation: 'chunk' as const,
      toolCallId: 'import',
      relativePath: file.relativePath,
      revision: file.revision,
      offset: 0,
    }
    const chunk = await invoke(chunkRequest)
    if (!chunk.ok || chunk.data.kind !== 'chunk') throw new Error(JSON.stringify(chunk))
    expect(Object.values(chunk.data.bytes)).toEqual([...Buffer.from('native file contents')])
    expect(chunk.data.eof).toBe(true)
    // The bytes cross the bridge in a form the renderer can upload as a File.
    expect(
      await window.evaluate(async (input) => {
        const response = await (globalThis as DesktopBridge).simDesktop.localFiles?.(input)
        if (!response?.ok || response.data.kind !== 'chunk') throw new Error('Missing native chunk')
        return new File([new Uint8Array(response.data.bytes)], 'report.txt').text()
      }, chunkRequest)
    ).toBe('native file contents')
    expect(await invoke({ operation: 'manifest', toolCallId: 'import' })).toMatchObject({
      ok: false,
      code: 'ALREADY_STARTED',
    })
    calls.otherImport = {
      toolName: 'import_local_files',
      args: { path: source, targetWorkspaceId: 'other-workspace' },
    }
    expect(await invoke({ operation: 'manifest', toolCallId: 'otherImport' })).toMatchObject({
      ok: true,
    })
  })

  await test.step('File → Folder Access opens over a focused utility window', async () => {
    const serverShown = app.waitForEvent('window', { timeout: 10_000 })
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()
        ?.items.flatMap((entry) => entry.submenu?.items ?? [])
        .find((entry) => entry.label === 'Server…')
      if (!item) throw new Error('Server menu item missing')
      item.click()
    })
    await expect(await serverShown).toHaveTitle('Sim - Server')
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (win) => win.webContents.getURL().endsWith('server.html') && win.isVisible()
          )
        )
      )
      .toBe(true)
    const accessMenu = await app.evaluate(({ BrowserWindow, Menu }) => {
      const utility = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().endsWith('server.html')
      )
      if (!utility) throw new Error('Server window missing')
      const item = Menu.getApplicationMenu()
        ?.items.flatMap((entry) => entry.submenu?.items ?? [])
        .find((entry) => entry.label === 'Folder Access…')
      if (!item) throw new Error('Folder Access menu item missing')
      const popup = Menu.prototype.popup
      let shown: { anchoredToUtility: boolean; items: string[] } | undefined
      Menu.prototype.popup = function (this: Electron.Menu, options) {
        shown = {
          anchoredToUtility: options?.window === utility,
          items: this.items.map((entry) => entry.label),
        }
      }
      try {
        item.click(undefined, utility)
      } finally {
        Menu.prototype.popup = popup
      }
      utility.close()
      return shown
    })
    expect(accessMenu?.anchoredToUtility).toBe(true)
    expect(accessMenu?.items).toContain('Add Folder…')
  })
})

test('Full file access is opt-in, survives restart, turns off cleanly, and fails closed when it cannot be saved', async ({
  localFiles,
}) => {
  const { root, outside, calls } = localFiles
  let session = await localFiles.open()
  const fullFolder = join(root, 'Full access')
  mkdirSync(fullFolder)
  writeFileSync(join(fullFolder, 'file.txt'), 'full access contents')
  calls.fullAccess = { toolName: 'read_local_file', args: { path: join(fullFolder, 'file.txt') } }

  await test.step('a request that ended cannot enable Full file access from its confirmation', async () => {
    calls.expiringFullAccess = {
      toolName: 'read_local_file',
      args: { path: join(outside, 'private.txt') },
    }
    const permission = await session.requestPermission({
      operation: 'read',
      toolCallId: 'expiringFullAccess',
    })
    const shown = session.app.waitForEvent('window')
    await answerShellDialog(permission.prompt, 'Full file access')
    const confirmation = await shown
    calls.expiringFullAccess = undefined
    await answerShellDialog(confirmation, 'Enable')
    expect(await permission.result).toMatchObject({ ok: false })
    expect(await session.preferences()).toMatchObject({ fullFileAccess: false })
  })

  await test.step('Cancel on the confirmation returns to the folder prompt, and Enable reaches every folder', async () => {
    const { app, invoke, fullAccess } = session
    await expect(fullAccess).not.toBeChecked()
    const permission = await session.requestPermission({
      operation: 'read',
      toolCallId: 'fullAccess',
    })
    const confirmationShown = app.waitForEvent('window')
    await answerShellDialog(permission.prompt, 'Full file access')
    const confirmation = await confirmationShown
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    const returnedPrompt = app.waitForEvent('window')
    await answerShellDialog(confirmation, 'Cancel')
    const folderPrompt = await returnedPrompt
    expect(await session.preferences()).toMatchObject({ fullFileAccess: false })
    const acceptedConfirmation = app.waitForEvent('window')
    await answerShellDialog(folderPrompt, 'Full file access')
    await answerShellDialog(await acceptedConfirmation, 'Enable')
    expect(await permission.result).toMatchObject({
      ok: true,
      data: { text: 'full access contents' },
    })
    // The desktop pushes the change to open settings pages.
    await expect(fullAccess).toBeChecked()
    expect(await invoke({ operation: 'read', toolCallId: 'fullAccess' })).toMatchObject({
      ok: true,
      data: { text: 'full access contents' },
    })
    calls.fullImport = {
      toolName: 'import_local_files',
      args: { path: fullFolder, targetWorkspaceId: 'target-workspace' },
    }
    const manifest = await invoke({ operation: 'manifest', toolCallId: 'fullImport' })
    if (!manifest.ok || manifest.data.kind !== 'manifest')
      throw new Error('Missing full-access manifest')
    const imported = manifest.data.entries.find((entry) => entry.relativePath === 'file.txt')
    if (!imported) throw new Error('Missing full-access file')
    const chunk = await invoke({
      operation: 'chunk',
      toolCallId: 'fullImport',
      relativePath: imported.relativePath,
      revision: imported.revision,
      offset: 0,
    })
    if (!chunk.ok || chunk.data.kind !== 'chunk') throw new Error('Missing full-access contents')
    expect(Object.values(chunk.data.bytes)).toEqual([...Buffer.from('full access contents')])
    expect(await invoke({ operation: 'read', toolCallId: 'notAuthorized' })).toMatchObject({
      ok: false,
    })
  })

  await test.step('Full file access survives restart, and turning it off brings folder prompts back', async () => {
    await localFiles.close(session)
    session = await localFiles.open(session.desktop.userData)
    expect(await session.preferences()).toMatchObject({ fullFileAccess: true })
    expect(await session.invoke({ operation: 'read', toolCallId: 'fullAccess' })).toMatchObject({
      ok: true,
      data: { text: 'full access contents' },
    })
    await expect(session.fullAccess).toBeChecked()
    await session.fullAccess.click()
    await expect(session.fullAccess).not.toBeChecked()
    const revoked = await session.requestPermission({ operation: 'read', toolCallId: 'fullAccess' })
    await answerShellDialog(revoked.prompt, "Don't allow")
    expect(await revoked.result).toMatchObject({ ok: false })
  })

  await test.step('a failed settings write leaves Full file access off and local files denied', async () => {
    const userData = session.desktop.userData
    const settingsPath = join(userData, 'settings.json')
    const backupPath = `${settingsPath}.backup`
    const saved = JSON.parse(readFileSync(settingsPath, 'utf8'))
    for (const previous of [false, true]) {
      await localFiles.close(session)
      writeFileSync(settingsPath, JSON.stringify({ ...saved, fullFileAccess: previous }))
      session = await localFiles.open(userData)
      await expect(session.fullAccess).toBeChecked({ checked: previous })
      // A directory where the settings file belongs makes the next write fail.
      renameSync(settingsPath, backupPath)
      mkdirSync(settingsPath)
      try {
        await session.fullAccess.click()
        await expect(session.window.getByRole('status')).toHaveText('Not saved')
        await expect(session.fullAccess).not.toBeChecked()
        expect(await session.preferences()).toMatchObject({ fullFileAccess: false })
        expect(await session.invoke({ operation: 'read', toolCallId: 'text' })).toMatchObject({
          ok: false,
        })
      } finally {
        await localFiles.close(session)
        rmSync(settingsPath, { recursive: true, force: true })
        renameSync(backupPath, settingsPath)
      }
    }
  })
})

test('native file access refuses paths swapped or replaced while it reads them', async ({
  localFiles,
}) => {
  const { source, outside, calls } = localFiles
  const { app, invoke, requestPermission } = await localFiles.open()
  const granted = await requestPermission({ operation: 'read', toolCallId: 'directory' })
  await answerShellDialog(granted.prompt, 'Allow folder')
  expect(await granted.result).toMatchObject({ ok: true })

  await test.step('native traversal rejects redirected ancestors and replaced grant identities', async () => {
    const parent = join(realpathSync(source), 'native-parent')
    mkdirSync(parent)
    writeFileSync(join(parent, 'inside.txt'), 'inside')
    symlinkSync(outside, join(realpathSync(source), 'native-link'))
    const result = await app.evaluate(
      async ({ app }, paths) => {
        const { createRequire } = process.getBuiltinModule('node:module')
        const { stat } = process.getBuiltinModule('node:fs/promises')
        const fs = process.getBuiltinModule('node:fs')
        const native = createRequire(`${app.getAppPath()}/package.json`)(
          './dist/native/directory.node'
        ) as {
          openApproved(
            root: string,
            relative: string,
            dev: bigint,
            ino: bigint,
            directory: boolean
          ): Promise<number>
        }
        const root = await stat(paths.source, { bigint: true })
        const denied = async (path: string, ino = root.ino) => {
          try {
            const fd = await native.openApproved(paths.source, path, root.dev, ino, false)
            fs.closeSync(fd)
            return false
          } catch {
            return true
          }
        }
        const valid = await native.openApproved(
          paths.source,
          'native-parent/inside.txt',
          root.dev,
          root.ino,
          false
        )
        const text = fs.readFileSync(valid, 'utf8')
        fs.closeSync(valid)
        return {
          text,
          ancestor: await denied('native-link/private.txt'),
          traversal: await denied('../Reports-other/private.txt'),
          replaced: await denied('native-parent/inside.txt', root.ino + 1n),
          overflow: await denied('native-parent/inside.txt', root.ino + (1n << 64n)),
        }
      },
      { source: realpathSync(source) }
    )
    expect(result).toEqual({
      text: 'inside',
      ancestor: true,
      traversal: true,
      replaced: true,
      overflow: true,
    })
  })

  await test.step('a symlink swapped in after inspection cannot redirect a file read', async () => {
    const file = realpathSync(join(source, 'report.txt'))
    const backup = join(source, 'original-report.txt')
    const other = join(source, 'other.txt')
    writeFileSync(other, 'different file contents')
    await app.evaluate(
      (_electron, paths) => {
        const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
        const original = fs.stat
        const fired: string[] = []
        ;(globalThis as FsPatchRuntime).e2eFsPatch = {
          fired,
          restore: () => {
            fs.stat = original
          },
        }
        fs.stat = (async (...args: Parameters<typeof fs.stat>) => {
          const result = await original(...args)
          if (args[0] === paths.file) {
            fs.stat = original
            await fs.rename(paths.file, paths.backup)
            await fs.symlink(paths.other, paths.file)
            fired.push('swapped')
          }
          return result
        }) as typeof fs.stat
      },
      { file, backup, other }
    )
    let fired: string[] = []
    try {
      expect(await invoke({ operation: 'read', toolCallId: 'text' })).toMatchObject({ ok: false })
    } finally {
      fired = await restoreFsPatch(app)
      if (fired.includes('swapped')) {
        rmSync(file)
        renameSync(backup, file)
      }
      rmSync(other)
    }
    expect(fired).toEqual(['swapped'])
  })

  await test.step('swapping an ancestor cannot redirect directory enumeration', async () => {
    const parent = join(realpathSync(source), 'parent')
    const child = join(parent, 'child')
    const backup = join(realpathSync(source), 'parent-backup')
    const otherParent = join(outside, 'parent')
    mkdirSync(child, { recursive: true })
    mkdirSync(join(otherParent, 'child'), { recursive: true })
    writeFileSync(join(child, 'allowed.txt'), 'allowed')
    writeFileSync(join(otherParent, 'child', 'private.txt'), 'outside')
    calls.ancestorRace = { toolName: 'read_local_file', args: { path: child } }
    await app.evaluate(
      (_electron, paths) => {
        const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
        const originalLstat = fs.lstat
        const originalRealpath = fs.realpath
        const fired: string[] = []
        let swapped = false
        const unswap = async () => {
          if (!swapped) return
          swapped = false
          await fs.rm(paths.parent)
          await fs.rename(paths.backup, paths.parent)
        }
        ;(globalThis as FsPatchRuntime).e2eFsPatch = {
          fired,
          restore: async () => {
            fs.lstat = originalLstat
            fs.realpath = originalRealpath
            await unswap()
          },
        }
        fs.lstat = (async (...args: Parameters<typeof fs.lstat>) => {
          const result = await originalLstat(...args)
          if (args[0] === paths.child) {
            fs.lstat = originalLstat
            await fs.rename(paths.parent, paths.backup)
            await fs.symlink(paths.otherParent, paths.parent)
            swapped = true
            fired.push('swapped')
          }
          return result
        }) as typeof fs.lstat
        fs.realpath = (async (...args: Parameters<typeof fs.realpath>) => {
          if (args[0] === paths.child) await unswap()
          return originalRealpath(...args)
        }) as typeof fs.realpath
      },
      { parent, child, backup, otherParent }
    )
    let fired: string[] = []
    try {
      expect(await invoke({ operation: 'read', toolCallId: 'ancestorRace' })).toMatchObject({
        ok: true,
        data: { entries: [{ name: 'allowed.txt', kind: 'file' }] },
      })
    } finally {
      fired = await restoreFsPatch(app)
      rmSync(parent, { recursive: true, force: true })
      rmSync(otherParent, { recursive: true, force: true })
    }
    expect(fired).toEqual(['swapped'])
  })

  await test.step('a replaced directory cannot return a listing for its old contents', async () => {
    const directory = join(realpathSync(source), 'replace-during-read')
    const backup = join(realpathSync(source), 'previous-directory')
    mkdirSync(directory)
    writeFileSync(join(directory, 'old.txt'), 'old contents')
    calls.directoryReplaced = { toolName: 'read_local_file', args: { path: directory } }
    await app.evaluate(
      (_electron, paths) => {
        const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
        const original = fs.lstat
        const fired: string[] = []
        ;(globalThis as FsPatchRuntime).e2eFsPatch = {
          fired,
          restore: () => {
            fs.lstat = original
          },
        }
        fs.lstat = (async (...args: Parameters<typeof fs.lstat>) => {
          if (args[0] === paths.directory) {
            fs.lstat = original
            await fs.rename(paths.directory, paths.backup)
            await fs.mkdir(paths.directory)
            await fs.writeFile(`${paths.directory}/new.txt`, 'new contents')
            fired.push('replaced')
          }
          return original(...args)
        }) as typeof fs.lstat
      },
      { directory, backup }
    )
    let fired: string[] = []
    try {
      expect(await invoke({ operation: 'read', toolCallId: 'directoryReplaced' })).toMatchObject({
        ok: false,
      })
    } finally {
      fired = await restoreFsPatch(app)
      rmSync(directory, { recursive: true, force: true })
      rmSync(backup, { recursive: true, force: true })
    }
    expect(fired).toEqual(['replaced'])
  })

  await test.step('cancelling a directory read prevents its contents from returning', async () => {
    const path = realpathSync(join(source, 'empty'))
    calls.directoryCancel = { toolName: 'read_local_file', args: { path } }
    await app.evaluate((_electron, path) => {
      const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
      const original = fs.lstat
      const fired: string[] = []
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      ;(globalThis as FsPatchRuntime).e2eFsPatch = {
        fired,
        restore: () => {
          fs.lstat = original
          release()
        },
      }
      fs.lstat = (async (...args: Parameters<typeof fs.lstat>) => {
        const result = await original(...args)
        if (args[0] === path) {
          fs.lstat = original
          fired.push('held')
          await held
        }
        return result
      }) as typeof fs.lstat
    }, path)
    const reading = invoke({ operation: 'read', toolCallId: 'directoryCancel' })
    void reading.catch(() => {})
    try {
      await expect
        .poll(() =>
          app.evaluate(() => (globalThis as FsPatchRuntime).e2eFsPatch?.fired.includes('held'))
        )
        .toBe(true)
      await invoke({ operation: 'cancel', toolCallId: 'directoryCancel' })
    } finally {
      await restoreFsPatch(app)
    }
    expect(await reading).toMatchObject({ ok: false })
  })
})

test('remembered folder grants survive restart until forgotten, replaced, or signed out', async ({
  localFiles,
}) => {
  const { root, source } = localFiles
  let session = await localFiles.open()
  const restart = async () => {
    await localFiles.close(session)
    session = await localFiles.open(session.desktop.userData)
  }
  const answerTextRead = async (button: 'Allow folder' | "Don't allow") => {
    const permission = await session.requestPermission({ operation: 'read', toolCallId: 'text' })
    await answerShellDialog(permission.prompt, button)
    return permission.result
  }
  expect(await answerTextRead('Allow folder')).toMatchObject({ ok: true })

  await test.step('a folder grant survives restarting the app', async () => {
    await restart()
    expect(await session.invoke({ operation: 'read', toolCallId: 'text' })).toMatchObject({
      ok: true,
    })
  })

  await test.step('forgetting a folder revokes native reads and survives restart', async () => {
    await session.window.getByRole('button', { name: 'Forget folders', exact: true }).click()
    await expect(
      session.window.getByRole('button', { name: 'Forgotten', exact: true })
    ).toBeVisible()
    await restart()
    expect(await answerTextRead('Allow folder')).toMatchObject({ ok: true })
  })

  await test.step('a remembered grant does not follow a replaced folder after restart', async () => {
    await localFiles.close(session)
    renameSync(source, join(root, 'Original-reports'))
    mkdirSync(source)
    writeFileSync(join(source, 'report.txt'), 'replacement contents')
    session = await localFiles.open(session.desktop.userData)
    expect(await answerTextRead("Don't allow")).toMatchObject({ ok: false })
    rmSync(source, { recursive: true })
    renameSync(join(root, 'Original-reports'), source)
    expect(await answerTextRead('Allow folder')).toMatchObject({ ok: true })
  })

  await test.step('sign-out revokes remembered grants and Full file access before the next account session', async () => {
    const { app, window, fullAccess } = session
    await fullAccess.click()
    await expect(fullAccess).toBeChecked()
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()
        ?.items.flatMap((entry) => entry.submenu?.items ?? [])
        .find((entry) => entry.label === 'Sign Out')
      if (!item) throw new Error('Sign Out menu item missing')
      item.click()
    })
    await expect(window).toHaveURL(`${localFiles.origin}/login`)
    localFiles.signIn()
    await window.goto(`${localFiles.origin}/`)
    await expect
      .poll(() =>
        window.evaluate(
          async () =>
            (
              await (globalThis as DesktopBridge).simDesktop.localFilesystem?.({
                operation: 'list_mounts',
              })
            )?.ok
        )
      )
      .toBe(true)
    await expect.poll(() => session.preferences()).toMatchObject({ fullFileAccess: false })
    expect(await answerTextRead("Don't allow")).toMatchObject({ ok: false })
  })
})
