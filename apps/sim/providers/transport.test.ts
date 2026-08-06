/**
 * @vitest-environment node
 *
 * Pinned against the vendored SDKs rather than against numbers typed from memory: if an
 * SDK bump moves a default, these fail and the divergence becomes a decision instead of
 * a surprise.
 */
import Cerebras from '@cerebras/cerebras_cloud_sdk'
import Groq from 'groq-sdk'
import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import {
  openAICompatTransport,
  PROVIDER_HEADERS_TIMEOUT_MS,
  PROVIDER_MAX_RETRIES,
} from '@/providers/transport'

describe('provider transport policy', () => {
  it('pins the headers budget to the vendored OpenAI client default', () => {
    expect(PROVIDER_HEADERS_TIMEOUT_MS).toBe(OpenAI.DEFAULT_TIMEOUT)
  })

  /**
   * Not lowered to 0 in favour of a hand-rolled loop: a chat completion is
   * non-idempotent and carries no idempotency key, and on the non-streaming path the
   * response exists only once the generation is already billed, so a replay re-bills
   * completed work.
   */
  it('keeps the vendor retry default rather than hand-rolling one', () => {
    expect(PROVIDER_MAX_RETRIES).toBe(OpenAI.DEFAULT_MAX_RETRIES ?? 2)
  })

  /**
   * The assertion that matters: object spread gets no excess-property checking, so a
   * renamed option in either SDK would become a silent no-op with a green typecheck.
   * These read the value back off a constructed client.
   */
  it('actually reaches the Groq client, which defaults to 60s', () => {
    const client = new Groq({ apiKey: 'test', ...openAICompatTransport() })
    expect(client.timeout).toBe(PROVIDER_HEADERS_TIMEOUT_MS)
    expect(client.maxRetries).toBe(PROVIDER_MAX_RETRIES)
  })

  it('actually reaches the Cerebras client, which defaults to 60s', () => {
    const client = new Cerebras({ apiKey: 'test', ...openAICompatTransport() })
    expect(client.timeout).toBe(PROVIDER_HEADERS_TIMEOUT_MS)
    expect(client.maxRetries).toBe(PROVIDER_MAX_RETRIES)
  })

  it('actually reaches an OpenAI-compatible client', () => {
    const client = new OpenAI({
      apiKey: 'test',
      baseURL: 'https://example.invalid',
      ...openAICompatTransport(),
    })
    expect(client.timeout).toBe(PROVIDER_HEADERS_TIMEOUT_MS)
    expect(client.maxRetries).toBe(PROVIDER_MAX_RETRIES)
  })

  /** Stamping a `fetch` wrapper here would convert a header-only timer into a total
   * deadline that truncates live streams, so the shape is pinned too. */
  it('stamps only constructor-safe options', () => {
    expect(Object.keys(openAICompatTransport()).sort()).toEqual(['maxRetries', 'timeout'])
  })
})
