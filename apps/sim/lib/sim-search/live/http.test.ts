/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mocks.fetch,
}))

import { createNativeClient } from '@/lib/sim-search/live/http'

describe('native search network boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
