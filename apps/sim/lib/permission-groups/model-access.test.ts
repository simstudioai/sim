/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createModelAccessGate } from '@/lib/permission-groups/model-access'

describe('createModelAccessGate', () => {
  it('allows everything when the group restricts nothing', () => {
    const gate = createModelAccessGate(null)
    expect(gate('gpt-4o')).toBe(true)
    expect(createModelAccessGate({ deniedModels: [], allowedModelProviders: null })).toBe(gate)
  })

  it('denies a listed model case-insensitively', () => {
    const gate = createModelAccessGate({ deniedModels: ['GPT-4o'], allowedModelProviders: null })
    expect(gate('gpt-4o')).toBe(false)
    expect(gate('claude-sonnet-4-5')).toBe(true)
  })

  it('denies a model whose provider is not allowlisted', () => {
    const gate = createModelAccessGate({ deniedModels: [], allowedModelProviders: ['anthropic'] })
    expect(gate('gpt-4o')).toBe(false)
    expect(gate('claude-sonnet-4-5')).toBe(true)
  })

  it('leaves an id that resolves to no chat provider to the denylist alone', () => {
    const gate = createModelAccessGate({
      deniedModels: ['eleven_multilingual_v2'],
      allowedModelProviders: ['anthropic'],
    })

    /* A speech/image/video id is not a provider choice, so the provider
       allowlist has nothing to say about it — only the denylist does. */
    expect(gate('eleven_turbo_v2_5')).toBe(true)
    expect(gate('eleven_multilingual_v2')).toBe(false)
  })
})
