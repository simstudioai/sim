import { expect, test } from '@playwright/test'
import { z } from 'zod'
import { E2eHttpClient } from '../fixtures/http-client'

test.describe('E2E HTTP client', () => {
  test('honors Retry-After only for 429 responses and records attempts', async () => {
    const delays: number[] = []
    const attempts: number[] = []
    let requestCount = 0
    const client = new E2eHttpClient({
      baseUrl: 'http://127.0.0.1:1',
      fetchImplementation: async () => {
        requestCount += 1
        return requestCount === 1
          ? new Response(JSON.stringify({ error: 'limited' }), {
              status: 429,
              headers: { 'content-type': 'application/json', 'retry-after': '0.01' },
            })
          : Response.json({ ok: true })
      },
      sleepImplementation: async (milliseconds) => {
        delays.push(milliseconds)
      },
      onAttempt: ({ number }) => attempts.push(number),
    })

    await expect(
      client.request({
        path: '/retry',
        schema: z.object({ ok: z.literal(true) }),
      })
    ).resolves.toEqual({ ok: true })
    expect(delays).toEqual([10])
    expect(attempts).toEqual([1, 2])
  })

  test('keeps independent cookie jars and redacts failed response bodies', async () => {
    const cookieHeaders: Array<string | null> = []
    const createFetch =
      (secret: string): typeof fetch =>
      async (_input, init) => {
        cookieHeaders.push(new Headers(init?.headers).get('cookie'))
        if (cookieHeaders.length <= 2) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { 'set-cookie': `session=${secret}; Path=/; HttpOnly` },
          })
        }
        return new Response(JSON.stringify({ error: `do not print ${secret}` }), { status: 400 })
      }
    const fetchImplementation = createFetch('synthetic-secret')
    const first = new E2eHttpClient({ baseUrl: 'http://127.0.0.1:1', fetchImplementation })
    const second = new E2eHttpClient({ baseUrl: 'http://127.0.0.1:1', fetchImplementation })
    const schema = z.object({ ok: z.literal(true) })

    await first.request({ path: '/login-a', schema })
    await second.request({ path: '/login-b', schema })
    expect(first.getCookieHeader()).toBe('session=synthetic-secret')
    expect(second.getCookieHeader()).toBe('session=synthetic-secret')

    await expect(first.request({ path: '/failure', schema })).rejects.not.toThrow(
      /synthetic-secret/
    )
    expect(cookieHeaders[0]).toBeNull()
    expect(cookieHeaders[1]).toBeNull()
    expect(cookieHeaders[2]).toBe('session=synthetic-secret')
  })
})
