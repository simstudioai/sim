import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_CONTRACT } from '../contract/commands'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { sleep } from '../helpers'
import { USER_AGENT } from '../version'
import {
  formatApiErrorDetails,
  redirectEndpoint,
  requestAllPages,
  resolvePath,
  SimApiError,
  SimClient,
} from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  // `stubEnv` is not undone by `unstubAllGlobals`, so a SIM_TIMEOUT_SECONDS or
  // SIM_DEBUG set for one test would otherwise configure every test after it.
  vi.unstubAllEnvs()
})

function client(options: { apiKey?: string } = { apiKey: 'key' }): SimClient {
  return new SimClient({
    name: 'default',
    endpoint: 'https://sim.example',
    authProfile: 'default',
    apiKey: options.apiKey ?? null,
    oauth: null,
    workspaceId: 'ws_1',
    output: 'json',
    sources: {
      endpoint: 'default',
      credential: 'env',
      workspaceId: 'env',
      output: 'default',
    },
  })
}

function stubStderr(isTTY: boolean): { writes: string[]; restore: () => void } {
  const writes: string[] = []
  const originalTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
  const originalWrite = process.stderr.write
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: isTTY })
  process.stderr.write = ((chunk: string) => {
    writes.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  return {
    writes,
    restore: () => {
      process.stderr.write = originalWrite
      if (originalTTY) Object.defineProperty(process.stderr, 'isTTY', originalTTY)
      else Reflect.deleteProperty(process.stderr, 'isTTY')
    },
  }
}

describe('cursor pagination', () => {
  it('follows v2 cursors through the requested item limit', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: ['a', 'b'], nextCursor: 'next' })
      .mockResolvedValueOnce({ data: ['c'], nextCursor: null })

    await expect(
      requestAllPages<string>({ request } as Pick<SimClient, 'request'>, '/api/v2/items', {
        query: { workspaceId: 'workspace-1' },
        pageSize: 2,
        limit: 3,
        auth: 'optional',
      })
    ).resolves.toEqual(['a', 'b', 'c'])
    expect(request).toHaveBeenNthCalledWith(1, '/api/v2/items', {
      query: { workspaceId: 'workspace-1', limit: 2, cursor: null },
      auth: 'optional',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/api/v2/items', {
      query: { workspaceId: 'workspace-1', limit: 1, cursor: 'next' },
      auth: 'optional',
    })
  })

  it.each([{ cursors: ['c1', 'c1'] }, { cursors: ['c1', 'c2', 'c1'] }])(
    'rejects cursor cycles $cursors before making another request',
    async ({ cursors }) => {
      const request = vi.fn().mockRejectedValue(new Error('Pagination did not stop at the cycle'))
      for (const nextCursor of cursors) {
        request.mockResolvedValueOnce({ data: ['item'], nextCursor })
      }

      await expect(
        requestAllPages<string>({ request } as Pick<SimClient, 'request'>, '/api/v2/items', {
          pageSize: 100,
        })
      ).rejects.toThrow('repeated pagination cursor')
      expect(request).toHaveBeenCalledTimes(cursors.length)
    }
  )

  it('reports progress on stderr once a second page is coming, then clears the line', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: ['a', 'b'], nextCursor: 'next' })
      .mockResolvedValueOnce({ data: ['c'], nextCursor: null })
    const stderr = stubStderr(true)

    try {
      await requestAllPages<string>({ request } as Pick<SimClient, 'request'>, '/api/v2/items', {
        pageSize: 2,
      })
    } finally {
      stderr.restore()
    }

    expect(stderr.writes).toHaveLength(2)
    expect(stderr.writes[0]).toContain('fetched 2')
    expect(stderr.writes[1]).toBe('\r\u001b[K')
  })

  describe('the endpoint a redirect implies', () => {
    // Naming `target.origin` dropped a self-hosted endpoint's path prefix, so
    // the suggested value was not an API root and following the advice broke a
    // deployment that was one hostname away from working.
    it('keeps a path prefix the endpoint carries', () => {
      expect(
        redirectEndpoint(
          'https://host/sim',
          '/api/v2/workflows',
          new URL('https://www.host/sim/api/v2/workflows')
        )
      ).toBe('https://www.host/sim')
    })

    it('is just the origin when the endpoint has no prefix', () => {
      expect(
        redirectEndpoint(
          'https://sim.example',
          '/api/v2/workflows',
          new URL('https://www.sim.example/api/v2/workflows')
        )
      ).toBe('https://www.sim.example')
    })

    it('implies no change when the target resolves to the endpoint already set', () => {
      // A trailing-slash or path-normalization redirect keeps the origin;
      // advising the value the caller already has explains nothing.
      expect(
        redirectEndpoint(
          'https://sim.example',
          '/api/v2/workflows',
          new URL('https://sim.example/api/v2/workflows/')
        )
      ).toBeNull()
      expect(
        redirectEndpoint(
          'https://sim.example/',
          '/api/v2/x',
          new URL('https://sim.example/api/v2/x')
        )
      ).toBeNull()
    })

    it('falls back to the origin when the target does not carry the request path', () => {
      expect(
        redirectEndpoint(
          'https://sim.example',
          '/api/v2/workflows',
          new URL('https://auth.example/login')
        )
      ).toBe('https://auth.example')
    })
  })

  it('clears the progress line when a later page fails', async () => {
    // Progress is written without a trailing newline so it can be overwritten in
    // place. Cleaning up only on success left `fetched 2…` on the line the error
    // was then printed onto, so the two ran together.
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: ['a', 'b'], nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('page two failed'))
    const stderr = stubStderr(true)

    try {
      await expect(
        requestAllPages<string>({ request } as Pick<SimClient, 'request'>, '/api/v2/items', {
          pageSize: 2,
        })
      ).rejects.toThrow('page two failed')
    } finally {
      stderr.restore()
    }

    expect(stderr.writes[0]).toContain('fetched 2')
    expect(stderr.writes.at(-1)).toBe('\r\u001b[K')
  })

  it('stays silent for a single page, and when stderr is not a terminal', async () => {
    const single = vi.fn().mockResolvedValue({ data: ['a'], nextCursor: null })
    const paged = vi
      .fn()
      .mockResolvedValueOnce({ data: ['a'], nextCursor: 'next' })
      .mockResolvedValueOnce({ data: ['b'], nextCursor: null })

    const tty = stubStderr(true)
    try {
      await requestAllPages<string>({ request: single } as Pick<SimClient, 'request'>, '/items', {
        pageSize: 2,
      })
    } finally {
      tty.restore()
    }
    expect(tty.writes).toEqual([])

    const piped = stubStderr(false)
    try {
      await requestAllPages<string>({ request: paged } as Pick<SimClient, 'request'>, '/items', {
        pageSize: 1,
      })
    } finally {
      piped.restore()
    }
    expect(piped.writes).toEqual([])
  })
})

