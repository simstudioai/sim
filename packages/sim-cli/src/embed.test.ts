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

  it('workbench discovery describes its supplied identity without teaching interactive setup', async () => {
    const transport = vi.fn()
    const identity = { ...IDENTITY, transport }
    const help = await runEmbeddedCli(['--help'], identity, { workbench: true })
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain('This chat supplies')
    expect(help.stdout).toContain('--async')
    expect(help.stdout).not.toContain('--profile')
    expect(help.stdout).not.toContain('sim login')
    expect(help.stdout).not.toContain('configure')
    for (const args of [['login'], ['configure'], ['workflows', 'list', '--workspace', 'other']]) {
      expect((await runEmbeddedCli(args, identity, { workbench: true })).exitCode).toBe(1)
    }
    expect(transport).not.toHaveBeenCalled()
    const hostHelp = await runEmbeddedCli(['--help'], identity)
    expect(hostHelp.stdout).toContain('sim login')
    expect(hostHelp.stdout).toContain('--profile')
  })
  it.each([
    ['workflows', 'run', IDENTITY.workspaceId],
    ['workflows', 'run', IDENTITY.workspaceId, '--async', '--manual'],
    ['workflows', 'run', IDENTITY.workspaceId, '--async', '--follow'],
    ['workflows', 'run', IDENTITY.workspaceId, '--async', '--trigger', 'trigger'],
    ['workflows', 'runs', 'wait', 'run-id', '--workflow', IDENTITY.workspaceId],
    ['logs', 'follow'],
  ])('workbench refuses blocking execution before issuing a request: %j', async (...args) => {
    const transport = vi.fn()
    const result = await runEmbeddedCli(args, { ...IDENTITY, transport }, { workbench: true })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('watch')
    expect(transport).not.toHaveBeenCalled()
  })

  it('workbench starts asynchronous work without waiting and preserves draft execution in the host', async () => {
    const transport = vi.fn().mockResolvedValue(jsonResponse({ runId: 'r1', status: 'queued' }))
    const result = await runEmbeddedCli(
      ['workflows', 'run', IDENTITY.workspaceId, '--async'],
      { ...IDENTITY, transport },
      { workbench: true }
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('r1')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(JSON.parse(transport.mock.calls[0]?.[1]?.body)).toMatchObject({ async: true })
    transport.mockResolvedValueOnce(jsonResponse({ runId: 'r2', status: 'completed' }))
    const draft = await runEmbeddedCli(['workflows', 'run', IDENTITY.workspaceId, '--manual'], {
      ...IDENTITY,
      transport,
    })
    expect(draft.exitCode).toBe(0)
    expect(draft.stdout).toContain('r2')
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
    expect(JSON.parse(result.stdout)).toMatchObject([{ id: 'wf-1', name: 'Email digest' }])
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
    expect(JSON.parse(a.stdout)[0].id).toBe(wsA)
    expect(JSON.parse(b.stdout)[0].id).toBe(wsB)
  })
})
