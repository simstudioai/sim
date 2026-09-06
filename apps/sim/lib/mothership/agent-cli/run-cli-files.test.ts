/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { read, write, open } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), open: vi.fn() }))
vi.mock('@/lib/execution/remote-sandbox/session-files', () => ({
  readSessionSandboxFile: read,
  writeSessionSandboxFile: write,
  resolveSessionPath: (path: string) => `/home/user/${path}`,
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-snapshot', () => ({
  openSessionFileSnapshot: open,
}))

import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import { applySink } from '@/lib/mothership/agent-cli/sink'

const IDENTITY = { endpoint: 'https://sim.test', apiKey: 'test', workspaceId: 'workspace' }

describe('the CLI owns workbench file semantics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    read.mockResolvedValue({ outcome: 'error', detail: 'Workbench unavailable' })
    open.mockRejectedValue(new Error('Workbench unavailable'))
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['inline', 'saved'] as const)(
    'preserves terminal escapes in %s file output',
    async (mode) => {
      const content = 'build started\r\n\u001b[31mfailed\u001b[0m\tjob=compile\n'
      const transport = async () =>
        new Response(content, {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      const result = await runCli(['files', 'get', 'build-log'], { ...IDENTITY, transport }, 'chat')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(content)
      expect(read).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
      if (mode === 'saved') {
        write.mockResolvedValue({ outcome: 'written', path: '/home/user/build.log' })
        const saved = await applySink({ kind: 'sandbox-file', path: 'build.log' }, 'chat', result)
        expect(saved.exitCode).toBe(0)
        expect(saved.stdout).toContain('stdout written')
        expect(write).toHaveBeenCalledExactlyOnceWith('chat', 'build.log', content, undefined, {
          overwrite: true,
        })
      }
    }
  )

  it('does not touch the workbench for literal text, help or invalid commands', async () => {
    const requests: Request[] = []
    const identity = {
      endpoint: 'https://sim.test',
      apiKey: 'test',
      workspaceId: 'workspace',
      transport: async (input: string | URL | Request, init?: RequestInit) => {
        requests.push(new Request(input, init))
        return Response.json({ data: { id: 'workflow', name: '@marketing' } })
      },
    }
    expect(
      (await runCli(['workflows', 'create', '--name', '@marketing'], identity, 'chat')).exitCode
    ).toBe(0)
    expect(JSON.parse(await requests[0]!.text()).name).toBe('@marketing')
    expect(
      (await runCli(['workflows', 'create', '--name', '@marketing', '--help'], identity, 'chat'))
        .exitCode
    ).toBe(0)
    expect((await runCli(['not-a-command', '@input.json'], identity, 'chat')).exitCode).toBe(1)
    expect(requests).toHaveLength(1)
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('resolves JSON flags on demand and isolates simultaneous same-path reads by invocation', async () => {
    const requests: Request[] = []
    read.mockImplementation(async (session: string, path: string) => {
      expect(path).toBe('input.json')
      return {
        outcome: 'read',
        content: Buffer.from(JSON.stringify({ session })).toString('base64'),
      }
    })
    const transport = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json({ runId: 'run', status: 'completed' })
    }
    const results = await Promise.all(
      ['first', 'second'].map((session) =>
        runCli(
          ['workflows', 'run', 'workflow', '--input=@input.json'],
          { ...IDENTITY, transport },
          session
        )
      )
    )
    expect(results.map((result) => result.exitCode)).toEqual([0, 0])
    expect(
      await Promise.all(
        requests.map(async (request) => JSON.parse(await request.text()).input.session)
      )
    ).toEqual(['first', 'second'])
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('expands list files but leaves escaped list values literal', async () => {
    const requests: URL[] = []
    read.mockResolvedValue({
      outcome: 'read',
      content: Buffer.from('wf-one\nwf-two\n').toString('base64'),
    })
    const transport = async (input: string | URL | Request) => {
      requests.push(new URL(input instanceof Request ? input.url : input))
      return Response.json({ data: [], total: 0 })
    }
    const result = await runCli(
      ['logs', 'list', '--workflow', '@ids.txt', '@@literal'],
      { ...IDENTITY, transport },
      'chat'
    )
    expect(result.exitCode).toBe(0)
    expect(requests[0]?.searchParams.get('workflowIds')).toBe('wf-one,wf-two,@literal')
    expect(read).toHaveBeenCalledExactlyOnceWith('chat', 'ids.txt', 'base64', undefined)
  })

  it.each(['report.bin', '@report.bin', 'constructor', '__proto__'])(
    'uploads %s from one byte snapshot, without requiring host-side @ parsing',
    async (path) => {
      const bytes = Uint8Array.from([0, 255, 128, 13, 10, 195, 0])
      const dispose = vi.fn(async () => {})
      open.mockResolvedValueOnce({
        size: bytes.length,
        stream: async () => new Blob([bytes]).stream(),
        dispose,
      })
      open.mockRejectedValue(new Error('The original file changed'))
      const transport = async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init)
        if (request.url.endsWith('/complete?workspaceId=workspace')) {
          return Response.json({ data: { file: { id: 'file', name: 'report.bin' } } })
        }
        expect(JSON.parse(await request.text()).size).toBe(bytes.length)
        return Response.json({
          data: {
            session: { id: 'upload' },
            uploadToken: 'fixture',
            transfer: { method: 'put', url: 'https://upload.test/bytes', headers: {} },
          },
        })
      }
      const upload = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe('https://upload.test/bytes')
        expect(new Uint8Array(await new Request(input, init).arrayBuffer())).toEqual(bytes)
        return new Response(null, { status: 200 })
      })
      vi.stubGlobal('fetch', upload)
      const result = await runCli(['files', 'upload', path], { ...IDENTITY, transport }, 'chat')
      expect(result, result.stderr).toMatchObject({ exitCode: 0 })
      expect(open).toHaveBeenCalledExactlyOnceWith(
        'chat',
        path.replace(/^@/, ''),
        undefined,
        undefined
      )
      expect(read).not.toHaveBeenCalled()
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(upload).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps parallel same-path upload snapshots and cleanup scoped to their chats', async () => {
    const released: string[] = []
    open.mockImplementation(async (chat: string) => ({
      size: Buffer.byteLength(chat),
      stream: async () => new Blob([chat]).stream(),
      dispose: async () => {
        released.push(chat)
      },
    }))
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      expect(await request.text()).toBe(new URL(request.url).pathname.slice(1))
      return new Response(null, { status: 200 })
    })
    const results = await Promise.all(
      ['first-chat', 'second-chat'].map(async (chat) => {
        const transport = async (input: string | URL | Request, init?: RequestInit) => {
          const request = new Request(input, init)
          if (request.url.includes('/complete?'))
            return Response.json({ data: { file: { id: chat } } })
          expect(JSON.parse(await request.text()).size).toBe(Buffer.byteLength(chat))
          return Response.json({
            data: {
              session: { id: chat },
              uploadToken: 'fixture',
              transfer: { method: 'put', url: `https://upload.test/${chat}`, headers: {} },
            },
          })
        }
        return runCli(['files', 'upload', 'same.bin'], { ...IDENTITY, transport }, chat)
      })
    )
    expect(results.map((result) => result.exitCode)).toEqual([0, 0])
    expect(open).toHaveBeenCalledTimes(2)
    expect(released.sort()).toEqual(['first-chat', 'second-chat'])
  })

  it.each(['outage', 'no-session', 'stopped', 'stdin', 'no-chat'])(
    'refuses %s before the API request and never falls back to server files',
    async (mode) => {
      const controller = new AbortController()
      const transport = vi.fn()
      read.mockImplementation(async () => {
        if (mode === 'stopped') controller.abort(new Error('Stopped'))
        return mode === 'no-session'
          ? { outcome: 'no-session' }
          : { outcome: 'error', detail: 'Workbench unavailable' }
      })
      const result = await runCli(
        ['workflows', 'run', 'workflow', '--input', mode === 'stdin' ? '@-' : '@/etc/hostname'],
        { ...IDENTITY, transport, signal: controller.signal },
        mode === 'no-chat' ? null : 'chat'
      )
      expect(result.exitCode).toBe(1)
      const error = {
        outage: 'Workbench unavailable',
        'no-session': 'No workbench exists',
        stopped: 'Stopped',
        stdin: 'no stdin',
        'no-chat': 'no machine to read from',
      }[mode]
      expect(result.stderr).toContain(error)
      expect(transport).not.toHaveBeenCalled()
      expect(read).toHaveBeenCalledTimes(mode === 'stdin' || mode === 'no-chat' ? 0 : 1)
    }
  )
})
