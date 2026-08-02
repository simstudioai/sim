/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  chatDeploymentPasswordSchema,
  createChatBodySchema,
  deployedChatAuthBodySchema,
  deployedChatPostBodySchema,
  updateChatBodySchema,
} from '@/lib/api/contracts/chats'

const createBody = {
  workflowId: 'wf-1',
  identifier: 'my-chat',
  title: 'Support',
  customizations: { primaryColor: 'var(--brand-hover)', welcomeMessage: 'Hi' },
}

describe('chat deployment password contract', () => {
  it('accepts the empty string, which means "keep the stored password"', () => {
    expect(chatDeploymentPasswordSchema.safeParse('').success).toBe(true)
  })

  it('rejects a whitespace-only password', () => {
    const result = chatDeploymentPasswordSchema.safeParse('   ')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('Password cannot contain only whitespace')
  })

  it('preserves surrounding whitespace, which login compares byte-exact', () => {
    expect(chatDeploymentPasswordSchema.parse('  hunter2  ')).toBe('  hunter2  ')
  })

  /**
   * The security-relevant invariant: a password long enough to save must still
   * be short enough to submit. If the set path outgrew the login path, the
   * deployment would be permanently unreachable — the login POST would 400 on
   * length before authentication ever ran.
   */
  it('caps length at the same boundary the deployed-chat login enforces', () => {
    const atLimit = 'a'.repeat(1024)
    const overLimit = 'a'.repeat(1025)

    expect(chatDeploymentPasswordSchema.safeParse(atLimit).success).toBe(true)
    expect(chatDeploymentPasswordSchema.safeParse(overLimit).success).toBe(false)

    expect(deployedChatAuthBodySchema.safeParse({ password: atLimit }).success).toBe(true)
    expect(deployedChatPostBodySchema.safeParse({ password: atLimit }).success).toBe(true)
  })

  it('applies to both the create and update bodies', () => {
    const tooLong = 'a'.repeat(1025)

    expect(createChatBodySchema.safeParse({ ...createBody, password: '   ' }).success).toBe(false)
    expect(createChatBodySchema.safeParse({ ...createBody, password: tooLong }).success).toBe(false)
    expect(createChatBodySchema.safeParse({ ...createBody, password: 'ok' }).success).toBe(true)

    expect(updateChatBodySchema.safeParse({ password: '   ' }).success).toBe(false)
    expect(updateChatBodySchema.safeParse({ password: tooLong }).success).toBe(false)
    expect(updateChatBodySchema.safeParse({ password: '' }).success).toBe(true)
  })
})
