/**
 * Agent tool calls pass the operation in context and supply arguments under the tool's param
 * names (`status`, `type`, `sortField`), which the mapper spreads over and must keep.
 */
import { describe, expect, it } from 'vitest'
import { HelpScoutBlock } from '@/blocks/blocks/helpscout'

function agentParams(operation: string, args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, ...(HelpScoutBlock.tools.config?.params?.(args, { operation }) ?? {}) }
}

describe('HelpScoutBlock agent tool calls', () => {
  it('keeps the model status when updating a conversation status', () => {
    const params = agentParams('update_conversation_status', {
      conversationId: '123',
      status: 'closed',
    })
    expect(params.status).toBe('closed')
  })

  it('keeps the model type and status when creating a conversation', () => {
    const params = agentParams('create_conversation', {
      mailboxId: '1',
      subject: 'Hi',
      type: 'chat',
      status: 'pending',
    })
    expect(params).toMatchObject({ type: 'chat', status: 'pending' })
  })

  it('keeps the model sort field when listing customers', () => {
    const params = agentParams('list_customers', { sortField: 'lastName' })
    expect(params.sortField).toBe('lastName')
  })
})
