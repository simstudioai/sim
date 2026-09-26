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

test('native file tools require local consent and reuse only the approved chat and path', async () => {
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
  const authorizedCalls = new Set<string>()
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
        authorizedCalls.add(input.toolCallId)
        if (input.claim) claimed.add(input.toolCallId)
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ...call, chatId: call.chatId ?? 'org-chat' }))
        return
      }
      response
        .writeHead(200, {
          'Content-Type': 'text/html',
          ...(signedIn
            ? { 'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/' }
            : {}),
        })
        .end('<!doctype html><title>Local file fixture</title><h1>Local files</h1>')
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    app = await electron.launch({
      args: ['.'],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        SIM_DESKTOP_ORIGIN: `http://127.0.0.1:${address.port}`,
        SIM_DESKTOP_USER_DATA: join(root, 'profile'),
      },
    })
    const window = await app.firstWindow()
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
    const folderConsent = await folderPrompt
    const queuedRead = invoke({ operation: 'read', toolCallId: 'text' })
    expect(
      await folderConsent.evaluate(() => typeof (globalThis as { simDesktop?: unknown }).simDesktop)
    ).toBe('undefined')
    await folderConsent.getByRole('button', { name: 'Allow for this chat', exact: true }).click()
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
    const runningApp = app
    const requestPermission = async (request: DesktopLocalFileRequest) => {
      const shown = runningApp.waitForEvent('window', { timeout: 10_000 })
      const result = invoke(request)
      void result.catch(() => {})
      const prompt = await shown
      await expect(prompt.getByRole('button', { name: "Don't allow", exact: true })).toBeVisible()
      return { prompt, result }
    }
    await test.step('a folder grant does not authorize another chat or a symlink escape', async () => {
      const otherChat = await requestPermission({ operation: 'read', toolCallId: 'otherChat' })
      const dismissed = otherChat.prompt.waitForEvent('close')
      await otherChat.prompt
        .getByRole('button', { name: "Don't allow", exact: true })
        .press('Escape')
        .catch(() => {})
      await dismissed
      expect(await otherChat.result).toMatchObject({ ok: false })
      symlinkSync(join(outside, 'private.txt'), join(source, 'linked.txt'))
      calls.escape = { toolName: 'read_local_file', args: { path: join(source, 'linked.txt') } }
      const escapedRead = await requestPermission({ operation: 'read', toolCallId: 'escape' })
      await expect(escapedRead.prompt.getByRole('dialog')).toContainText(
        JSON.stringify(realpathSync(join(outside, 'private.txt')))
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
        await stale.prompt.getByRole('button', { name: 'Allow for this chat', exact: true }).click()
        expect(await stale.result).toMatchObject({ ok: false })
      }
    })
    await test.step('a queued call is revalidated even when its folder is already approved', async () => {
      calls.blocker = { toolName: 'read_local_file', args: { path: join(outside, 'private.txt') } }
      calls.queued = { toolName: 'read_local_file', args: { path: join(source, 'report.txt') } }
      const blocker = await requestPermission({ operation: 'read', toolCallId: 'blocker' })
      const queued = invoke({ operation: 'read', toolCallId: 'queued' })
      void queued.catch(() => {})
      await expect.poll(() => authorizedCalls.has('queued')).toBe(true)
      calls.queued = undefined
      await blocker.prompt.getByRole('button', { name: "Don't allow", exact: true }).click()
      expect(await blocker.result).toMatchObject({ ok: false })
      expect(await queued).toMatchObject({ ok: false })
    })
    await test.step('replacing the proposed folder during consent does not expose its new target', async () => {
      const proposed = join(root, 'Proposed')
      mkdirSync(proposed)
      calls.retargeted = { toolName: 'read_local_file', args: { path: proposed } }
      const retargeted = await requestPermission({ operation: 'read', toolCallId: 'retargeted' })
      renameSync(proposed, join(root, 'Original'))
      mkdirSync(proposed)
      writeFileSync(join(proposed, 'unapproved.txt'), 'replacement folder contents')
      await retargeted.prompt
        .getByRole('button', { name: 'Allow for this chat', exact: true })
        .click()
      expect(await retargeted.result).toMatchObject({ ok: false })
    })
    const importPrompt = app.waitForEvent('window')
    const importing = invoke({ operation: 'manifest', toolCallId: 'import' })
    const importConsent = await importPrompt
    await importConsent.getByRole('button', { name: 'Allow for this chat', exact: true }).click()
    const result = await importing
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
    await test.step('import approval is bound to its destination workspace', async () => {
      calls.otherImport = {
        toolName: 'import_local_files',
        args: { path: source, targetWorkspaceId: 'other-workspace' },
      }
      const otherImport = await requestPermission({
        operation: 'manifest',
        toolCallId: 'otherImport',
      })
      await otherImport.prompt.getByRole('button', { name: "Don't allow", exact: true }).click()
      expect(await otherImport.result).toMatchObject({ ok: false })
    })

    await test.step('sign-out revokes chat grants before the next account session', async () => {
      await window.evaluate(async () => {
        await fetch('/api/auth/sign-out', { method: 'POST' })
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
