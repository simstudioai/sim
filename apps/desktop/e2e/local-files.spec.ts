import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import type { DesktopLocalFileRequest, SimDesktopApi } from '@sim/desktop-bridge'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))

test('native file tools remember folder consent across chats and restarts until revoked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sim-native-files-e2e-'))
  const source = join(root, 'Reports')
  const outside = join(root, 'Reports-other')
  mkdirSync(outside)
  writeFileSync(join(outside, 'private.txt'), 'outside contents')
  mkdirSync(join(source, 'empty'), { recursive: true })
  writeFileSync(join(source, 'report.txt'), 'native file contents')
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
  writeFileSync(join(source, 'image.png'), Buffer.from(png, 'base64'))
  const claimed = new Set<string>()
  const expireAfterAuthorization = new Set<string>()
  let signedIn = true
  const calls: Record<
    string,
    { toolName: string; args: Record<string, unknown>; chatId?: string } | undefined
  > = {
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
  let server: Server | undefined
  let app: ElectronApplication | undefined
  try {
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/api/auth/get-session') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify(
            signedIn
              ? {
                  user: { id: 'local-file-user' },
                  session: { id: 'local-file-session' },
                }
              : null
          )
        )
        return
      }
      if (path === '/api/auth/sign-out') {
        signedIn = false
        response
          .writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'better-auth.session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
          })
          .end('{}')
        return
      }
      if (path === '/api/desktop/tool/authorize') {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const input = JSON.parse(body)
        const call = calls[input.toolCallId]
        if (!call || (input.claim && claimed.has(input.toolCallId))) {
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
        .end(`<!doctype html><title>Local file fixture</title><h1>Local files</h1>
          <button id="forget" onclick="window.simDesktop.localFilesystem({operation:'list_mounts'}).then(async result => {
            for (const mount of result.data.mounts) await window.simDesktop.localFilesystem({operation:'forget_mount', uri:mount.uri});
            this.textContent='Forgotten';
          })">Forget folders</button>`)
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const launch = () =>
      electron.launch({
        args: ['.', '--use-mock-keychain'],
        cwd: DESKTOP_DIR,
        env: {
          ...process.env,
          SIM_DESKTOP_ORIGIN: `http://127.0.0.1:${address.port}`,
          SIM_DESKTOP_USER_DATA: join(root, 'profile'),
        },
      })
    app = await launch()
    let window = await app.firstWindow()
    await expect(window.getByRole('heading')).toHaveText('Local files')
    const invoke = (input: DesktopLocalFileRequest) =>
      window.evaluate(async (request) => {
        const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
        if (!api.localFiles) throw new Error('Native file bridge missing')
        return api.localFiles(request)
      }, input)
    await expect
      .poll(() =>
        window.evaluate(async () => {
          const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
          return (await api.localFilesystem?.({ operation: 'list_mounts' }))?.ok
        })
      )
      .toBe(true)
    await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
      await api.settings.setPreference('browserEnabled', false)
      await api.settings.setPreference('terminalEnabled', false)
    })
    const deniedPrompt = app.waitForEvent('window', { timeout: 10_000 })
    const deniedRead = invoke({ operation: 'read', toolCallId: 'text' })
    void deniedRead.catch(() => {})
    const denial = await deniedPrompt
    await expect(denial.getByRole('button', { name: "Don't allow", exact: true })).toBeFocused()
    await denial.screenshot({
      path:
        process.env.DESKTOP_LOCAL_FILES_REPORT_PATH ??
        test.info().outputPath('local-file-consent.png'),
    })
    await denial.getByRole('button', { name: "Don't allow", exact: true }).click()
    expect(await deniedRead).toMatchObject({ ok: false })

    const folderPrompt = app.waitForEvent('window')
    const folderRead = invoke({ operation: 'read', toolCallId: 'directory' })
    void folderRead.catch(() => {})
    const folderConsent = await folderPrompt
    const queuedRead = invoke({ operation: 'read', toolCallId: 'text' })
    void queuedRead.catch(() => {})
    expect(
      await folderConsent.evaluate(() => typeof (globalThis as { simDesktop?: unknown }).simDesktop)
    ).toBe('undefined')
    await folderConsent.getByRole('button', { name: 'Allow folder', exact: true }).click()
    expect(await folderRead).toMatchObject({ ok: true, data: { representation: 'directory' } })
    expect(await queuedRead).toMatchObject({ ok: true, data: { text: 'native file contents' } })
    const canonicalRequest = {
      operation: 'read' as const,
      toolCallId: 'text',
      path: join(outside, 'private.txt'),
    }
    expect(await invoke(canonicalRequest)).toMatchObject({
      ok: true,
      data: { representation: 'text', text: 'native file contents' },
    })
    expect(await invoke({ operation: 'read', toolCallId: 'image' })).toMatchObject({
      ok: true,
      data: { observations: [{ mediaType: 'image/png', data: png }] },
    })
    const requestPermission = async (request: DesktopLocalFileRequest) => {
      if (!app) throw new Error('Desktop app is not running')
      const shown = app.waitForEvent('window', { timeout: 10_000 })
      const result = invoke(request)
      void result.catch(() => {})
      const prompt = await shown
      await expect(prompt.getByRole('button', { name: "Don't allow", exact: true })).toBeVisible()
      return { prompt, result }
    }
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
      const escapedRead = await requestPermission({ operation: 'read', toolCallId: 'escape' })
      await expect(escapedRead.prompt.getByRole('dialog')).toContainText(
        JSON.stringify(realpathSync(outside))
      )
      await escapedRead.prompt.getByRole('button', { name: "Don't allow", exact: true }).click()
      expect(await escapedRead.result).toMatchObject({ ok: false })
      rmSync(join(source, 'linked.txt'))
    })
    await test.step('cancelled calls and changed arguments cannot acquire a grant', async () => {
      for (const changed of [false, true]) {
        calls.stale = { toolName: 'read_local_file', args: { path: join(outside, 'private.txt') } }
        const stale = await requestPermission({ operation: 'read', toolCallId: 'stale' })
        if (changed) calls.stale.args.path = join(source, 'report.txt')
        else calls.stale = undefined
        await stale.prompt.getByRole('button', { name: 'Allow folder', exact: true }).click()
        expect(await stale.result).toMatchObject({ ok: false })
      }
    })
    await test.step('a symlink replacement cannot redirect an inspected file', async () => {
      const file = realpathSync(join(source, 'report.txt'))
      const backup = join(source, 'original-report.txt')
      const other = join(source, 'other.txt')
      writeFileSync(other, 'different file contents')
      await app?.evaluate(
        (_electron, paths) => {
          const fs = process.getBuiltinModule(
            'node:fs/promises'
          ) as typeof import('node:fs/promises')
          const original = fs.stat
          fs.stat = (async (...args: Parameters<typeof fs.stat>) => {
            const result = await original(...args)
            if (args[0] === paths.file) {
              fs.stat = original
              await fs.rename(paths.file, paths.backup)
              await fs.symlink(paths.other, paths.file)
            }
            return result
          }) as typeof fs.stat
        },
        { file, backup, other }
      )
      try {
        expect(await invoke({ operation: 'read', toolCallId: 'text' })).toMatchObject({ ok: false })
      } finally {
        rmSync(file)
        renameSync(backup, file)
        rmSync(other)
      }
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
      await app?.evaluate(
        (_electron, paths) => {
          const fs = process.getBuiltinModule(
            'node:fs/promises'
          ) as typeof import('node:fs/promises')
          const originalStat = fs.lstat
          const originalRealpath = fs.realpath
          let swapped = false
          const restore = async () => {
            fs.lstat = originalStat
            fs.realpath = originalRealpath
            if (swapped) {
              await fs.rm(paths.parent)
              await fs.rename(paths.backup, paths.parent)
              swapped = false
            }
          }
          ;(
            globalThis as typeof globalThis & { restoreLocalFileRace?: () => Promise<void> }
          ).restoreLocalFileRace = restore
          fs.lstat = (async (...args: Parameters<typeof fs.lstat>) => {
            const result = await originalStat(...args)
            if (args[0] === paths.child) {
              fs.lstat = originalStat
              await fs.rename(paths.parent, paths.backup)
              await fs.symlink(paths.otherParent, paths.parent)
              swapped = true
            }
            return result
          }) as typeof fs.lstat
          fs.realpath = (async (...args: Parameters<typeof fs.realpath>) => {
            if (swapped && args[0] === paths.child) await restore()
            return originalRealpath(...args)
          }) as typeof fs.realpath
        },
        { parent, child, backup, otherParent }
      )
      try {
        expect(await invoke({ operation: 'read', toolCallId: 'ancestorRace' })).toMatchObject({
          ok: true,
          data: { entries: [{ name: 'allowed.txt', kind: 'file' }] },
        })
      } finally {
        await app?.evaluate(async () => {
          const runtime = globalThis as typeof globalThis & {
            restoreLocalFileRace?: () => Promise<void>
          }
          await runtime.restoreLocalFileRace?.()
          runtime.restoreLocalFileRace = undefined
        })
        rmSync(parent, { recursive: true, force: true })
        rmSync(otherParent, { recursive: true, force: true })
      }
    })
    await test.step('cancelling after a file opens prevents its contents from returning', async () => {
      await app?.evaluate(
        (_electron, path) => {
          const fs = process.getBuiltinModule(
            'node:fs/promises'
          ) as typeof import('node:fs/promises')
          const original = fs.open
          fs.open = async (...args: Parameters<typeof fs.open>) => {
            const handle = await original(...args)
            if (args[0] === path) {
              fs.open = original
              await new Promise<void>((resolve) => {
                ;(
                  globalThis as typeof globalThis & { releaseLocalFileRead?: () => void }
                ).releaseLocalFileRead = resolve
              })
            }
            return handle
          }
        },
        realpathSync(join(source, 'report.txt'))
      )
      const reading = invoke({ operation: 'read', toolCallId: 'text' })
      void reading.catch(() => {})
      try {
        await expect
          .poll(() =>
            app?.evaluate(
              () =>
                typeof (globalThis as typeof globalThis & { releaseLocalFileRead?: () => void })
                  .releaseLocalFileRead === 'function'
            )
          )
          .toBe(true)
        await invoke({ operation: 'cancel', toolCallId: 'text' })
      } finally {
        await app?.evaluate(() => {
          const runtime = globalThis as typeof globalThis & { releaseLocalFileRead?: () => void }
          runtime.releaseLocalFileRead?.()
          runtime.releaseLocalFileRead = undefined
        })
      }
      expect(await reading).toMatchObject({ ok: false })
    })
    await test.step('cancelling in the renderer closes consent without remembering access', async () => {
      calls.cancelled = {
        toolName: 'read_local_file',
        args: { path: join(outside, 'private.txt') },
      }
      const cancelled = await requestPermission({ operation: 'read', toolCallId: 'cancelled' })
      const closed = cancelled.prompt.waitForEvent('close', { timeout: 5000 })
      await window.evaluate(async () => {
        const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
        await api.localFiles?.({ operation: 'cancel', toolCallId: 'cancelled' })
      })
      await closed
      expect(await cancelled.result).toMatchObject({ ok: false })
      const again = await requestPermission({ operation: 'read', toolCallId: 'cancelled' })
      await again.prompt.getByRole('button', { name: "Don't allow", exact: true }).click()
      expect(await again.result).toMatchObject({ ok: false })
    })
    await test.step('consent escapes direction controls in folder names', async () => {
      const folder = join(root, 'Bidi\u061c\u200e\u200f')
      mkdirSync(folder)
      calls.bidi = { toolName: 'read_local_file', args: { path: folder } }
      const bidi = await requestPermission({ operation: 'read', toolCallId: 'bidi' })
      await expect(bidi.prompt.getByRole('dialog')).toContainText('Bidi\\u061c\\u200e\\u200f')
      await bidi.prompt.getByRole('button', { name: "Don't allow", exact: true }).click()
      expect(await bidi.result).toMatchObject({ ok: false })
    })
    await test.step('an unanswered prompt does not block approved folders', async () => {
      calls.blocker = { toolName: 'read_local_file', args: { path: join(outside, 'private.txt') } }
      const blocker = await requestPermission({ operation: 'read', toolCallId: 'blocker' })
      expect(await invoke({ operation: 'read', toolCallId: 'text' })).toMatchObject({ ok: true })
      await blocker.prompt.getByRole('button', { name: "Don't allow", exact: true }).click()
      expect(await blocker.result).toMatchObject({ ok: false })
    })
    await test.step('cancelled calls cannot reuse an approved folder', async () => {
      calls.expired = { toolName: 'read_local_file', args: { path: join(source, 'report.txt') } }
      expireAfterAuthorization.add('expired')
      expect(await invoke({ operation: 'read', toolCallId: 'expired' })).toMatchObject({
        ok: false,
      })
    })
    await test.step('replacing the proposed folder during consent does not expose its new target', async () => {
      const proposed = join(root, 'Proposed')
      mkdirSync(proposed)
      calls.retargeted = { toolName: 'read_local_file', args: { path: proposed } }
      const retargeted = await requestPermission({ operation: 'read', toolCallId: 'retargeted' })
      renameSync(proposed, join(root, 'Original'))
      mkdirSync(proposed)
      writeFileSync(join(proposed, 'unapproved.txt'), 'replacement folder contents')
      await retargeted.prompt.getByRole('button', { name: 'Allow folder', exact: true }).click()
      expect(await retargeted.result).toMatchObject({ ok: false })
    })
    const result = await invoke({ operation: 'manifest', toolCallId: 'import' })
    if (!result.ok || result.data.kind !== 'manifest') throw new Error(JSON.stringify(result))
    expect(result.data.targetWorkspaceId).toBe('target-workspace')
    expect(result.data.entries.map((entry) => entry.relativePath)).toEqual([
      '',
      'empty',
      'image.png',
      'report.txt',
    ])
    const file = result.data.entries.find((entry) => entry.relativePath === 'report.txt')
    if (!file) throw new Error('Missing import file')
    const chunk = await invoke({
      operation: 'chunk',
      toolCallId: 'import',
      relativePath: file.relativePath,
      revision: file.revision,
      offset: 0,
    })
    if (!chunk.ok || chunk.data.kind !== 'chunk') throw new Error(JSON.stringify(chunk))
    expect(Object.values(chunk.data.bytes)).toEqual([...Buffer.from('native file contents')])
    expect(chunk.data.eof).toBe(true)
    expect(
      await window.evaluate(
        async (input) => {
          const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
          const response = await api.localFiles?.(input)
          if (!response?.ok || response.data.kind !== 'chunk')
            throw new Error('Missing native chunk')
          const file = new File([new Uint8Array(response.data.bytes)], 'report.txt')
          return file.text()
        },
        {
          operation: 'chunk' as const,
          toolCallId: 'import',
          relativePath: file.relativePath,
          revision: file.revision,
          offset: 0,
        }
      )
    ).toBe('native file contents')
    expect(await invoke({ operation: 'manifest', toolCallId: 'import' })).toMatchObject({
      ok: false,
      code: 'ALREADY_STARTED',
    })
    await test.step('an approved folder permits imports without repeated destination prompts', async () => {
      calls.otherImport = {
        toolName: 'import_local_files',
        args: { path: source, targetWorkspaceId: 'other-workspace' },
      }
      expect(await invoke({ operation: 'manifest', toolCallId: 'otherImport' })).toMatchObject({
        ok: true,
      })
    })
    await test.step('folder permissions survive restarting the desktop app', async () => {
      await app?.close()
      app = await launch()
      window = await app.firstWindow()
      await expect(window.getByRole('heading')).toHaveText('Local files')
      expect(await invoke({ operation: 'read', toolCallId: 'text' })).toMatchObject({ ok: true })
    })
    await test.step('forgetting a folder revokes native reads and survives restart', async () => {
      await window.getByRole('button', { name: 'Forget folders', exact: true }).click()
      await expect(window.getByRole('button', { name: 'Forgotten', exact: true })).toBeVisible()
      await app?.close()
      app = await launch()
      window = await app.firstWindow()
      await expect(window.getByRole('heading')).toHaveText('Local files')
      const revoked = await requestPermission({ operation: 'read', toolCallId: 'text' })
      await revoked.prompt.getByRole('button', { name: 'Allow folder', exact: true }).click()
      expect(await revoked.result).toMatchObject({ ok: true })
    })

    await test.step('a remembered grant does not follow a replaced folder after restart', async () => {
      await app?.close()
      renameSync(source, join(root, 'Original-reports'))
      mkdirSync(source)
      writeFileSync(join(source, 'report.txt'), 'replacement contents')
      app = await launch()
      window = await app.firstWindow()
      await expect(window.getByRole('heading')).toHaveText('Local files')
      const replaced = await requestPermission({ operation: 'read', toolCallId: 'text' })
      await replaced.prompt.getByRole('button', { name: "Don't allow", exact: true }).click()
      expect(await replaced.result).toMatchObject({ ok: false })
      rmSync(source, { recursive: true })
      renameSync(join(root, 'Original-reports'), source)
      const restored = await requestPermission({ operation: 'read', toolCallId: 'text' })
      await restored.prompt.getByRole('button', { name: 'Allow folder', exact: true }).click()
      expect(await restored.result).toMatchObject({ ok: true })
    })

    await test.step('sign-out revokes remembered grants before the next account session', async () => {
      await app?.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()
          ?.items.flatMap((entry) => entry.submenu?.items ?? [])
          .find((entry) => entry.label === 'Sign Out')
        if (!item) throw new Error('Sign Out menu item missing')
        item.click()
      })
      await expect(window).toHaveURL(`http://127.0.0.1:${address.port}/login`)
      signedIn = true
      await window.goto(`http://127.0.0.1:${address.port}/`)
      await expect
        .poll(() =>
          window.evaluate(async () => {
            const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
            return (await api.localFilesystem?.({ operation: 'list_mounts' }))?.ok
          })
        )
        .toBe(true)
      const revoked = await requestPermission({ operation: 'read', toolCallId: 'text' })
      await revoked.prompt.getByRole('button', { name: "Don't allow", exact: true }).click()
      expect(await revoked.result).toMatchObject({ ok: false })
    })
  } finally {
    await app?.close()
    server?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
