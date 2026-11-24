import { sleep } from '@sim/utils/helpers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RATE_LIMITED_EXIT_CODE } from '../exit-codes'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import {
  formatApiErrorDetails,
  requestAllPages,
  resolvePath,
  SimApiError,
  SimClient,
} from './client'

afterEach(() => {
  // `stubEnv` is not undone by `unstubAllGlobals`, so a SIM_TIMEOUT_SECONDS or
  // SIM_DEBUG set for one test would otherwise configure every test after it.
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

function _stubStderr(isTTY: boolean): { writes: string[]; restore: () => void } {
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
})

describe('non-JSON responses', () => {
  it.each([200, 429, 503])(
    'retains Retry-After when the HTTP %i response body is lost',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('Connection closed'))
              },
            }),
            { status, headers: { 'retry-after': '10' } }
          )
        )
      )
      await expect(
        client().request('/api/v2/workflows', { method: 'POST', body: {} })
      ).rejects.toMatchObject({
        code: 'RESPONSE_READ_FAILED',
        status,
        retryAfterMs: 10_000,
      })
    }
  )

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
})

describe('request ids on errors', () => {
  it("reads an internal route's request id stamped beside the error", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Workflow not found', requestId: 'req-body' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    await expect(client().request('/api/workflows/missing')).rejects.toMatchObject({
      message: 'Workflow not found',
      requestId: 'req-body',
    })
  })

  it('keeps the x-request-id of a 200 that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html', 'x-request-id': 'req-200' },
        })
      )
    )
    await expect(client().request('/api/v2/workflows')).rejects.toMatchObject({
      requestId: 'req-200',
    })
  })

  it('keeps the x-request-id of a redirect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 308,
          headers: { location: 'https://www.sim.example/api/v2/tables', 'x-request-id': 'req-308' },
        })
      )
    )
    await expect(client().request('/api/v2/tables')).rejects.toMatchObject({
      requestId: 'req-308',
    })
  })
})

describe('a request that never answers', () => {
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

  it('refuses a delay longer than Node can wait, which would silently become 1ms', async () => {
    // Past 2^31-1 ms Node does not fail — it clamps to 1ms, so the request the
    // caller asked to wait longest for would be the first one aborted.
    vi.stubEnv('SIM_TIMEOUT_SECONDS', String(2 ** 31))
    vi.stubGlobal('fetch', vi.fn())

    await expect(client().request('/api/v2/workflows')).rejects.toThrow(/longer than Node can wait/)
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
        'Workspace API key cannot perform this operation — this operation does not support workspace API keys; use an OAuth login or personal API key: the key comes from SIM_API_KEY, which overrides any login: fix it, or unset it and run sim login --profile default',
      code: 'FORBIDDEN',
    })
  })

  it('names SIM_API_KEY, not a login that it would override, when the server refuses that key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
      )
    )

    const refused = client().request('/api/v2/meta')

    await expect(refused).rejects.toMatchObject({
      message:
        'Invalid API key — the key comes from SIM_API_KEY, which overrides any login: fix it, or unset it and run sim login --profile default',
      exitCode: 13,
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
})

