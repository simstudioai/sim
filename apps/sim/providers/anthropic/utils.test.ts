/**
 * @vitest-environment node
 */
import type { TextBlockParam, Tool } from '@anthropic-ai/sdk/resources'
import { describe, expect, it } from 'vitest'
import { applyAnthropicPromptCache } from '@/providers/anthropic/utils'

const LARGE = 'x'.repeat(8_000) // ~2,000 est. tokens, above the 1,024 gate
const SMALL = 'x'.repeat(400) // ~100 est. tokens, below the gate

const tool = (name: string): Tool => ({
  name,
  description: 'does a thing',
  input_schema: { type: 'object', properties: {} },
})

describe('applyAnthropicPromptCache', () => {
  it('converts a large system prompt to a cached text block and tags the last tool', () => {
    const payload: { system?: string | TextBlockParam[] } = { system: LARGE }
    const tools = [tool('a'), tool('b')]

    applyAnthropicPromptCache(payload, tools, LARGE)

    expect(Array.isArray(payload.system)).toBe(true)
    const blocks = payload.system as TextBlockParam[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'text',
      text: LARGE,
      cache_control: { type: 'ephemeral' },
    })
    // Only the LAST tool carries the breakpoint; earlier tools are untouched.
    expect(tools[0].cache_control).toBeUndefined()
    expect(tools[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('tags the system block when the system alone is large and there are no tools', () => {
    const payload: { system?: string | TextBlockParam[] } = { system: LARGE }

    applyAnthropicPromptCache(payload, undefined, LARGE)

    const blocks = payload.system as TextBlockParam[]
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('tags the tools even when payload.system was relocated/blanked (gate uses the request prompt)', () => {
    // No-messages path: the provider moves the system text into a user message
    // and blanks payload.system, but the original prompt is large, so the tools
    // prefix is still worth caching.
    const payload: { system?: string | TextBlockParam[] } = { system: '' }
    const tools = [tool('a')]

    applyAnthropicPromptCache(payload, tools, LARGE)

    expect(payload.system).toBe('') // empty system is never converted
    expect(tools[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('caches when payload.system is large from appended schema text even if the request prompt is small', () => {
    // Prompt-based structured output appends a large schema to payload.system,
    // so the cacheable system block is large even though request.systemPrompt is small.
    const payload: { system?: string | TextBlockParam[] } = { system: LARGE }

    applyAnthropicPromptCache(payload, undefined, SMALL)

    expect(Array.isArray(payload.system)).toBe(true)
    expect((payload.system as TextBlockParam[])[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('leaves a small, tool-less prefix untouched (no write surcharge on one-shot calls)', () => {
    const payload: { system?: string | TextBlockParam[] } = { system: SMALL }

    applyAnthropicPromptCache(payload, undefined, SMALL)

    expect(payload.system).toBe(SMALL)
  })

  it('does nothing when the combined prefix is below the threshold', () => {
    const payload: { system?: string | TextBlockParam[] } = { system: SMALL }
    const tools = [tool('a')]

    applyAnthropicPromptCache(payload, tools, SMALL)

    expect(payload.system).toBe(SMALL)
    expect(tools[0].cache_control).toBeUndefined()
  })
})
