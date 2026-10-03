import { describe, expect, it } from 'vitest'
import { credentialGroupOAuthCallbackQuerySchema } from '@/lib/api/contracts/credential-groups'

describe('credential group contracts', () => {
  it('accepts an Atlassian-sized authorization code', () => {
    const parsed = credentialGroupOAuthCallbackQuerySchema.safeParse({
      state: `cg_${'a'.repeat(36)}`,
      code: 'a'.repeat(4096),
    })

    expect(parsed.success).toBe(true)
  })

  it('still rejects an unbounded authorization code', () => {
    const parsed = credentialGroupOAuthCallbackQuerySchema.safeParse({
      state: `cg_${'a'.repeat(36)}`,
      code: 'a'.repeat(8193),
    })

    expect(parsed.success).toBe(false)
  })
})
