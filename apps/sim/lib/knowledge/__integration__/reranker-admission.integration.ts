/** Real PostgreSQL admission with a synthetic provider response; no Cohere credential is used. */
import { db } from '@sim/db'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import { DbTokenBucket } from '@/lib/core/rate-limiter/storage/db-token-bucket'
import { rerank } from '@/lib/knowledge/reranker'

describe('reranker shared PostgreSQL admission', () => {
  const keys = [generateId(), generateId()]
  const originalKey = env.COHERE_API_KEY
  const storage = new DbTokenBucket()
  const upstream = vi.fn()
  const options = { model: 'rerank-v4.0-fast' }
  const items = [{ id: 'fixture-chunk', text: 'Synthetic Orion release checklist' }]

  beforeAll(() => {
    Object.assign(env, { COHERE_API_KEY: keys[0] })
    vi.stubGlobal('fetch', upstream)
  })

  afterAll(async () => {
    Object.assign(env, { COHERE_API_KEY: originalKey })
    vi.unstubAllGlobals()
    for (const key of keys) {
      const identity = `provider:rerank:cohere:${sha256Hex(key)}`
      for (const suffix of ['requests', 'cooldown', 'quota']) {
        await storage.resetBucket(`${identity}:${suffix}`)
      }
    }
    await db.$client.end()
  })

  it('persists a provider pause that stops concurrent RAG requests before another HTTP call', async () => {
    upstream.mockImplementation(async (url: string) => {
      expect(url).toBe('https://api.cohere.com/v2/rerank')
      return new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
    })
    await expect(rerank('Orion', items, options)).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 60_000,
    })
    const pausedUntil = await storage.getCooldownUntil(
      `provider:rerank:cohere:${sha256Hex(keys[0])}:cooldown`
    )
    expect(pausedUntil!.getTime()).toBeGreaterThan(Date.now() + 30_000)

    const cohort = await Promise.allSettled(
      Array.from({ length: 5 }, () => rerank('Orion', items, options))
    )
    expect(cohort).toHaveLength(5)
    for (const result of cohort) {
      expect(result).toMatchObject({
        status: 'rejected',
        reason: { name: 'ProviderAdmissionTimeoutError' },
      })
    }
    expect(upstream).toHaveBeenCalledOnce()
  })

  it('admits an unrelated credential while the original credential remains paused', async () => {
    Object.assign(env, { COHERE_API_KEY: keys[1] })
    upstream.mockImplementation(async () =>
      Response.json({ results: [{ index: 0, relevance_score: 0.9 }] })
    )
    await expect(rerank('Orion', items, options)).resolves.toMatchObject({
      results: [{ item: items[0], relevanceScore: 0.9 }],
    })
    Object.assign(env, { COHERE_API_KEY: keys[0] })
    await expect(rerank('Orion', items, options)).rejects.toMatchObject({
      name: 'ProviderAdmissionTimeoutError',
    })
    expect(upstream).toHaveBeenCalledTimes(2)
  })
})
