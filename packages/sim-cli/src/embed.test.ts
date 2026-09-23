import { afterEach, describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from './embed'
import { sleep } from './helpers'

const IDENTITY = {
  endpoint: 'https://sim.internal.test',
  apiKey: 'sk-embedded-test',
  workspaceId: 'a2e3ab27-2f9d-4b8a-a2f2-3c47a1b0c9d1',
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runEmbeddedCli', () => {
  it('supports document tagging and filtered knowledge search without inventing chunk tag writes', async () => {
    const transport = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ data: { id: 'resource-1' } }))
    const identity = { ...IDENTITY, transport }
    const tag = await runEmbeddedCli(
      ['knowledge', 'documents', 'update', 'kb-1', 'doc-1', '--tag1', 'billing'],
      identity
    )
    expect(tag.exitCode).toBe(0)
    expect(transport.mock.calls[0]?.[0]).toContain('/knowledge/kb-1/documents/doc-1')
    expect(JSON.parse(transport.mock.calls[0]?.[1]?.body)).toEqual({
      workspaceId: IDENTITY.workspaceId,
      tag1: 'billing',
    })
    const create = await runEmbeddedCli(
      ['knowledge', 'chunks', 'create', 'kb-1', 'doc-1', '--content', 'Refunds need approval.'],
      identity
    )
    expect(create.exitCode).toBe(0)
    expect(JSON.parse(transport.mock.calls[1]?.[1]?.body)).toEqual({
      workspaceId: IDENTITY.workspaceId,
      content: 'Refunds need approval.',
    })
    const filter = [{ tagName: 'topic', fieldType: 'text', operator: 'eq', value: 'billing' }]
    const searchData = { results: [], totalResults: 0, rerankerStatus: 'unavailable' }
    transport.mockResolvedValueOnce(jsonResponse({ data: searchData }))
    const search = await runEmbeddedCli(
      [
        'knowledge',
        'search',
        '--kb',
        'kb-1',
        '--query',
        'refund approval',
        '--search-mode',
        'hybrid',
        '--tag-filters',
        JSON.stringify(filter),
      ],
      identity
    )
    expect(search.exitCode, search.stderr).toBe(0)
    expect(JSON.parse(search.stdout)).toEqual(searchData)
    expect(JSON.parse(transport.mock.calls[2]?.[1]?.body)).toMatchObject({
      query: 'refund approval',
      searchMode: 'hybrid',
      tagFilters: filter,
    })
    const invalid = await runEmbeddedCli(
      ['knowledge', 'chunks', 'create', 'kb-1', 'doc-1', '--content', 'text', '--tag1', 'billing'],
      identity
    )
    expect(invalid.exitCode).toBe(1)
    expect(invalid.stderr).toContain("unknown option '--tag1'")
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it('cancels only the selected embedded invocation and refuses new requests after Stop', async () => {
    const controller = new AbortController()
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const transport = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      started()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })
    const running = runEmbeddedCli(['workflows', 'list'], {
      ...IDENTITY,
      signal: controller.signal,
      transport,
    })
    await ready
    const independent = runEmbeddedCli(['workflows', 'list'], {
      ...IDENTITY,
      transport: async () => jsonResponse({ data: [], nextCursor: null }),
    })
    controller.abort(new Error('Stopped'))
    expect((await running).exitCode).toBe(1)
    expect((await independent).exitCode).toBe(0)
    expect(
      (
        await runEmbeddedCli(['workflows', 'list'], {
          ...IDENTITY,
          signal: controller.signal,
          transport,
        })
      ).exitCode
    ).toBe(1)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('runs a real command in-process with the injected identity, capturing stdout', async () => {
    const seen: { url: string; auth: string | null }[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      seen.push({ url, auth: new Headers(init?.headers).get('x-api-key') })
      return jsonResponse({ data: [{ id: 'wf-1', name: 'Email digest' }], nextCursor: null })
    })

    const result = await runEmbeddedCli(['--output', 'json', 'workflows', 'list'], IDENTITY)

    expect(result.exitCode).toBe(0)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0].url).toContain('https://sim.internal.test/api/v2/workflows')
    expect(seen[0].url).toContain(IDENTITY.workspaceId)
    expect(seen[0].auth).toBe(IDENTITY.apiKey)
    expect(JSON.parse(result.stdout)).toEqual({
      data: [{ id: 'wf-1', name: 'Email digest' }],
      nextCursor: null,
    })
  })

  it('returns a parse error as a rendered failure, never killing the host process', async () => {
    const result = await runEmbeddedCli(['no-such-command'], IDENTITY)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  it('reports an API error the way the terminal CLI does', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid or expired API key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
    )
    const result = await runEmbeddedCli(['--output', 'json', 'workflows', 'list'], IDENTITY)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid or expired API key')
  })

  it('isolates concurrent invocations (identity and output never interleave)', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input))
      // Answer each invocation with its own workspace id so cross-talk is visible.
      const workspaceId = url.searchParams.get('workspaceId') ?? 'missing'
      await sleep(workspaceId.endsWith('1') ? 30 : 5)
      return jsonResponse({ data: [{ id: workspaceId, name: workspaceId }], nextCursor: null })
    })
    const wsA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    const wsB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
    const [a, b] = await Promise.all([
      runEmbeddedCli(['--output', 'json', 'workflows', 'list'], { ...IDENTITY, workspaceId: wsA }),
      runEmbeddedCli(['--output', 'json', 'workflows', 'list'], { ...IDENTITY, workspaceId: wsB }),
    ])
    expect(JSON.parse(a.stdout).data[0].id).toBe(wsA)
    expect(JSON.parse(b.stdout).data[0].id).toBe(wsB)
  })
})

