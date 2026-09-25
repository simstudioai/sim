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
