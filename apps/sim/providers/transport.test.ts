/**
 * @vitest-environment node
 *
 * These pin transport policy against the vendored SDK rather than against a number
 * typed from memory: if an `openai` bump moves `DEFAULT_TIMEOUT` or the retry default,
 * this fails and the divergence is a decision rather than a surprise.
 */
import { describe, expect, it } from 'vitest'
import {
  openAICompatTransport,
  PROVIDER_DISCOVERY_TIMEOUT_MS,
  PROVIDER_HEADERS_TIMEOUT_MS,
  PROVIDER_MAX_RETRIES,
} from '@/providers/transport'

describe('provider transport policy', () => {
  it('pins the headers budget to the vendored OpenAI client default', async () => {
    const { default: OpenAI } = await import('openai')
    expect(PROVIDER_HEADERS_TIMEOUT_MS).toBe(
      (OpenAI as unknown as { DEFAULT_TIMEOUT: number }).DEFAULT_TIMEOUT
    )
    expect(PROVIDER_HEADERS_TIMEOUT_MS).toBe(600_000)
  })

  /**
   * Not lowered to 0 on purpose. A chat completion is non-idempotent and carries no
   * idempotency key, and on the non-streaming path the response exists only once the
   * generation is already billed — so a replay re-bills completed work.
   */
  it('keeps the vendor retry default rather than hand-rolling one', () => {
    expect(PROVIDER_MAX_RETRIES).toBe(2)
  })

  it('stamps only constructor-safe options, since clients are memoised', () => {
    expect(openAICompatTransport()).toEqual({ timeout: 600_000, maxRetries: 2 })
  })

  /** A catalog probe must not inherit a generation-sized budget. */
  it('bounds discovery far below a generation', () => {
    expect(PROVIDER_DISCOVERY_TIMEOUT_MS).toBeLessThan(PROVIDER_HEADERS_TIMEOUT_MS / 10)
  })
})