describe('embedded artifact destinations', () => {
  it.each([undefined, 'relative.zip', '/tmp/explicit.zip'])(
    'returns the usable artifact path for %s without inheriting host cwd',
    async (requested) => {
      const files = new Map<string, Uint8Array>()
      const expected =
        requested === '/tmp/explicit.zip'
          ? requested
          : `/home/user/${requested ?? 'Handbook.simkb.zip'}`
      const bytes = new Uint8Array([80, 75, 3, 4])
      const result = await runEmbeddedCli(
        ['knowledge', 'export', 'kb', ...(requested ? ['--output-file', requested] : [])],
        {
          ...IDENTITY,
          transport: async () =>
            new Response(bytes, {
              headers: {
                'content-type': 'application/zip',
                'content-disposition': 'attachment; filename="Handbook.simkb.zip"',
              },
            }),
        },
        {
          workingDirectory: '/home/user',
          writeFile: async (path, body) => {
            files.set(path, new Uint8Array(await new Response(body).arrayBuffer()))
          },
        }
      )
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).path).toBe(expected)
      expect(files.get(expected)).toEqual(bytes)
      expect(files.size).toBe(1)
      expect(result.stdout).not.toContain(process.cwd())
    }
  )

  it('uses the same destination contract for downloads and @path readback', async () => {
    const files = new Map<string, Uint8Array>()
    const body = JSON.stringify({ title: 'downloaded' })
    const transport = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ data: { id: 'tool-result' } })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    })
    const options = {
      workingDirectory: '/home/user',
      writeFile: async (path: string, stream: ReadableStream<Uint8Array>) => {
        files.set(path, new Uint8Array(await new Response(stream).arrayBuffer()))
      },
      readFile: async (path: string) => {
        const file = files.get(path)
        if (!file) throw new Error('missing')
        return file
      },
    }
    const saved = await runEmbeddedCli(
      ['files', 'get', 'file', '--output-file', 'input.json'],
      { ...IDENTITY, transport },
      options
    )
    expect(saved.exitCode, saved.stderr).toBe(0)
    const path = JSON.parse(saved.stdout).path
    expect(path).toBe('/home/user/input.json')
    const consumed = await runEmbeddedCli(
      ['tables', 'rows', 'create', 'table', '--data', `@${path}`],
      { ...IDENTITY, transport },
      options
    )
    expect(consumed.exitCode, consumed.stderr).toBe(0)
    expect(JSON.parse(String(transport.mock.calls.at(-1)?.[1]?.body)).data).toEqual({
      title: 'downloaded',
    })
  })

  it('refuses archive bytes in embedded stdout and has no server-disk fallback', async () => {
    const identity = {
      ...IDENTITY,
      transport: async () =>
        new Response(new Uint8Array([80, 75]), { headers: { 'content-type': 'application/zip' } }),
    }
    const stdout = await runEmbeddedCli(['knowledge', 'export', 'kb', '-o', '-'], identity)
    expect(stdout.exitCode).toBe(1)
    expect(stdout.stdout).toBe('')
    const noWriter = await runEmbeddedCli(['knowledge', 'export', 'kb'], identity)
    expect(noWriter.exitCode).toBe(1)
    expect(noWriter.stderr).toContain('no machine to write to')
  })
})
