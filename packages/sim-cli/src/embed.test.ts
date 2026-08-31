import { afterEach, describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from './embed'

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
  it('runs a real command in-process with the injected identity, capturing stdout', async () => {
    const seen: { url: string; auth: string | null }[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
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
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      // Answer each invocation with its own workspace id so cross-talk is visible.
      const workspaceId = url.searchParams.get('workspaceId') ?? 'missing'
      await new Promise((resolve) => setTimeout(resolve, workspaceId.endsWith('1') ? 30 : 5))
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
