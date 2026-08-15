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

  it('gives up on a deliberate refusal rather than spinning to the timeout', async () => {
    await expect(
      poll([() => reply(400, { error: 'verifier must be a base64url secret' })])
    ).rejects.toThrow('verifier must be a base64url secret')
  })

  it('gives up on a 403', async () => {
    await expect(poll([() => reply(403, { error: 'Forbidden' })])).rejects.toThrow('Forbidden')
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

  it('never puts the poll secret in the browser URL', () => {
    const auth = createAuthRequest()
    const url = buildApprovalUrl(ENDPOINT, auth, 'platform', 'ws_1')
    expect(url).toContain(encodeURIComponent(auth.challenge))
    expect(url).not.toContain(auth.pollSecret)
  })
})
