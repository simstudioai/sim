/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createChatBodySchema,
  deployedChatConfigSchema,
  updateChatBodySchema,
} from '@/lib/api/contracts/chats'
import { chatDetailSchema } from '@/lib/api/contracts/deployments'

describe('chat agent-event policy contracts', () => {
  it('create defaults both policies to false', () => {
    const parsed = createChatBodySchema.parse({
      workflowId: 'wf-1',
      identifier: 'my-chat',
      title: 'Support',
      customizations: {
        primaryColor: 'var(--brand-hover)',
        welcomeMessage: 'Hi',
      },
    })
    expect(parsed.includeThinking).toBe(false)
    expect(parsed.includeToolCalls).toBe(false)
  })

  it('create accepts independent policy values', () => {
    const parsed = createChatBodySchema.parse({
      workflowId: 'wf-1',
      identifier: 'my-chat',
      title: 'Support',
      customizations: {
        primaryColor: 'var(--brand-hover)',
        welcomeMessage: 'Hi',
      },
      includeThinking: true,
      includeToolCalls: false,
    })
    expect(parsed.includeThinking).toBe(true)
    expect(parsed.includeToolCalls).toBe(false)
  })

  it('update accepts independent policy toggles', () => {
    expect(updateChatBodySchema.parse({ includeThinking: true }).includeThinking).toBe(true)
    expect(updateChatBodySchema.parse({ includeThinking: false }).includeThinking).toBe(false)
    expect(updateChatBodySchema.parse({ title: 'x' }).includeThinking).toBeUndefined()
    expect(updateChatBodySchema.parse({ includeToolCalls: true }).includeToolCalls).toBe(true)
    expect(updateChatBodySchema.parse({ includeToolCalls: false }).includeToolCalls).toBe(false)
    expect(updateChatBodySchema.parse({ title: 'x' }).includeToolCalls).toBeUndefined()
  })

  it('chat detail and deployed config expose both policies', () => {
    const detail = chatDetailSchema.parse({
      id: 'chat-1',
      identifier: 'my-chat',
      title: 'Support',
      description: '',
      authType: 'public',
      allowedEmails: [],
      outputConfigs: [],
      isActive: true,
      chatUrl: 'http://localhost/chat/my-chat',
      hasPassword: false,
    })
    expect(detail.includeThinking).toBe(false)
    expect(detail.includeToolCalls).toBe(false)

    const detailOn = chatDetailSchema.parse({
      ...detail,
      includeThinking: true,
      includeToolCalls: true,
    })
    expect(detailOn.includeThinking).toBe(true)
    expect(detailOn.includeToolCalls).toBe(true)

    const config = deployedChatConfigSchema.parse({
      id: 'chat-1',
      title: 'Support',
      description: '',
      customizations: {},
      authType: 'public',
    })
    expect(config.includeThinking).toBe(false)
    expect(config.includeToolCalls).toBe(false)
  })
})
