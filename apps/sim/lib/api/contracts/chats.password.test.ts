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
import { v2ReplaceChatDeploymentBodySchema } from '@/lib/api/contracts/v2/chat-deployments'

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

  it('requires at least 15 characters for a new password', () => {
    const result = chatDeploymentPasswordSchema.safeParse('short-password')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('Password must be at least 15 characters')
  })

  it('continues accepting legacy short passwords at the deployed login gate', () => {
    expect(deployedChatAuthBodySchema.safeParse({ password: 'legacy' }).success).toBe(true)
  })

  it('preserves surrounding whitespace, which login compares byte-exact', () => {
    expect(chatDeploymentPasswordSchema.parse('  hunter2hunter2  ')).toBe('  hunter2hunter2  ')
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
    expect(
      createChatBodySchema.safeParse({ ...createBody, password: 'correct-password' }).success
    ).toBe(true)

    expect(updateChatBodySchema.safeParse({ password: '   ' }).success).toBe(false)
    expect(updateChatBodySchema.safeParse({ password: tooLong }).success).toBe(false)
    expect(updateChatBodySchema.safeParse({ password: '' }).success).toBe(true)
  })

  /**
   * Only the use case knows whether the caller is Sim's agent, whose reference
   * resolves before the password rules apply, so v2 admits a whole-value
   * reference below the password minimum. Every other short value, and the internal surface,
   * stay refused with the password message rather than a generic union failure.
   */
  it('admits a short whole-value reference on v2 only', () => {
    const body = { identifier: 'support', title: 'Support', authType: 'password' }

    expect(
      v2ReplaceChatDeploymentBodySchema.safeParse({ ...body, password: '{{PW}}' }).success
    ).toBe(true)
    expect(
      v2ReplaceChatDeploymentBodySchema.safeParse({ ...body, password: 'x-{{PW}}' }).error
        ?.issues[0].message
    ).toBe('Password must be at least 15 characters')
    expect(
      v2ReplaceChatDeploymentBodySchema.safeParse({ ...body, password: '   ' }).error?.issues[0]
        .message
    ).toBe('Password cannot contain only whitespace')
    expect(chatDeploymentPasswordSchema.safeParse('{{PW}}').success).toBe(false)
  })
})