describe('redirects', () => {
  function redirect(location: string | null, status = 301): Response {
    return new Response(null, {
      status,
      headers: location === null ? {} : { location },
    })
  }

  it('does not let fetch follow a redirect, which would drop the write body', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect('https://www.sim.example/api/v2/tables'))
    vi.stubGlobal('fetch', fetch)

    await expect(
      client().request('/api/v2/tables/folders', { method: 'POST', body: { path: '/a' } })
    ).rejects.toThrow(/redirected to https:\/\/www\.sim\.example/)
    expect(fetch.mock.calls[0][1].redirect).toBe('manual')
  })

  it('names the endpoint to switch to, derived from the Location origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(redirect('https://www.sim.example:8443/api/v2/tables?x=1', 308))
    )

    await expect(client().request('/api/v2/tables')).rejects.toMatchObject({
      message:
        'Endpoint redirected to https://www.sim.example:8443. Run: sim configure --profile default --set-endpoint https://www.sim.example:8443',
      status: 308,
    })
  })

  it('resolves a relative Location rather than string-hacking the endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect('/api/v2/tables/')))

    await expect(client().request('/api/v2/tables')).rejects.toThrow(
      /redirected to https:\/\/sim\.example\/api\/v2\/tables\//
    )
  })

  it('still explains itself when Location is missing or unparseable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect(null, 302)))
    await expect(client().request('/api/v2/tables')).rejects.toThrow(/no usable redirect target/)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect('http://')))
    await expect(client().request('/api/v2/tables')).rejects.toThrow(/no usable redirect target/)
  })
})

describe('non-JSON responses', () => {
  it('names the URL and the shape instead of dumping a page of HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html lang="en"><head><title>Example Domain</title>', {
          status: 404,
          headers: { 'content-type': 'text/html; charset=UTF-8' },
        })
      )
    )

    const failure = client().request('/api/v2/workflows')

    await expect(failure).rejects.toMatchObject({
      message:
        'https://sim.example/api/v2/workflows returned HTML, not JSON (HTTP 404) — check your endpoint.',
    })
    await expect(failure).rejects.not.toThrow(/<!doctype/)
  })

  it('turns a 200 that is not JSON into an explained error, not a SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html><body>hello</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      )
    )

    await expect(client().request('/api/v2/workflows')).rejects.toMatchObject({
      name: 'SimApiError',
      message:
        'https://sim.example/api/v2/workflows returned HTML, not JSON (HTTP 200) — check your endpoint.',
    })
  })

  it("keeps a short plain-text body, which is the proxy's own diagnosis", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('upstream connect error', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        })
      )
    )

    await expect(client().request('/api/v2/workflows')).rejects.toThrow(
      /returned text\/plain, not JSON \(HTTP 502\) — check your endpoint\. Response: upstream connect error/
    )
  })

  it('leaves an empty error body reported by status alone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(client().request('/api/v2/workflows')).rejects.toMatchObject({
      message: 'Request failed with status 503',
    })
  })
})

