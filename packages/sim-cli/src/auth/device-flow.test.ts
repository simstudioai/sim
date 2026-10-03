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
  it('retries a 5xx, because the server released the approval for a later poll', async () => {
    // The regression: treating every non-429 as terminal threw away an approval
    // the user had already granted in the browser.
    const { result } = await poll([
      () => reply(500, { error: 'Failed to generate API key' }),
      () => reply(200, COMPLETE),
    ])
    expect(result.apiKey).toBe('sim_abc')
  })

  it('gives up on a deliberate refusal rather than spinning to the timeout', async () => {
    await expect(
      poll([() => reply(400, { error: 'verifier must be a base64url secret' })])
    ).rejects.toThrow('verifier must be a base64url secret')
  })

  it('asks fetch not to follow a redirect', async () => {
    // Following one rewrites this POST into a bodyless GET — which the route
    // answers 405, a status nothing in the login chose — and hands `pollSecret`
    // to whatever origin `Location` names.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200, COMPLETE))
    await pollForKey(ENDPOINT, createAuthRequest())

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })
})

describe('createAuthRequest', () => {
  it('mints a 43-character base64url request id, challenge, and secret', () => {
    const auth = createAuthRequest()
    for (const value of [auth.request, auth.challenge, auth.pollSecret]) {
      expect(value).toMatch(/^[A-Za-z0-9\-_]{43}$/)
    }
  })

  it('never puts the poll secret in the browser URL', () => {
    const auth = createAuthRequest()
    const url = buildApprovalUrl(ENDPOINT, auth, 'ws_1')
    expect(url).toContain(encodeURIComponent(auth.challenge))
    expect(url).not.toContain(auth.pollSecret)
  })
})
