import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mocks.fetch,
}))

import { createNativeClient } from '@/lib/sim-search/live/http'

describe('native search network boundary', () => {
  beforeEach(() => {
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 200 }))
  })
  it('encodes query text and forbids credential-bearing redirects', async () => {
    const client = createNativeClient({
      origin: 'https://www.googleapis.com',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await client.json('/drive/v3/files', { query: { q: "name contains 'a&b'" } })
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files?q=name+contains+%27a%26b%27',
      expect.objectContaining({
        maxRedirects: 0,
        maxResponseBytes: 4194304,
        timeout: 10000,
        headers: expect.objectContaining({ Authorization: 'Bearer private' }),
      })
    )
  })
  it('stops at its request budget, which defaults to one search', async () => {
    mocks.fetch.mockImplementation(async () => new Response('{}', { status: 200 }))
    const clientWith = (requestBudget?: number) =>
      createNativeClient({
        origin: 'https://api.github.com',
        accessToken: 'private',
        signal: new AbortController().signal,
        requestBudget,
      })
    const exhaust = async (client: ReturnType<typeof clientWith>, requests: number) => {
      for (let request = 0; request < requests; request++) await client.json('/user')
    }
    await exhaust(clientWith(), 30)
    const single = clientWith()
    await exhaust(single, 30)
    await expect(single.json('/user')).rejects.toThrow('Request budget reached')
    const shared = clientWith(60)
    await exhaust(shared, 60)
    await expect(shared.json('/user')).rejects.toThrow('Request budget reached')
  })
  it('does not send a token to an absolute or protocol-relative model URL', async () => {
    const client = createNativeClient({
      origin: 'https://api.github.com',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await expect(client.json('//evil.test')).rejects.toThrow('Invalid provider path')
    await expect(client.json('https://evil.test')).rejects.toThrow('Invalid provider path')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('cannot move a non-Google token to the Sheets API', async () => {
    const client = createNativeClient({
      origin: 'https://api.github.com',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await expect(client.json('/v4/spreadsheets/id', { googleService: 'sheets' })).rejects.toThrow(
      'Invalid Google service'
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('reports Retry-After without exposing the provider response body', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('sensitive diagnostic', { status: 429, headers: { 'Retry-After': '45' } })
    )
    const client = createNativeClient({
      origin: 'https://slack.com',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await expect(
      client.json('/api/assistant.search.context', { body: { query: 'launch' } })
    ).rejects.toMatchObject({ status: 'rate_limited', retryAfterSeconds: 45 })
  })
  it('keeps self-hosted GitLab calls on the verified instance including its port', async () => {
    const client = createNativeClient({
      origin: 'https://gitlab.example.com:8443',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await client.json('/api/v4/projects/team%2Frepo/search', {
      query: { scope: 'blobs', search: 'launch' },
    })
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://gitlab.example.com:8443/api/v4/projects/team%2Frepo/search?scope=blobs&search=launch',
      expect.objectContaining({
        maxRedirects: 0,
        headers: expect.objectContaining({ Authorization: 'Bearer private' }),
      })
    )
  })
  it('reports a Google quota 403 as a rate limit rather than a reconnect', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }], message: 'private' },
        }),
        { status: 403 }
      )
    )
    const client = createNativeClient({
      origin: 'https://www.googleapis.com',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await expect(client.json('/drive/v3/files')).rejects.toMatchObject({
      status: 'rate_limited',
      message: 'Provider rate limit reached. Try again later.',
    })
  })
  it('still asks for a reconnect when Google denies access', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }] } }), {
        status: 403,
      })
    )
    const client = createNativeClient({
      origin: 'https://www.googleapis.com',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await expect(client.json('/drive/v3/files')).rejects.toMatchObject({ status: 'reconnect' })
  })
  it('does not issue any request after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = createNativeClient({
      origin: 'https://slack.com',
      accessToken: 'private',
      signal: controller.signal,
    })
    await expect(client.json('/api/assistant.search.context')).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('memoizes a repeated GET by path and query, never a request with a body', async () => {
    mocks.fetch.mockImplementation(async () => new Response('{"ok":true}', { status: 200 }))
    const client = createNativeClient({
      origin: 'https://slack.com',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await client.json('/api/team.info', { query: { team: 'a' }, memo: true })
    await client.json('/api/team.info', { query: { team: 'a' }, memo: true })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    await client.json('/api/team.info', { query: { team: 'b' }, memo: true })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    await client.json('/api/search', { body: { query: 'launch' }, memo: true })
    await client.json('/api/search', { body: { query: 'launch' }, memo: true })
    expect(mocks.fetch).toHaveBeenCalledTimes(4)
  })
  it('reads a quota-shaped 403 body only from Google origins', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), { status: 403 })
    )
    const client = createNativeClient({
      origin: 'https://slack.com',
      accessToken: 'private',
      signal: new AbortController().signal,
    })
    await expect(client.json('/api/search.messages')).rejects.toMatchObject({ status: 'reconnect' })
  })
})
