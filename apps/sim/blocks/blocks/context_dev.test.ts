import { describe, expect, it } from 'vitest'
import { ContextDevBlock } from '@/blocks/blocks/context_dev'

/**
 * A tool call merges the stored row with the model's args (keyed by tool param names) and spreads
 * the mapper result over them; the operation arrives only in `context`.
 */
const toolCall = (args: Record<string, unknown>, operation: string) => ({
  ...args,
  ...ContextDevBlock.tools.config?.params?.(args, { operation }),
})

describe('ContextDevBlock tool calls', () => {
  it('parses an extraction schema the model sends as a JSON string', () => {
    const params = toolCall(
      { apiKey: 'key', url: 'https://example.com', schema: '{"type":"object"}', maxPages: 3 },
      'extract'
    )
    expect(params.schema).toEqual({ type: 'object' })
    expect(params.maxPages).toBe(3)
  })
})