describe('a request that never answers', () => {
  it('reports the nested Undici reason behind fetch failed', async () => {
    const socketError = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: socketError }))
    )

    await expect(client().request('/api/v2/workflows')).rejects.toMatchObject({
      message:
        'Could not reach https://sim.example: fetch failed: other side closed (UND_ERR_SOCKET)',
      status: 0,
    })
  })

  it('bounds a request by default, above every timeout the server itself applies', async () => {
    // A synchronous workflow run is allowed 3000s on a paid plan, so a tighter
    // default would abort real work and report it as a transport failure. What
    // this catches is a connection that is accepted and then never answers.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await client().request('/api/v2/workflows')

    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('sends no signal at all when the bound is switched off', async () => {
    // A self-hosted deployment can run executions without a timeout of its own,
    // and there the client must not invent one.
    vi.stubEnv('SIM_TIMEOUT_SECONDS', '0')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await client().request('/api/v2/workflows')
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined()
  })

  it('refuses a timeout that is not a number, naming the variable', async () => {
    vi.stubEnv('SIM_TIMEOUT_SECONDS', 'soon')
    vi.stubGlobal('fetch', vi.fn())

    await expect(client().request('/api/v2/workflows')).rejects.toThrow(
      /Invalid SIM_TIMEOUT_SECONDS "soon"/
    )
  })

  it('rounds a fractional millisecond rather than letting the timer reject it', async () => {
    // `AbortSignal.timeout` rejects a non-integer delay outright, so an
    // unrounded 0.0005s threw ERR_OUT_OF_RANGE before the request was made.
    vi.stubEnv('SIM_TIMEOUT_SECONDS', '0.0005')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(client().request('/api/v2/workflows')).resolves.toBeDefined()
  })

  it('keeps a bound below half a millisecond bounded, rather than disabling it', async () => {
    // Zero means "no bound", so rounding a positive value down to zero inverted
    // the request: the shortest timeout anyone could ask for became none.
    vi.stubEnv('SIM_TIMEOUT_SECONDS', '0.0004')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await client().request('/api/v2/workflows')
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('refuses a delay longer than Node can wait, which would silently become 1ms', async () => {
    // Past 2^31-1 ms Node does not fail — it clamps to 1ms, so the request the
    // caller asked to wait longest for would be the first one aborted.
    vi.stubEnv('SIM_TIMEOUT_SECONDS', String(2 ** 31))
    vi.stubGlobal('fetch', vi.fn())

    await expect(client().request('/api/v2/workflows')).rejects.toThrow(/longer than Node can wait/)
  })

  it('composes the caller signal with the timeout without AbortSignal.any', async () => {
    // `AbortSignal.any` arrived in Node 20.3 and this package supports Node 20,
    // so the earliest 20.x releases would have thrown a bare TypeError here.
    const original = AbortSignal.any
    // biome-ignore lint/performance/noDelete: restoring the property is the point
    delete (AbortSignal as { any?: unknown }).any
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      await client().request('/api/v2/workflows', { signal: controller.signal })
      const sent = fetchMock.mock.calls[0][1].signal as AbortSignal
      expect(sent.aborted).toBe(false)
      controller.abort()
      expect(sent.aborted).toBe(true)
    } finally {
      ;(AbortSignal as { any?: unknown }).any = original
    }
  })

  it('explains a timeout as a timeout, not as an unreachable endpoint', async () => {
    vi.stubEnv('SIM_TIMEOUT_SECONDS', '0.001')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        await sleep(20)
        init.signal?.throwIfAborted()
        return new Response('{}')
      })
    )

    await expect(client().request('/api/v2/workflows')).rejects.toThrow(/did not answer within/)
  })
})

describe('tracing a request', () => {
  it('traces method, url, status and duration when asked, and nothing otherwise', async () => {
    const response = () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    const quiet = stubStderr(false)
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
      await client().request('/api/v2/workflows')
    } finally {
      quiet.restore()
    }
    expect(quiet.writes).toEqual([])

    vi.stubEnv('SIM_DEBUG', '1')
    const traced = stubStderr(false)
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
      await client().request('/api/v2/workflows')
    } finally {
      traced.restore()
    }

    const line = traced.writes.join('')
    expect(line).toContain('GET https://sim.example/api/v2/workflows')
    expect(line).toContain('200')
    expect(line).toMatch(/\d+ms/)
    // The request carries the API key, and `secrets set` carries the secret
    // itself, so a trace must never include headers or bodies.
    expect(line).not.toContain('key')
  })
})

describe('request identity', () => {
  it('identifies the CLI, its version and its runtime to the API', async () => {
    // Without a User-Agent a CLI request is indistinguishable from any other
    // API traffic, so a bug that only reproduces on one version cannot be found
    // in the server's own logs.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await client().request('/api/v2/workflows')

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers['user-agent']).toBe(USER_AGENT)
    expect(USER_AGENT).toMatch(/^sim-cli\/\d+\.\d+\.\d+/)
    expect(USER_AGENT).toContain(`node/${process.versions.node}`)
    expect(USER_AGENT).toContain(process.platform)
  })
})

