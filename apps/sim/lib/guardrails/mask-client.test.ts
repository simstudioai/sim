import { resetUrlsMock, urlsMockFns } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { hybridAuthMockFns } from '@sim/testing/mocks/hybrid-auth.mock'
import { utilsHelpersMock, utilsHelpersMockFns } from '@sim/testing/mocks/utils-helpers.mock'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(resetUrlsMock)

const mockToken = authInternalMockFns.mockGenerateInternalToken

const mockBaseUrl = urlsMockFns.mockGetInternalApiBaseUrl

vi.mock('@/lib/auth/internal', () => authInternalMock)
vi.mock('@sim/utils/helpers', () => utilsHelpersMock)

import { maskPIIBatchViaHttp } from '@/lib/guardrails/mask-client'
import { PII_MAX_TEXT_CHARS } from '@/lib/guardrails/pii-batching'
import { POST as maskBatchRoute } from '@/app/api/guardrails/mask-batch/route'

const mockSleep = utilsHelpersMockFns.mockSleep

describe('maskPIIBatchViaHttp', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockToken.mockResolvedValue('tok')
    mockBaseUrl.mockReturnValue('http://app.internal:3000')
    fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const { texts } = JSON.parse(init.body) as { texts: string[] }
      return new Response(JSON.stringify({ masked: texts.map((t) => `M(${t})`) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('splits by count into multiple requests, preserving global order', async () => {
    const texts = Array.from({ length: 5000 }, (_, i) => `t${i}`)

    const { masked: out } = await maskPIIBatchViaHttp(texts, [])

    expect(out).toHaveLength(5000)
    expect(out[0]).toBe('M(t0)')
    expect(out[4999]).toBe('M(t4999)')
    expect(fetchMock).toHaveBeenCalledTimes(3) // 2000-per-request cap
  })

  it('throws immediately on a deterministic 4xx without retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad request', { status: 400 }))

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/mask-batch request failed/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockSleep).not.toHaveBeenCalled()
  })

  it('retries a transient 5xx with backoff and then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(new Response('deploying', { status: 503 }))

    const { masked } = await maskPIIBatchViaHttp(['a'], [])

    expect(masked).toEqual(['M(a)'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockSleep).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry budget is exhausted on a persistent 5xx', async () => {
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }))

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/mask-batch request failed/)
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(mockSleep).toHaveBeenCalledTimes(7)
  })

  it('stops after three attempts on a persistent 500, which can be a deterministic input failure', async () => {
    fetchMock.mockImplementation(async () => new Response('failed', { status: 500 }))

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/mask-batch request failed/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(mockSleep).toHaveBeenCalledTimes(2)
  })

  describe('with a text longer than one Presidio pass allows', () => {
    /** Each request masks `Ada` to `<PERSON>`, so pieces rejoin to the masked whole. */
    const maskingAda = () =>
      fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
        const { texts } = JSON.parse(init.body) as { texts: string[] }
        return Response.json({ masked: texts.map((t) => t.replaceAll('Ada', '<PERSON>')) })
      })
    const sentPieces = () =>
      fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body).texts as string[])

    it('sends newline-aligned pieces within the limit and rejoins the masked result', async () => {
      maskingAda()
      const text = Array.from({ length: 60_000 }, (_, i) => `row ${i} owner Ada\n`).join('')

      const { masked } = await maskPIIBatchViaHttp([text, 'short Ada'], ['PERSON'])

      expect(masked).toEqual([text.replaceAll('Ada', '<PERSON>'), 'short <PERSON>'])
      const pieces = sentPieces().filter((p) => p !== 'short Ada')
      expect(pieces.length).toBeGreaterThan(1)
      expect(pieces.join('')).toBe(text)
      for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(PII_MAX_TEXT_CHARS)
      for (const piece of pieces.slice(0, -1)) expect(piece.endsWith('\n')).toBe(true)
    })

    it('cuts minified JSON at punctuation so no email is split across pieces', async () => {
      maskingAda()
      const record = '{"email":"ada.lovelace@example.com","id":1234}'
      const text = `[${Array.from({ length: 25_000 }, () => record).join(',')}]`

      await maskPIIBatchViaHttp([text], ['EMAIL_ADDRESS'])

      const pieces = sentPieces()
      expect(pieces.length).toBeGreaterThan(1)
      const emailsSent = pieces.reduce(
        (count, piece) => count + piece.split('ada.lovelace@example.com').length - 1,
        0
      )
      expect(emailsSent).toBe(25_000)
    })

    it('never splits a surrogate pair when the text has nothing to cut at', async () => {
      // One leading unit puts a high surrogate exactly where a hard cut would land.
      const text = `a${'\u{1F600}'.repeat(PII_MAX_TEXT_CHARS)}`

      const { masked } = await maskPIIBatchViaHttp([text], [])

      const pieces = sentPieces()
      expect(pieces.length).toBeGreaterThan(1)
      expect(pieces.join('')).toBe(text)
      expect(masked).toEqual([`M(${pieces.join(')M(')})`])
    })

    it('replaces the whole text when any one of its pieces fails', async () => {
      const text = `${'safe line\n'.repeat(120_000)}poison`
      fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
        const { texts } = JSON.parse(init.body) as { texts: string[] }
        if (texts.some((t) => t.endsWith('poison'))) return new Response('no', { status: 422 })
        return Response.json({ masked: texts })
      })

      const { masked, scrubbedCount } = await maskPIIBatchViaHttp(
        [text],
        [],
        undefined,
        undefined,
        { failedChunkPlaceholder: '[FAILED]' }
      )

      expect(masked).toEqual(['[FAILED]'])
      expect(scrubbedCount).toBe(1)
    })
  })

  describe('with a failed-chunk placeholder', () => {
    const PLACEHOLDER = '[FAILED]'
    const CHUNK_SIZE = 2000
    const CONCURRENCY = 64
    /**
     * Fills every concurrent slot with chunks the service fails, then queues two more
     * chunks (`'queued'`) that it would mask if they were ever sent.
     */
    const failingThenQueued = () => [
      ...Array.from({ length: CHUNK_SIZE * CONCURRENCY }, () => 'failing'),
      ...Array.from({ length: CHUNK_SIZE + 1 }, () => 'queued'),
    ]
    const serviceFailingWith = (status: number) =>
      fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
        const { texts } = JSON.parse(init.body) as { texts: string[] }
        if (texts[0] !== 'queued') return new Response('failed', { status })
        return Response.json({ masked: texts.map((t) => `M(${t})`) })
      })

    it('scrubs queued chunks without sending them once an outage outlives its retries', async () => {
      serviceFailingWith(503)

      const { masked } = await maskPIIBatchViaHttp(failingThenQueued(), [], undefined, undefined, {
        failedChunkPlaceholder: PLACEHOLDER,
      })

      expect(masked.every((value) => value === PLACEHOLDER)).toBe(true)
    })

    it('still masks queued chunks after a persistent 500, which is not an outage', async () => {
      serviceFailingWith(500)

      const { masked } = await maskPIIBatchViaHttp(failingThenQueued(), [], undefined, undefined, {
        failedChunkPlaceholder: PLACEHOLDER,
      })

      expect(masked.slice(0, CHUNK_SIZE * CONCURRENCY).every((v) => v === PLACEHOLDER)).toBe(true)
      expect(masked.slice(CHUNK_SIZE * CONCURRENCY).every((v) => v === 'M(queued)')).toBe(true)
    })
  })

  it('does not retry a null 200 body (deterministic, not a transient TypeError)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })
    )

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/unexpected result/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockSleep).not.toHaveBeenCalled()
  })

  describe('through the real mask-batch route', () => {
    let presidioTexts: string[][]

    beforeEach(() => {
      presidioTexts = []
      hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({ success: true })
      fetchMock.mockImplementation(
        async (url: string, init: { body: string; headers: Record<string, string> }) => {
          if (url.startsWith('http://app.internal:3000')) {
            return maskBatchRoute(
              new NextRequest(url, { method: 'POST', body: init.body, headers: init.headers }),
              createRouteContext({})
            )
          }
          const { texts } = JSON.parse(init.body) as { texts: string[] }
          presidioTexts.push(texts)
          return Response.json({
            texts: texts.map((t) => t.replace('ada@example.com', '<EMAIL>')),
          })
        }
      )
    })

    it('masks a chunk whose strings carry a NUL instead of failing the whole chunk', async () => {
      const { masked, scrubbedCount } = await maskPIIBatchViaHttp(
        ['mail ada@example.com\u0000end', 'plain text'],
        ['EMAIL_ADDRESS'],
        undefined,
        undefined,
        { failedChunkPlaceholder: '[FAILED]' }
      )

      expect(scrubbedCount).toBe(0)
      expect(masked).toEqual(['mail <EMAIL>\uFFFDend', 'plain text'])
    })

    it('sends text without a NUL to Presidio unchanged', async () => {
      const text = 'mail ada@example.com \u{1F600} done'

      const { masked } = await maskPIIBatchViaHttp([text], ['EMAIL_ADDRESS'])

      expect(presidioTexts).toEqual([[text]])
      expect(masked).toEqual(['mail <EMAIL> \u{1F600} done'])
    })
  })
})
