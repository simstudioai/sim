import { describe, expect, it } from 'vitest'
import { GmailV2Block } from '@/blocks/blocks/gmail'

/**
 * On an agent call the model supplies `threadId`/`format`/`name`/`query`/`labelIds` under the
 * tool's own names; the dedicated V2 fields (`targetThreadId`, `threadFormat`, `labelName`,
 * `listQuery`, `threadLabelIds`) are never rendered in the agent tool input.
 */
describe('GmailV2Block agent tool calls', () => {
  const buildParams = GmailV2Block.tools.config.params!
  const agentCall = (operation: string, args: Record<string, unknown>) => {
    const inputs = { ...args, operation }
    return { ...inputs, ...buildParams(inputs, { operation }) }
  }

  it('keeps the model threadId and format on get_thread_gmail', () => {
    const mapped = agentCall('get_thread_gmail', { threadId: 't-1', format: 'minimal' })
    expect(mapped.threadId).toBe('t-1')
    expect(mapped.format).toBe('minimal')
  })

  it.each(['create_label_gmail', 'update_label_gmail'])(
    'keeps the model name on %s',
    (operation) => {
      expect(agentCall(operation, { labelId: 'l-1', name: 'Receipts' }).name).toBe('Receipts')
    }
  )

  it.each(['list_drafts_gmail', 'list_threads_gmail'])(
    'keeps the model query and labelIds on %s',
    (operation) => {
      const mapped = agentCall(operation, { query: 'is:unread', labelIds: 'INBOX' })
      expect(mapped.query).toBe('is:unread')
      expect(mapped.labelIds).toBe('INBOX')
    }
  )

  it('drops a Send threadId left over on the canvas under get_thread_gmail', () => {
    const inputs = { operation: 'get_thread_gmail', threadId: 'stale' }
    expect({ ...inputs, ...buildParams(inputs) }.threadId).toBeUndefined()
  })
})