describe('workspace-key refusals', () => {
  it('appends the remedy, keyed off the code the API actually nests', async () => {
    // The envelope this asserts is the one staging returns: `error.code` is the
    // status class, and the actionable code rides in `error.details.code`.
    // Fabricating it at the top level made a green test out of a dead branch.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'FORBIDDEN',
              message: 'Workspace API key cannot perform this operation',
              details: { code: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' },
            },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        )
      )
    )

    await expect(client().request('/api/v2/secrets')).rejects.toMatchObject({
      message:
        'Workspace API key cannot perform this operation — this operation does not support workspace API keys; use an OAuth login or personal API key: sim login --profile default',
      code: 'FORBIDDEN',
    })
  })

  it('also recognises the principal-kind refusal, whose message is written for a log', async () => {
    // The same refusal is raised at two layers under two codes. The
    // principal-kind one answers "Principal kind workspace_api_key cannot
    // perform operation audit_logs.list" — accurate, and useless to a reader
    // who has no way to act on it. Recognising only the other code left every
    // audit-log command stating the problem in server vocabulary with no remedy.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'FORBIDDEN',
              message: 'Principal kind workspace_api_key cannot perform operation audit_logs.list',
              details: { code: 'PRINCIPAL_KIND_NOT_PERMITTED' },
            },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        )
      )
    )

    await expect(client().request('/api/v2/audit-logs')).rejects.toMatchObject({
      message:
        'Principal kind workspace_api_key cannot perform operation audit_logs.list — this operation does not support workspace API keys; use an OAuth login or personal API key: sim login --profile default',
    })
  })

  it('invents no remedy for other forbidden codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }),
            { status: 403, headers: { 'content-type': 'application/json' } }
          )
        )
    )

    await expect(client().request('/api/v2/secrets')).rejects.toMatchObject({
      message: 'Insufficient permissions',
    })
  })
})

describe('API errors', () => {
  it('keeps structured details and does not misdiagnose an ordinary 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'NOT_FOUND',
              message: 'Workflow not found',
              details: { id: 'missing' },
            },
          }),
          { status: 404 }
        )
      )
    )
    const client = new SimClient({
      name: 'default',
      endpoint: 'https://sim.example',
      authProfile: 'default',
      apiKey: 'key',
      oauth: null,
      workspaceId: 'ws_1',
      output: 'json',
      sources: {
        endpoint: 'default',
        credential: 'env',
        workspaceId: 'env',
        output: 'default',
      },
    })

    const request = client.request('/api/v2/workflows/missing')
    await expect(request).rejects.toMatchObject({
      message: 'Workflow not found',
      code: 'NOT_FOUND',
      details: { id: 'missing' },
    })
    await expect(request).rejects.not.toThrow(/v2 API may not be enabled/)
  })

  it('turns nested validation details into concise path-aware lines', () => {
    const lines = formatApiErrorDetails([
      {
        code: 'invalid_union',
        path: ['predicate'],
        message: 'Invalid input',
        errors: [
          [
            {
              code: 'invalid_union',
              path: ['all', 0],
              message: 'Invalid input',
              errors: [
                [
                  {
                    code: 'invalid_value',
                    path: ['op'],
                    message: 'Expected one of eq, ne',
                  },
                ],
              ],
            },
          ],
        ],
      },
    ])

    expect(lines).toEqual(['  details:', '    predicate.all.0.op: Expected one of eq, ne'])
  })

  it('drops the union branches the input did not take', () => {
    // `keys` is part of the issue Zod emits and the route serializes verbatim,
    // and it is the tell: a key rejected as unrecognized that another issue was
    // found *inside* is a branch the input did not take, not a real complaint.
    const lines = formatApiErrorDetails([
      { code: 'invalid_type', path: ['predicate', 'all', 0, 'all'], message: 'expected array' },
      {
        code: 'unrecognized_keys',
        keys: ['field', 'op', 'value'],
        path: ['predicate', 'all', 0],
        message: 'Unrecognized keys: "field", "op", "value"',
      },
      {
        code: 'invalid_value',
        path: ['predicate', 'all', 0, 'op'],
        message: 'Invalid option: expected one of "eq"|"ne"',
      },
      {
        code: 'unrecognized_keys',
        keys: ['all'],
        path: ['predicate'],
        message: 'Unrecognized key: "all"',
      },
    ])

    expect(lines).toContain('    predicate.all.0.op: Invalid option: expected one of "eq"|"ne"')
    expect(lines.join('\n')).not.toContain('Unrecognized key: "all"')
    expect(lines.join('\n')).not.toContain('Unrecognized keys:')
  })

  it('keeps an unrecognized key nothing else was reported inside', () => {
    // The suppression above once dropped every ancestor path, which swallowed
    // this: `tll` is genuinely unknown, and the caller cannot see it anywhere
    // else in the response.
    const lines = formatApiErrorDetails([
      {
        code: 'invalid_value',
        path: ['config', 'model'],
        message: 'Invalid option: expected one of "a"|"b"',
      },
      {
        code: 'unrecognized_keys',
        keys: ['tll'],
        path: ['config'],
        message: 'Unrecognized key: "tll"',
      },
    ])

    expect(lines).toContain('    config: Unrecognized key: "tll"')
  })

  it('keeps a container-level cap reported alongside a bad element', () => {
    // Both have to be fixed; showing only the element sends the caller back for
    // a second identical 400.
    const lines = formatApiErrorDetails([
      { path: ['rows'], message: 'Cannot insert more than 100 rows per batch' },
      { path: ['rows', 3, 'email'], message: 'Expected string, received number' },
    ])

    expect(lines).toContain('    rows: Cannot insert more than 100 rows per batch')
    expect(lines).toContain('    rows.3.email: Expected string, received number')
  })

  it('keeps a cross-field refusal, whose path is empty', () => {
    // An empty path is an ancestor of every other path, so the blanket
    // suppression erased exactly the message that names what to do.
    const lines = formatApiErrorDetails([
      { path: [], message: 'Provide either filter or rowIds' },
      { path: ['workspaceId'], message: 'Required' },
    ])

    expect(lines).toContain('    request: Provide either filter or rowIds')
    expect(lines).toContain('    workspaceId: Required')
  })

  it('still shows every field of a genuine multi-field failure', () => {
    const lines = formatApiErrorDetails([
      { path: ['name'], message: 'Required' },
      { path: ['workspaceId'], message: 'Required' },
    ])

    expect(lines).toEqual(['  details:', '    name: Required', '    workspaceId: Required'])
  })

  it('never suppresses the only issue there is', () => {
    expect(formatApiErrorDetails([{ path: ['name'], message: 'Required' }])).toEqual([
      '  details:',
      '    name: Required',
    ])
  })

  it('keeps non-validation details as JSON', () => {
    expect(formatApiErrorDetails({ id: 'missing' })).toEqual(['  details: {"id":"missing"}'])
  })
})

