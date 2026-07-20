import { describe, expect, it } from 'vitest'
import { resolvePiModelId } from '@/executor/handlers/pi/pi-models'

describe('Pi model catalog', () => {
  it('keeps exact provider-relative model IDs', () => {
    expect(resolvePiModelId('anthropic', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  it('normalizes Sim provider prefixes only when Pi declares the resulting ID', () => {
    expect(resolvePiModelId('groq', 'groq/openai/gpt-oss-120b')).toBe('openai/gpt-oss-120b')
    expect(resolvePiModelId('cerebras', 'cerebras/gpt-oss-120b')).toBe('gpt-oss-120b')
    expect(resolvePiModelId('groq', 'groq/unknown-model')).toBeUndefined()
  })

  it('rejects provider/model pairs absent from the installed Pi catalog', () => {
    expect(resolvePiModelId('anthropic', 'claude-sonnet-5')).toBeUndefined()
    expect(resolvePiModelId('unsupported', 'model')).toBeUndefined()
  })
})
