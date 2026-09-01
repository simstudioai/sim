/**
 * @vitest-environment node
 *
 * Anthropic thinking config: the summarized-display opt-in is requested only
 * on agent-events runs and only for models whose registry marks summarized
 * streaming (the omitted-display Claude generations). Legacy runs keep the
 * exact pre-agent-events request shape.
 */
import { describe, expect, it } from 'vitest'
import { buildThinkingConfig } from '@/providers/anthropic/core'
import { describeModelLevel } from '@/providers/utils'

describe('buildThinkingConfig', () => {
  it('requests summarized display for omitted-display models on agent-events runs', () => {
    for (const model of [
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
    ]) {
      const config = buildThinkingConfig(model, 'high', true)
      expect(config?.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
      expect(config?.outputConfig).toEqual({ effort: 'high' })
    }
  })

  it('never adds display on legacy runs (no agent events)', () => {
    for (const model of [
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
    ]) {
      const config = buildThinkingConfig(model, 'high', false)
      expect(config?.thinking).toEqual({ type: 'adaptive' })
    }
  })

  it('requests summarized display for adaptive models marked as summary-streamed', () => {
    for (const model of ['claude-opus-4-6', 'claude-sonnet-4-6']) {
      const config = buildThinkingConfig(model, 'high', true)
      expect(config?.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    }
  })

  it('keeps budget-token models on the extended thinking path', () => {
    const config = buildThinkingConfig('claude-sonnet-4-5', 'high', true)
    expect(config?.thinking).toMatchObject({ type: 'enabled' })
    expect(config?.thinking).not.toHaveProperty('display')
  })

  it('returns null for unknown levels and non-thinking models', () => {
    expect(buildThinkingConfig('claude-fable-5', 'not-a-level', true)).toBeNull()
    expect(buildThinkingConfig('gpt-4o', 'high', true)).toBeNull()
  })
})

/**
 * A thinking level that is not one the model declares reaches this adapter, by design — Sim's
 * per-model lists can lag a provider. The adapter logs that it is ignoring it, and since the
 * field is reference-bound, the value it logs can be whatever a mistyped `{{ENV_VAR}}` or block
 * reference resolved to.
 */
describe('unsupported thinking level logging', () => {
  it('returns null for a level the model does not declare', () => {
    expect(buildThinkingConfig('claude-sonnet-5', 'sk-proj-abcdef0123456789', false)).toBeNull()
  })

  it('redacts the level in the ignore warning instead of echoing it', () => {
    const secret = 'sk-proj-abcdef0123456789'
    expect(describeModelLevel(secret)).toBe(`[redacted ${secret.length} chars]`)
    expect(describeModelLevel('high')).toBe('high')
  })
})