describe('raw requests', () => {
  it('returns an unconsumed response and forwards an abort signal', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('stream body'))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()

    const response = await client().requestRaw('/api/v2/chat', {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      body: { workspaceId: 'ws_1', prompt: 'hello' },
      signal: controller.signal,
    })

    expect(response.bodyUsed).toBe(false)
    expect(await response.text()).toBe('stream body')
    expect(fetch).toHaveBeenCalledWith(
      'https://sim.example/api/v2/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'text/event-stream',
          'content-type': 'application/json',
          'x-api-key': 'key',
        }),
      })
    )

    // The signal is composed with the request timeout, so it is no longer the
    // caller's object. What has to hold is the behaviour: aborting the
    // caller's controller still aborts the request.
    const sent = fetch.mock.calls[0][1].signal as AbortSignal
    expect(sent.aborted).toBe(false)
    controller.abort()
    expect(sent.aborted).toBe(true)
  })

  it('turns an aborted fetch into a clean CLI error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    const controller = new AbortController()
    controller.abort()

    await expect(
      client().requestRaw('/api/v2/chat', { signal: controller.signal })
    ).rejects.toMatchObject({
      message: 'Request cancelled.',
      status: 0,
    })
  })

  it('allows auth-disabled self-hosted chat without sending an API key', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('stream body'))
    vi.stubGlobal('fetch', fetch)
    const unauthenticated = client({})
    const workspaceId = unauthenticated.requireWorkspace(undefined, { auth: 'optional' })

    await unauthenticated.requestRaw('/api/v2/chat', {
      method: 'POST',
      body: { workspaceId, prompt: 'hello' },
      auth: 'optional',
    })

    expect(workspaceId).toBe('ws_1')
    expect(fetch).toHaveBeenCalledOnce()
    const headers = fetch.mock.calls[0][1].headers as Record<string, string>
    expect(headers).not.toHaveProperty('x-api-key')
  })

  it('keeps authentication required by default for every other command', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const unauthenticated = client({})

    expect(() => unauthenticated.requireWorkspace()).toThrow(/Not logged in/)
    await expect(unauthenticated.requestRaw('/api/v2/workflows')).rejects.toThrow(/Not logged in/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('resolvePath', () => {
  it('substitutes a path parameter', () => {
    expect(resolvePath('/api/v2/tables/[tableId]/rows', { tableId: 'tbl_1' })).toBe(
      '/api/v2/tables/tbl_1/rows'
    )
  })

  it('substitutes several parameters', () => {
    expect(
      resolvePath('/api/v2/knowledge/[id]/documents/[documentId]', { id: 'kb', documentId: 'doc' })
    ).toBe('/api/v2/knowledge/kb/documents/doc')
  })

  it('percent-encodes values so an id cannot retarget the request', () => {
    // An unencoded `/` or `?` here would silently address a different endpoint.
    expect(resolvePath('/api/v2/tables/[tableId]', { tableId: 'a/b?c=d' })).toBe(
      '/api/v2/tables/a%2Fb%3Fc%3Dd'
    )
  })

  it('throws rather than sending a URL with a literal [param] in it', () => {
    expect(() => resolvePath('/api/v2/tables/[tableId]', {})).toThrow(SimApiError)
    expect(() => resolvePath('/api/v2/tables/[tableId]', {})).toThrow('tableId')
  })

  it('leaves a parameterless path alone', () => {
    expect(resolvePath('/api/v2/tables')).toBe('/api/v2/tables')
  })
})

describe('generated operation table', () => {
  const names = Object.keys(V2_OPERATIONS) as V2OperationName[]

  it('covers the operations the commands rely on', () => {
    // Named explicitly: if a contract is renamed, the generator happily emits
    // the new name and only this test catches that a command lost its endpoint.
    for (const required of [
      'listTables',
      'getTable',
      'queryRows',
      'createTableRows',
      'deleteTableRows',
      'listWorkflows',
      'getWorkflow',
      'deployWorkflow',
      'undeployWorkflow',
      'rollbackWorkflow',
      'listLogs',
      'getLog',
      'getBillingStatus',
      'listBillingLogs',
      'listWorkflowRuns',
      'getWorkflowRun',
      'resumeWorkflow',
      'listFiles',
      'deleteFile',
      'listKnowledgeBases',
      'getKnowledgeBase',
      'listKnowledgeDocuments',
      'searchKnowledge',
    ] satisfies V2OperationName[]) {
      expect(names).toContain(required)
    }
  })

  it('declares every path parameter its path contains', () => {
    for (const name of names) {
      const spec = V2_OPERATIONS[name]
      const inPath = [...spec.path.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])
      expect(spec.pathParams, `${name} path params`).toEqual(inPath)
    }
  })

  it('only targets the public v2 surface with real HTTP verbs', () => {
    for (const name of names) {
      const spec = V2_OPERATIONS[name]
      expect(spec.path, name).toMatch(/^\/api\/v2\//)
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], name).toContain(spec.method)
    }
  })

  it('has no two operations sharing a method and path', () => {
    const seen = new Map<string, string>()
    for (const name of names) {
      const spec = V2_OPERATIONS[name]
      const key = `${spec.method} ${spec.path}`
      expect(seen.get(key), `${key} claimed by both ${seen.get(key)} and ${name}`).toBeUndefined()
      seen.set(key, name)
    }
  })
})

