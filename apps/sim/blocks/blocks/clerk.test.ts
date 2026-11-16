import { describe, expect, it } from 'vitest'
import { ClerkBlock } from '@/blocks/blocks/clerk'

/**
 * A tool call merges the stored row with the model's args (keyed by tool param names) and spreads
 * the mapper result over them; the operation arrives only in `context`.
 */
const toolCall = (args: Record<string, unknown>, operation: string) => ({
  ...args,
  ...ClerkBlock.tools.config?.params?.(args, { operation }),
})

describe('ClerkBlock tool calls', () => {
  it('parses metadata the model sends as a JSON string', () => {
    const params = toolCall(
      { secretKey: 'sk', emailAddress: ['a@example.com'], publicMetadata: '{"plan":"pro"}' },
      'clerk_create_user'
    )
    expect(params.publicMetadata).toEqual({ plan: 'pro' })
    expect(params.emailAddress).toEqual(['a@example.com'])
  })
})
