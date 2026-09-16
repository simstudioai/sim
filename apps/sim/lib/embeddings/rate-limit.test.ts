/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseGoDurationMs, resolveEmbeddingRetryDelayMs } from '@/lib/embeddings/rate-limit'

function headers(values: Record<string, string>): { get(name: string): string | null } {
  return { get: (name: string) => values[name] ?? null }
}

describe('parseGoDurationMs', () => {
  it('reads the shapes OpenAI documents for its reset headers', () => {
    expect(parseGoDurationMs('1s')).toBe(1000)
    expect(parseGoDurationMs('6m0s')).toBe(360_000)
    expect(parseGoDurationMs('23h47m36.648s')).toBeCloseTo(85_656_648, 0)
  })

  /**
   * `m` and `ms` share a prefix, so a parser that matched the shorter unit first
   * would read a twelve-millisecond wait as a twelve-minute one — a 60,000x
   * overstatement that would stall ingestion on a healthy provider.
   */
  it('does not confuse milliseconds with minutes', () => {
    expect(parseGoDurationMs('12ms')).toBe(12)
    expect(parseGoDurationMs('12m')).toBe(720_000)
  })

  it('refuses a value the format does not fully describe', () => {
    expect(parseGoDurationMs('')).toBeNull()
    expect(parseGoDurationMs('   ')).toBeNull()
    expect(parseGoDurationMs('soon')).toBeNull()
    expect(parseGoDurationMs('60')).toBeNull()
    expect(parseGoDurationMs('1s later')).toBeNull()
    expect(parseGoDurationMs('1y')).toBeNull()
  })
})

describe('resolveEmbeddingRetryDelayMs', () => {
  it('prefers Retry-After, which names the wait directly', () => {
    expect(
      resolveEmbeddingRetryDelayMs(
        headers({ 'retry-after': '20', 'x-ratelimit-reset-tokens': '6m0s' })
      )
    ).toBe(20_000)
  })

  /**
   * The cap in `parseRetryAfter` defaults to 30s. The retry loop owns the clamp
   * against its own ceiling, so a longer stated wait must arrive intact rather
   * than being silently truncated on the way in.
   */
  it('passes a long Retry-After through uncapped', () => {
    expect(resolveEmbeddingRetryDelayMs(headers({ 'retry-after': '120' }))).toBe(120_000)
  })

  it('falls back to the reset of the dimension that is actually exhausted', () => {
    expect(
      resolveEmbeddingRetryDelayMs(
        headers({
          'x-ratelimit-remaining-tokens': '0',
          'x-ratelimit-reset-tokens': '45s',
          'x-ratelimit-remaining-requests': '4999',
          'x-ratelimit-reset-requests': '6m0s',
        })
      )
    ).toBe(45_000)
  })

  it('waits out the longer window when both dimensions are exhausted', () => {
    expect(
      resolveEmbeddingRetryDelayMs(
        headers({
          'x-ratelimit-remaining-tokens': '0',
          'x-ratelimit-reset-tokens': '45s',
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '6m0s',
        })
      )
    ).toBe(360_000)
  })

  /**
   * Providers stamp these headers on every response. A reset read while quota
   * remains says when the window rolls over, not when this request may be
   * retried — using it would pin an unrelated failure to a flat wait.
   */
  it('says nothing when no dimension is exhausted', () => {
    expect(
      resolveEmbeddingRetryDelayMs(
        headers({
          'x-ratelimit-remaining-tokens': '150000',
          'x-ratelimit-reset-tokens': '6m0s',
        })
      )
    ).toBeNull()
  })

  it('says nothing when the response carries no rate-limit headers', () => {
    expect(resolveEmbeddingRetryDelayMs(headers({}))).toBeNull()
  })
  it('honors an exhausted project token pool even when the individual key reports capacity', () => {
    expect(
      resolveEmbeddingRetryDelayMs(
        new Headers({
          'x-ratelimit-remaining-tokens': '1000',
          'x-ratelimit-reset-tokens': '1s',
          'x-ratelimit-remaining-project-tokens': '0',
          'x-ratelimit-reset-project-tokens': '1m30s',
        })
      )
    ).toBe(90_000)
  })
})