describe('destructive operations are gated', () => {
  /**
   * `DELETE /workflows/[id]/deploy` is an undeploy — reversible by redeploying,
   * and the contract renames it accordingly. Everything else that deletes is
   * gated behind `--yes`.
   */
  const NOT_DESTRUCTIVE = new Set<V2OperationName>([
    'undeployWorkflow',
    // Each of these stops something in flight rather than destroying something
    // kept: an upload that has not been completed owns nothing but its own
    // parts, and a cancelled import or export can simply be started again.
    'abortFileUpload',
    'abortKnowledgeDocumentUpload',
    'cancelTableImport',
    'cancelTableExport',
  ])

  /**
   * Destructive operations whose verb is not `DELETE`. A bulk form is a `POST`
   * because it carries a body, which put every one of them outside the sweep
   * below — `tables bulk-delete` destroyed many tables ungated while deleting
   * one required `--yes`. Enumerated by hand because no wire property
   * distinguishes them; the sweep after this one is what keeps the list honest.
   */
  /**
   * Destructive operations whose method is not `DELETE`.
   *
   * Hand-enumerated because destructiveness is not derivable: the generated
   * spec types an operations array as opaque, so nothing in the schema says a
   * batch carries a `delete` arm or that a state replace discards the draft.
   * The companion sweep below forces every non-`GET` operation into this set or
   * into {@link NON_DESTRUCTIVE}, so a new one cannot inherit the gate-free
   * default by being named something the old regex did not match.
   */
  const DESTRUCTIVE_NON_DELETE = new Set<V2OperationName>([
    // The same application operation as `rollbackWorkflow`, under a different
    // transition: both switch which version production serves away from the one
    // the caller last chose.
    'activateWorkflowVersion',
    'applyWorkflowOperations',
    'applyWorkflowVariables',
    'bulkDeleteFiles',
    'bulkDeleteTables',
    'bulkUpdateKnowledgeChunks',
    'replaceWorkflowChatDeployment',
    'replaceWorkflowState',
    'revertWorkflowVersion',
    'updateRowsByFilter',
  ])

  /**
   * Mutating operations that create, amend or move a resource without
   * discarding one. Listed rather than inferred so the sweep below can force a
   * decision on anything new.
   */
  const NON_DESTRUCTIVE = new Set<V2OperationName>([
    'addTableColumn',
    'addWorkflowGroup',
    'addWorkspaceFilesToKnowledgeBase',
    'bulkUpdateTableRows',
    'bulkUpdateKnowledgeDocuments',
    'cancelTableRuns',
    'cancelWorkflowRun',
    'chat',
    'completeFileUpload',
    'completeKnowledgeDocumentUpload',
    'completeTableImport',
    'createCredentialConnection',
    'createCustomTool',
    'createFile',
    'createFileFolder',
    'createFileUpload',
    'createFileUploadPartUrls',
    'createKnowledgeBase',
    'createKnowledgeChunk',
    'createKnowledgeConnector',
    'createKnowledgeDocumentUpload',
    'createKnowledgeDocumentUploadPartUrls',
    'createKnowledgeFolder',
    'createKnowledgeTag',
    'createMcpServer',
    'createSandbox',
    'createServiceAccountCredential',
    'createSkill',
    'createTable',
    'createTableExport',
    'createTableFolder',
    'createTableImport',
    'createTableImportPartUrls',
    'createTableRows',
    'createTableView',
    'createWorkflow',
    'createWorkflowFolder',
    'createWorkflowMcpServer',
    'deployWorkflow',
    'deployWorkflowMcpTool',
    'duplicateWorkflow',
    // Running one destroys nothing Sim keeps, for the same reason running a
    // workflow does not. Whatever the third party does with the call is the
    // caller's own instruction, and gating it would put `--yes` on the ordinary
    // path of every tool.
    'executeTool',
    'executeWorkflow',
    'editFileContent',
    'unzipFile',
    'searchTableRows',
    'grantSkillEditor',
    'importWorkflow',
    'moveFileItems',
    'moveTables',
    'moveWorkflows',
    'queryRows',
    'queryRowsCount',
    'relocateFileFolder',
    'relocateKnowledgeFolder',
    'relocateTableFolder',
    'relocateWorkflowFolder',
    'renameFile',
    'restoreFile',
    'restoreFileFolder',
    'restoreKnowledgeBase',
    'restoreTable',
    'restoreTableFolder',
    'restoreWorkflow',
    'resumeWorkflow',
    'rollbackWorkflow',
    'runRowEnrichment',
    'createTableDispatch',
    'bulkSaveKnowledgeTagDefinitions',
    'searchKnowledge',
    'setSecret',
    'syncKnowledgeConnector',
    'updateCredential',
    'updateCustomTool',
    'updateFileContent',
    'updateKnowledgeBase',
    'updateKnowledgeChunk',
    'updateKnowledgeConnector',
    'updateKnowledgeConnectorDocuments',
    'updateKnowledgeDocument',
    'updateKnowledgeTag',
    'updateMcpServer',
    'updateSandbox',
    'updateSkill',
    'updateTable',
    'updateTableColumn',
    'updateTableRow',
    'updateTableView',
    'updateWorkflow',
    'updateWorkflowGroup',
    'updateWorkflowMcpServer',
    'updateWorkflowPublicApi',
    'updateWorkflowVersion',
    'uploadKnowledgeDocument',
    'upsertFileShare',
    'upsertTableRow',
  ])

  it('every destructive non-DELETE operation carries a confirmation message', () => {
    const ungated = [...DESTRUCTIVE_NON_DELETE].filter((name) => !CLI_CONTRACT[name]?.confirm)
    expect(ungated).toEqual([])
  })

  it('forces every non-GET operation into a destructiveness classification', () => {
    // The old form regex-matched names for `delete|purge|…`, which is exactly
    // the set already enumerated — so it could never fail. Triage by exhaustion
    // instead: a new mutating operation fails until someone decides which list
    // it belongs in.
    const unclassified = (Object.keys(V2_OPERATIONS) as V2OperationName[]).filter((name) => {
      const { method } = V2_OPERATIONS[name]
      if (method === 'GET' || method === 'DELETE') return false
      return !DESTRUCTIVE_NON_DELETE.has(name) && !NON_DESTRUCTIVE.has(name)
    })
    expect(unclassified).toEqual([])
  })

  it('every DELETE carries a confirmation message', () => {
    // Without this, a new v2 domain arrives through generation with working
    // delete commands and no gate — which is exactly what happened when the
    // MCP/skills/folders/credentials endpoints landed.
    const ungated = (Object.keys(V2_OPERATIONS) as V2OperationName[]).filter(
      (name) =>
        V2_OPERATIONS[name].method === 'DELETE' &&
        !NOT_DESTRUCTIVE.has(name) &&
        !CLI_CONTRACT[name]?.confirm
    )
    expect(ungated).toEqual([])
  })

  it('states what is destroyed, not just that something is', () => {
    for (const [name, spec] of Object.entries(CLI_CONTRACT)) {
      if (!spec?.confirm) continue
      expect(spec.confirm, name).toMatch(/^This /)
      expect(spec.confirm.length, name).toBeGreaterThan(20)
    }
  })
})

