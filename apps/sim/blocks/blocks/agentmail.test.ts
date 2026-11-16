import { describe, expect, it } from 'vitest'
import { AgentMailBlock } from '@/blocks/blocks/agentmail'

/** Runs the mapper the way an Agent tool call does: its result is spread over the merged args. */
function toolCall(args: Record<string, unknown>, operation: string) {
  const mapParams = AgentMailBlock.tools.config?.params
  if (!mapParams) throw new Error('AgentMail block has no params mapper')
  return { ...args, ...mapParams(args, { operation }) }
}

describe('AgentMailBlock agent tool calls', () => {
  it('maps the block-field reply message key and keeps the model recipients and flags', () => {
    expect(
      toolCall(
        { inboxId: 'inbox', replyMessageId: 'msg-1', to: 'a@example.com', replyAll: true },
        'reply_message'
      )
    ).toMatchObject({ messageId: 'msg-1', to: 'a@example.com', replyAll: true })
  })

  it('keeps a boolean permanent flag from the model', () => {
    expect(
      toolCall({ inboxId: 'inbox', threadId: 't-1', permanent: true }, 'delete_thread')
    ).toMatchObject({ permanent: true })
  })

  it('treats a stored "false" permanent dropdown as a trash move, not a permanent delete', () => {
    expect(
      toolCall({ inboxId: 'inbox', threadId: 't-1', permanent: 'false' }, 'delete_thread')
    ).toMatchObject({ permanent: false })
  })

  it('treats a stored "false" reply-all dropdown as a reply to the sender only', () => {
    expect(
      toolCall({ inboxId: 'inbox', replyMessageId: 'msg-1', replyAll: 'false' }, 'reply_message')
    ).toMatchObject({ replyAll: false })
  })
})