describe('raw requests', () => {
  it('turns an aborted fetch into a clean CLI error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    const controller = new AbortController()
    controller.abort()

    await expect(
      client().requestRaw('/api/v2/chat', { signal: controller.signal })
    ).rejects.toMatchObject({
      message: 'Request cancelled.',
      status: 0,
      code: 'REQUEST_CANCELLED',
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

  it('refuses a profile with no login as AUTH_REQUIRED, exit 13, apart from a failed command', async () => {
    vi.stubGlobal('fetch', vi.fn())

    await expect(client({}).request('/api/v2/workflows')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      exitCode: 13,
    })
  })
})

describe('rate limiting', () => {
  function limited(retryAfter: string | null = '0'): Response {
    return new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'API rate limit exceeded' } }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          ...(retryAfter === null ? {} : { 'retry-after': retryAfter }),
        },
      }
    )
  }

  /** Runs `request` to completion with the retry waits elapsed on fake timers. */
  async function settle<T>(request: Promise<T>): Promise<PromiseSettledResult<T>> {
    const settled = Promise.allSettled([request])
    await vi.runAllTimersAsync()
    return (await settled)[0]
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resends a GET answered 429 and returns the answer that follows', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(Response.json({ data: { id: 'tbl_1' } }))
    vi.stubGlobal('fetch', fetch)

    const outcome = await settle(client().request('/api/v2/tables/tbl_1'))

    expect(outcome).toEqual({ status: 'fulfilled', value: { data: { id: 'tbl_1' } } })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('says on stderr how long it waits before resending a request answered 429', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const written: string[] = []
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(limited('7'))
        .mockResolvedValueOnce(Response.json({ data: {} }))
    )

    await settle(client().request('/api/v2/tables/tbl_1'))
    write.mockRestore()

    expect(written.join('')).toMatch(/Rate limited \(HTTP 429\); retrying in 7s \(retry 1 of 6\)/)
  })

  it('clears a terminal progress line before saying it waits on a 429', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const written: string[] = []
    const tty = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(limited('7'))
        .mockResolvedValueOnce(Response.json({ data: {} }))
    )

    await settle(client().request('/api/v2/tables/tbl_1'))
    write.mockRestore()
    if (tty) Object.defineProperty(process.stderr, 'isTTY', tty)
    else Reflect.deleteProperty(process.stderr, 'isTTY')

    expect(written.join('')).toMatch(/^\r\u001b\[K.*Rate limited \(HTTP 429\)/)
  })

  it('resends a GET answered 429 even when that response body is lost', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const lostBody = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('Connection closed'))
        },
      }),
      { status: 429, headers: { 'retry-after': '0' } }
    )
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(lostBody)
      .mockResolvedValueOnce(Response.json({ data: [] }))
    vi.stubGlobal('fetch', fetch)

    const outcome = await settle(client().request('/api/v2/tables'))

    expect(outcome).toEqual({ status: 'fulfilled', value: { data: [] } })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('waits at least the Retry-After the server named before resending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(limited('20'))
      .mockResolvedValueOnce(Response.json({ data: [] }))
    vi.stubGlobal('fetch', fetch)

    const request = client().request('/api/v2/tables')
    await vi.advanceTimersByTimeAsync(19_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(request).resolves.toEqual({ data: [] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not resend a write that did not opt in, and exits with the rate-limit status', async () => {
    const fetch = vi.fn().mockResolvedValue(limited())
    vi.stubGlobal('fetch', fetch)

    await expect(
      client().request('/api/v2/tables', { method: 'POST', body: { name: 'leads' } })
    ).rejects.toMatchObject({ status: 429, exitCode: RATE_LIMITED_EXIT_CODE })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('keeps the Retry-After on the rate-limit refusal so a command loop can honor it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(limited('30')))

    await expect(
      client().request('/api/v2/tables', { method: 'POST', body: { name: 'leads' } })
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 30_000 })
  })

  it('never resends a GET whose caller opted out, so an optional read never waits on a limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetch = vi.fn().mockResolvedValue(limited())
    vi.stubGlobal('fetch', fetch)

    const outcome = await settle(
      client().request('/api/v2/workspaces/ws_1/workflows/source/resources', {
        retryRateLimited: false,
      })
    )

    expect(outcome.status).toBe('rejected')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('resends a write that declared itself safe to resend after a 429', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(Response.json({ data: { applied: [] } }))
    vi.stubGlobal('fetch', fetch)

    const outcome = await settle(
      client().request('/api/v2/workspaces/ws_1/source', {
        method: 'POST',
        body: { files: {} },
        retryRateLimited: true,
      })
    )

    expect(outcome.status).toBe('fulfilled')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ files: {} }))
  })

  it('gives up after a bounded number of resends with the rate-limit exit status', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetch = vi.fn().mockImplementation(async () => limited())
    vi.stubGlobal('fetch', fetch)

    const outcome = await settle(client().requestRaw('/api/v2/files/file_1'))

    expect(outcome.status).toBe('rejected')
    const error = (outcome as PromiseRejectedResult).reason
    expect(error).toBeInstanceOf(SimApiError)
    expect(error).toMatchObject({ status: 429, exitCode: RATE_LIMITED_EXIT_CODE })
    expect(error.message).toMatch(/run the command again/)
    expect(fetch.mock.calls.length).toBeGreaterThan(2)
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('stops waiting to resend when the caller cancels', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetch = vi.fn().mockImplementation(async () => limited('20'))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()

    const request = client().request('/api/v2/tables', { signal: controller.signal })
    const settled = Promise.allSettled([request])
    await vi.advanceTimersByTimeAsync(1_000)
    controller.abort()
    const [outcome] = await settled

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: { message: 'Request cancelled.', code: 'REQUEST_CANCELLED' },
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('resolvePath', () => {
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
})

describe('generated operation table', () => {
  const names = Object.keys(V2_OPERATIONS) as V2OperationName[]

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
  const _NOT_DESTRUCTIVE = new Set<V2OperationName>([
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
    'pushWorkspace',
    'pullWorkspace',
    'rollbackWorkspaceFork',
    'unlinkWorkspaceFork',
    // The same application operation as `rollbackWorkflow`, under a different
    // transition: both switch which version production serves away from the one
    // the caller last chose.
    'activateWorkflowVersion',
    'applyWorkflowOperations',
    // Replaces the draft with the submitted source: blocks the file no longer declares are removed.
    'applyWorkflowSource',
    'applyWorkflowVariables',
    // Writes a whole workspace directory; with allowDelete it deletes what the directory dropped.
    'applyWorkspaceSource',
    'archiveProjectFileItems',
    'bulkDeleteFiles',
    'bulkDeleteTables',
    'bulkUpdateKnowledgeChunks',
    'completeSourcePermissionImport',
    'replaceWorkflowChatDeployment',
    'replaceSearchSourcePermissions',
    'updateSearchSource',
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
    /** Staging blob bytes for a workspace source apply writes nothing a user sees. */
    'findMissingWorkspaceSourceBlobs',
    'stageWorkspaceSourceBlobs',
    /** A source plan is a read sent as a POST: it writes nothing. */
    'planWorkflowSource',
    'planWorkspaceSource',
    'completeProjectFileUpload',
    'copyFileItems',
    'createProjectFile',
    'createProjectFileFolder',
    'createProjectFileUpload',
    'exportProjectFileSnapshot',
    'getProjectFileUploadPartUrls',
    'moveProjectFileItems',
    'renameProjectFile',
    'restoreProjectFile',
    'restoreProjectFileFolder',
    'revertProjectFileVersion',
    'unzipProjectFile',
    'updateProjectFileContent',
    'updateProjectFileFolder',
    'updateProjectFileShare',
    /** These amend access or request history without discarding a resource. */
    'cancelOrganizationAccessRequest',
    'cancelWorkspaceAccessRequest',
    'createOrganizationAccessRequest',
    'createWorkspaceAccessRequest',
    'createWorkspaceInvitations',
    'resolveOrganizationAccessRequest',
    'updateOrganizationAccessRequestSettings',
    'updateOrganizationMemberUsageLimit',
    'createOrganizationInvitation',
    'resendOrganizationInvitation',
    'updateOrganizationMember',
    'updateWorkspace',
    'updateWorkspaceMember',
    'createPermissionGroup',
    'updatePermissionGroup',
    'addPermissionGroupMember',
    'bulkAddPermissionGroupMembers',
    'addOrganizationDomain',
    'forkWorkspace',
    'getSelector',
    'listSelector',
    'previewWorkflowImport',
    'previewWorkspaceFork',
    'previewWorkspacePull',
    'previewWorkspacePush',
    'updateWorkspaceForkExclusions',
    'updateWorkspaceForkMappings',
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
    'completeKnowledgeImport',
    'completeTableImport',
    'createCredentialConnection',
    'createCredentialWorkloadIdentitySubject',
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
    'createKnowledgeImport',
    'createKnowledgeImportPartUrls',
    'createKnowledgeTag',
    'createMcpServer',
    'createSandbox',
    'createServiceAccountCredential',
    'createSkill',
    'createSourcePermissionImport',
    'createSearchSource',
    'prepareSearchSources',
    'createTable',
    'createTableExport',
    'createTableFolder',
    'createTableImport',
    'createTableImportPartUrls',
    'createTableRows',
    'createTableView',
    'createWorkflow',
    'createWorkflowFolder',
    'createWorkflowFromSource',
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
    'putSourcePermissionImportPart',
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
    'revertFileVersion',
    'rollbackWorkflow',
    'runRowEnrichment',
    'createTableDispatch',
    'bulkSaveKnowledgeTagDefinitions',
    'searchKnowledge',
    'setSecret',
    'saveSsoProvider',
    'setPrimarySsoProvider',
    'syncKnowledgeConnector',
    'updateCredential',
    'updateSsoPolicy',
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
    'updateWorkflowTrigger',
    'updateWorkflowVersion',
    'uploadKnowledgeDocument',
    'upsertFileShare',
    'upsertCredentialMember',
    'upsertTableRow',
    'verifyOrganizationDomain',
  ])

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
    await expect(client.request('/api/v2/meta')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
      exitCode: 13,
    })
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

describe('encoded answers', () => {
  function profile(overrides: Partial<ConstructorParameters<typeof SimClient>[0]>) {
    return {
      name: 'default',
      endpoint: 'https://sim.example',
      authProfile: 'default',
      apiKey: 'key',
      oauth: null,
      workspaceId: 'ws_1',
      output: 'json' as const,
      sources: {
        endpoint: 'default' as const,
        credential: 'env' as const,
        workspaceId: 'env' as const,
        output: 'default' as const,
      },
      ...overrides,
    }
  }

  /** A local server that answers brotli when asked, recording each request's Accept-Encoding. */
  async function encodingServer(body: unknown) {
    const { createServer } = await import('node:http')
    const { brotliCompressSync } = await import('node:zlib')
    const asked: Array<string | undefined> = []
    const server = createServer((request, response) => {
      asked.push(request.headers['accept-encoding'])
      const json = Buffer.from(JSON.stringify(body))
      const br = /\bbr\b/.test(request.headers['accept-encoding'] ?? '')
      response.writeHead(200, {
        'content-type': 'application/json',
        ...(br ? { 'content-encoding': 'br' } : {}),
      })
      response.end(br ? brotliCompressSync(json) : json)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    return { endpoint: `http://127.0.0.1:${port}`, asked, close: () => server.close() }
  }

  it('asks for brotli on the wire and reads the decoded answer', async () => {
    const body = { data: { blocks: 'x'.repeat(50_000) } }
    const server = await encodingServer(body)
    try {
      const wire = new SimClient(profile({ endpoint: server.endpoint }))

      await expect(wire.request('/api/v2/catalog')).resolves.toEqual(body)
      expect(server.asked).toEqual(['br, gzip'])
    } finally {
      server.close()
    }
  })

  it('never asks an in-process transport for an encoding it would hand back undecoded', async () => {
    const transport = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: 1 }), {
          headers: { 'content-type': 'application/json' },
        })
    )
    const embedded = new SimClient(profile({ transport }))

    await embedded.request('/api/v2/catalog')

    const init = transport.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).has('accept-encoding')).toBe(false)
  })
})