describe('OAuth bearer credentials', () => {
  const NOW = 1_700_000_000_000

  function oauthClient(
    expiresAt: number,
    refreshOAuth = vi.fn(),
    names = { name: 'default', authProfile: 'default' }
  ) {
    const client = new SimClient(
      {
        name: names.name,
        endpoint: 'https://sim.example',
        authProfile: names.authProfile,
        apiKey: null,
        oauth: {
          accessToken: 'sim_oat_live',
          refreshToken: 'sim_ort_live',
          expiresAt,
          issuer: 'https://sim.example/api/auth',
          loginId: 'login-1',
          scope: 'offline_access api:read api:write',
        },
        workspaceId: 'ws_1',
        output: 'json',
        sources: {
          endpoint: 'default',
          credential: 'credentials',
          workspaceId: 'env',
          output: 'default',
        },
      },
      { refreshOAuth }
    )
    return { client, refreshOAuth }
  }

  function jsonReply(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends a stored login as a bearer token and never as x-api-key', async () => {
    vi.useFakeTimers({ now: NOW })
    const fetchMock = vi.fn(async () => jsonReply(200, { data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const { client, refreshOAuth } = oauthClient(NOW + 60 * 60 * 1000)

    await client.request('/api/v2/meta')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: 'Bearer sim_oat_live' })
    expect(init.headers).not.toHaveProperty('x-api-key')
    expect(refreshOAuth).not.toHaveBeenCalled()
  })

  it('renews a login that is about to lapse before using it', async () => {
    vi.useFakeTimers({ now: NOW })
    const fetchMock = vi.fn(async () => jsonReply(200, { data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const refresh = vi.fn(async () => ({
      accessToken: 'sim_oat_fresh',
      refreshToken: 'sim_ort_fresh',
      expiresAt: NOW + 60 * 60 * 1000,
    }))
    const { client } = oauthClient(NOW + 60 * 1000, refresh)

    await client.request('/api/v2/meta')
    await client.request('/api/v2/meta')

    expect(refresh).toHaveBeenCalledTimes(1)
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as unknown as [string, RequestInit]
      expect(init.headers).toMatchObject({ authorization: 'Bearer sim_oat_fresh' })
    }
  })

  it('retries exactly once after a 401 that names the token invalid', async () => {
    vi.useFakeTimers({ now: NOW })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonReply(
          401,
          { error: { code: 'UNAUTHORIZED', message: 'Invalid access token' } },
          { 'www-authenticate': 'Bearer realm="Sim API", error="invalid_token"' }
        )
      )
      .mockResolvedValueOnce(jsonReply(200, { data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const refresh = vi.fn(async () => ({
      accessToken: 'sim_oat_fresh',
      refreshToken: 'sim_ort_fresh',
      expiresAt: NOW + 60 * 60 * 1000,
    }))
    const { client } = oauthClient(NOW + 60 * 60 * 1000, refresh)

    await expect(client.request('/api/v2/meta')).resolves.toEqual({ data: { ok: true } })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not refresh on a 401 that is not about the token', async () => {
    vi.useFakeTimers({ now: NOW })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonReply(
          401,
          { error: { code: 'UNAUTHORIZED', message: 'Bearer tokens are not accepted' } },
          {
            'www-authenticate':
              'SimApiKey realm="Sim API", header="x-api-key", Bearer realm="Sim API"',
          }
        )
      )
    )
    const refresh = vi.fn()
    const { client } = oauthClient(NOW + 60 * 60 * 1000, refresh)

    await expect(client.request('/api/v2/meta')).rejects.toThrow('run: sim login')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not refresh when invalid_token appears only in the challenge description', async () => {
    vi.useFakeTimers({ now: NOW })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonReply(
          401,
          { error: { code: 'FORBIDDEN', message: 'Scope refused' } },
          {
            'www-authenticate':
              'Bearer realm="Sim API", error="insufficient_scope", error_description="not an invalid_token failure"',
          }
        )
      )
    )
    const refresh = vi.fn()
    const { client } = oauthClient(NOW + 60 * 60 * 1000, refresh)

    await expect(client.request('/api/v2/meta')).rejects.toThrow('Scope refused')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('directs a workspace alias to its authentication profile after a 401', async () => {
    vi.useFakeTimers({ now: NOW })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonReply(401, { error: { message: 'Login rejected' } }))
    )
    const { client } = oauthClient(NOW + 60 * 60 * 1000, vi.fn(), {
      name: 'workspace-alias',
      authProfile: 'default',
    })

    await expect(client.request('/api/v2/meta')).rejects.toThrow('sim login --profile default')
  })

  it('prefers an explicit API key over the stored login', async () => {
    vi.useFakeTimers({ now: NOW })
    const fetchMock = vi.fn(async () => jsonReply(200, { data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new SimClient({
      name: 'default',
      endpoint: 'https://sim.example',
      authProfile: 'default',
      apiKey: 'sim_from_env',
      /** Keep a live stored login present so the explicit-key precedence is observable. */
      oauth: {
        accessToken: 'sim_oat_live',
        refreshToken: 'sim_ort_live',
        expiresAt: NOW + 60 * 60 * 1000,
        issuer: 'https://sim.example/api/auth',
        loginId: 'login-1',
        scope: 'offline_access api:read api:write',
      },
      workspaceId: 'ws_1',
      output: 'json',
      sources: { endpoint: 'default', credential: 'env', workspaceId: 'env', output: 'default' },
    })

    await client.request('/api/v2/meta')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ 'x-api-key': 'sim_from_env' })
    expect(init.headers).not.toHaveProperty('authorization')
  })
})
