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

describe('chat includeThinking contracts (Step 4)', () => {
  it('create defaults includeThinking to false', () => {
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
  })

  it('create accepts includeThinking true', () => {
    const parsed = createChatBodySchema.parse({
      workflowId: 'wf-1',
      identifier: 'my-chat',
      title: 'Support',
      customizations: {
        primaryColor: 'var(--brand-hover)',
        welcomeMessage: 'Hi',
      },
      includeThinking: true,
    })
    expect(parsed.includeThinking).toBe(true)
  })

  it('update accepts includeThinking toggle', () => {
    expect(updateChatBodySchema.parse({ includeThinking: true }).includeThinking).toBe(true)
    expect(updateChatBodySchema.parse({ includeThinking: false }).includeThinking).toBe(false)
    expect(updateChatBodySchema.parse({ title: 'x' }).includeThinking).toBeUndefined()
  })

  it('chat detail and deployed config expose includeThinking (default false)', () => {
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

    const detailOn = chatDetailSchema.parse({
      ...detail,
      includeThinking: true,
    })
    expect(detailOn.includeThinking).toBe(true)

    const config = deployedChatConfigSchema.parse({
      id: 'chat-1',
      title: 'Support',
      description: '',
      customizations: {},
      authType: 'public',
    })
    expect(config.includeThinking).toBe(false)
  })
})
