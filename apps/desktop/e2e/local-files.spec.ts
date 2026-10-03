import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import type { DesktopLocalFileRequest, SimDesktopApi } from '@sim/desktop-bridge'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))

test('native file tools read and import through the installed preload without Sim folder grants', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sim-native-files-e2e-'))
  const source = join(root, 'Reports')
  mkdirSync(join(source, 'empty'), { recursive: true })
  writeFileSync(join(source, 'report.txt'), 'native file contents')
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
  writeFileSync(join(source, 'image.png'), Buffer.from(png, 'base64'))
  let claimed = false
  const calls: Record<string, { toolName: string; args: Record<string, unknown> }> = {
    text: { toolName: 'read_local_file', args: { path: join(source, 'report.txt') } },
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
          JSON.stringify({
            user: { id: 'local-file-user' },
            session: { id: 'local-file-session' },
          })
        )
        return
      }
      if (path === '/api/desktop/tool/authorize') {
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const input = JSON.parse(body)
        const call = calls[input.toolCallId]
        if (!call || (input.claim && claimed)) {
          response.writeHead(call ? 409 : 403, { 'Content-Type': 'application/json' }).end('{}')
          return
        }
        if (input.claim) claimed = true
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ...call, chatId: 'org-chat' }))
        return
      }
      response
        .writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
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
      .poll(async () => (await invoke({ operation: 'read', toolCallId: 'text' })).ok)
      .toBe(true)
    expect(await invoke({ operation: 'read', toolCallId: 'text' })).toMatchObject({
      ok: true,
      data: { representation: 'text', text: 'native file contents' },
    })
    expect(await invoke({ operation: 'read', toolCallId: 'image' })).toMatchObject({
      ok: true,
      data: { observations: [{ mediaType: 'image/png', data: png }] },
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
  } finally {
    await app?.close()
    server?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
