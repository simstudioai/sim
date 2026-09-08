import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApprovalUrl, createAuthRequest, pollForKey } from './device-flow'

const ENDPOINT = 'https://sim.test'

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status }) as Response
}

const COMPLETE = {
  status: 'complete',
  key: { id: 'k1', apiKey: 'sim_abc' },
  scope: 'platform',
  workspaceId: 'ws_1',
  workspaceBound: true,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Drives the poll loop without waiting out its real 2s interval. */
async function poll(responses: Array<() => Response>) {
  let call = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses[call++]())
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn()
    return 0 as unknown as NodeJS.Timeout
  }) as never)

  const auth = createAuthRequest()
  return { result: await pollForKey(ENDPOINT, auth), calls: () => call }
}

describe('pollForKey', () => {
  it('returns the key once the approval completes', async () => {
    const { result } = await poll([() => reply(200, COMPLETE)])
    expect(result).toMatchObject({ apiKey: 'sim_abc', scope: 'platform', workspaceBound: true })
  })

  it('keeps polling while the approval is pending', async () => {
    const { result, calls } = await poll([
      () => reply(200, { status: 'pending' }),
      () => reply(200, { status: 'pending' }),
      () => reply(200, COMPLETE),
    ])
    expect(calls()).toBe(3)
    expect(result.apiKey).toBe('sim_abc')
  })

  it('retries a 5xx, because the server released the approval for a later poll', async () => {
    // The regression: treating every non-429 as terminal threw away an approval
    // the user had already granted in the browser.
    const { result } = await poll([
      () => reply(500, { error: 'Failed to generate API key' }),
      () => reply(200, COMPLETE),
    ])
    expect(result.apiKey).toBe('sim_abc')
  })

  it('retries a same-second name conflict', async () => {
    const { result } = await poll([
      () => reply(409, { error: 'A personal API key named "CLI (…)" already exists.' }),
      () => reply(200, COMPLETE),
    ])
    expect(result.apiKey).toBe('sim_abc')
  })

  it('retries a rate-limited poll', async () => {
    const { result } = await poll([() => reply(429, {}), () => reply(200, COMPLETE)])
    expect(result.apiKey).toBe('sim_abc')
  })

  it('survives a transport failure without ending the login', async () => {
    let call = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (call++ === 0) throw new Error('ECONNRESET')
      return reply(200, COMPLETE)
    })
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn()
      return 0 as unknown as NodeJS.Timeout
    }) as never)

    const result = await pollForKey(ENDPOINT, createAuthRequest())
    expect(result.apiKey).toBe('sim_abc')
  })

  it('says an unreachable endpoint is not answering, then keeps polling', async () => {
    // A typo'd endpoint used to be indistinguishable from a slow approval:
    // every transport failure was swallowed and retried silently, so after 40
    // seconds against a closed port the only output was still "Waiting for
    // approval…" — for the full 15-minute timeout.
    let call = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (call++ < 4) throw new Error('getaddrinfo ENOTFOUND sim.tset')
      return reply(200, COMPLETE)
    })
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn()
      return 0 as unknown as NodeJS.Timeout
    }) as never)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    const result = await pollForKey(ENDPOINT, createAuthRequest())

    // Reported, not aborted: the retry policy and the 15-minute deadline stand.
    expect(result.apiKey).toBe('sim_abc')
    expect(stderr).toHaveBeenCalledOnce()
    const warning = String(stderr.mock.calls[0][0])
    expect(warning).toContain(ENDPOINT)
    expect(warning).toContain('getaddrinfo ENOTFOUND sim.tset')
  })

  it('stays quiet about a single blip, which the retry policy exists to absorb', async () => {
    let call = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (call++ === 0) throw new Error('ECONNRESET')
      return reply(200, COMPLETE)
    })
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn()
      return 0 as unknown as NodeJS.Timeout
    }) as never)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await pollForKey(ENDPOINT, createAuthRequest())

    expect(stderr).not.toHaveBeenCalled()
  })

  it('gives up on a deliberate refusal rather than spinning to the timeout', async () => {
    await expect(
      poll([() => reply(400, { error: 'verifier must be a base64url secret' })])
    ).rejects.toThrow('verifier must be a base64url secret')
  })

  it('gives up on a 403', async () => {
    await expect(poll([() => reply(403, { error: 'Forbidden' })])).rejects.toThrow('Forbidden')
  })

  it('asks fetch not to follow a redirect', async () => {
    // Following one rewrites this POST into a bodyless GET — which the route
    // answers 405, a status nothing in the login chose — and hands `pollSecret`
    // to whatever origin `Location` names.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200, COMPLETE))
    await pollForKey(ENDPOINT, createAuthRequest())

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('explains a redirected endpoint instead of failing on the method it became', async () => {
    await expect(
      poll([
        () =>
          new Response(null, {
            status: 301,
            headers: { location: 'https://www.sim.test/api/cli/auth/poll' },
          }),
      ])
    ).rejects.toThrow(/redirected the login poll to https:\/\/www\.sim\.test/)
  })
})

describe('createAuthRequest', () => {
  it('mints a 43-character base64url request id, challenge, and secret', () => {
    const auth = createAuthRequest()
    for (const value of [auth.request, auth.challenge, auth.pollSecret]) {
      expect(value).toMatch(/^[A-Za-z0-9\-_]{43}$/)
    }
  })

  it('uses a pairing alphabet with no look-alike characters', () => {
    // The code is compared across two screens; O/0 and I/1 would defeat that.
    for (let i = 0; i < 50; i++) {
      expect(createAuthRequest().pairing).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/
      )
    }
  })

  it('keeps a path prefix the endpoint carries, in both login URLs', async () => {
    // Both URLs were built with `new URL('/path', endpoint)`. A leading-slash
    // path is absolute, so it resolved against the ORIGIN and dropped the
    // prefix: a deployment served at https://host/sim sent the browser to
    // https://host/cli/auth and polled https://host/api/cli/auth/poll, neither
    // of which exists there. Every other command concatenated and worked, so
    // the endpoint looked correct and only login failed.
    const prefixed = 'https://host.test/sim'
    const auth = createAuthRequest()

    expect(buildApprovalUrl(prefixed, auth)).toMatch(/^https:\/\/host\.test\/sim\/cli\/auth\?/)

    // `spyOn`, like the rest of this file: `restoreAllMocks` in teardown undoes
    // it, whereas a `stubGlobal` would outlive the test and leak this
    // completed-auth response into whatever ran next.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'complete', key: { id: 'k', apiKey: 'sk' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await pollForKey(prefixed, auth)
    expect(fetchSpy.mock.calls[0][0]).toBe('https://host.test/sim/api/cli/auth/poll')
  })

  it('omits an absent workspace rather than sending it blank', () => {
    const auth = createAuthRequest()
    expect(buildApprovalUrl(ENDPOINT, auth)).not.toContain('workspace=')
    expect(buildApprovalUrl(ENDPOINT, auth, 'ws_1')).toContain('workspace=ws_1')
  })

  it('always requests a platform API key', () => {
    const url = new URL(buildApprovalUrl(ENDPOINT, createAuthRequest()))
    expect(url.searchParams.get('scope')).toBe('platform')
  })

  it('never puts the poll secret in the browser URL', () => {
    const auth = createAuthRequest()
    const url = buildApprovalUrl(ENDPOINT, auth, 'ws_1')
    expect(url).toContain(encodeURIComponent(auth.challenge))
    expect(url).not.toContain(auth.pollSecret)
  })
})
