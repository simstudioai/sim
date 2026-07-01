/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { shouldCacheStaticPrefix } from '@/providers/prompt-cache'

const LARGE = 'x'.repeat(8_000) // ~2,000 est. tokens, above the 1,024 gate
const SMALL = 'x'.repeat(400) // ~100 est. tokens, below the gate

describe('shouldCacheStaticPrefix', () => {
  it('caches a large system prompt that has tools (agent loop)', () => {
    expect(shouldCacheStaticPrefix({ systemPrompt: LARGE, hasTools: true })).toBe(true)
  })

  it('caches a large system prompt even without tools', () => {
    expect(shouldCacheStaticPrefix({ systemPrompt: LARGE, hasTools: false })).toBe(true)
  })

  it('reaches the threshold via tools when the system prompt alone is below it', () => {
    // Small system + large serialized tools clears the combined threshold, and
    // tools imply reuse, so it should cache.
    expect(
      shouldCacheStaticPrefix({ systemPrompt: SMALL, hasTools: true, toolsApproxChars: 8_000 })
    ).toBe(true)
  })

  it('does NOT cache a small, tool-less prompt (one-shot write surcharge avoided)', () => {
    expect(shouldCacheStaticPrefix({ systemPrompt: SMALL, hasTools: false })).toBe(false)
  })

  it('does NOT cache a small system even with tools when the combined prefix is below threshold', () => {
    expect(
      shouldCacheStaticPrefix({ systemPrompt: SMALL, hasTools: true, toolsApproxChars: 400 })
    ).toBe(false)
  })

  it('does NOT cache when there is no system prompt', () => {
    expect(
      shouldCacheStaticPrefix({ systemPrompt: '', hasTools: true, toolsApproxChars: 8_000 })
    ).toBe(false)
    expect(shouldCacheStaticPrefix({ systemPrompt: null, hasTools: true })).toBe(false)
  })
})
