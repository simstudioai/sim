/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  addCopilotChatResourceBodySchema,
  removeCopilotChatResourceBodySchema,
  reorderCopilotChatResourcesBodySchema,
} from '@/lib/api/contracts/copilot'

/**
 * Regression: a #wsres-file outputs/ link that failed to resolve minted a
 * resource with an empty id; once persisted and attached to a send, the chat
 * POST 400'd before creating a run and the client wedged reconnecting to a
 * never-registered stream. Add/reorder must reject empty ids at the boundary
 * so a poison resource can never be persisted again. Remove intentionally
 * stays permissive so legacy empty-id rows can still be deleted.
 */

const CHAT_ID = 'chat-1'

describe('copilot chat resource contracts reject empty resource ids', () => {
  it('add rejects an empty resource id', () => {
    const result = addCopilotChatResourceBodySchema.safeParse({
      chatId: CHAT_ID,
      resource: { type: 'file', id: '', title: 'outputs/report.png' },
    })
    expect(result.success).toBe(false)
  })

  it('add accepts a non-empty resource id', () => {
    const result = addCopilotChatResourceBodySchema.safeParse({
      chatId: CHAT_ID,
      resource: { type: 'file', id: 'file-1', title: 'outputs/report.png' },
    })
    expect(result.success).toBe(true)
  })

  it('reorder rejects a list containing an empty resource id', () => {
    const result = reorderCopilotChatResourcesBodySchema.safeParse({
      chatId: CHAT_ID,
      resources: [
        { type: 'workflow', id: 'wf-1', title: 'Workflow' },
        { type: 'file', id: '', title: 'outputs/report.png' },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('reorder accepts a list of non-empty resource ids', () => {
    const result = reorderCopilotChatResourcesBodySchema.safeParse({
      chatId: CHAT_ID,
      resources: [
        { type: 'workflow', id: 'wf-1', title: 'Workflow' },
        { type: 'file', id: 'file-1', title: 'outputs/report.png' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('remove stays permissive so legacy empty-id rows can be deleted', () => {
    const result = removeCopilotChatResourceBodySchema.safeParse({
      chatId: CHAT_ID,
      resourceType: 'file',
      resourceId: '',
    })
    expect(result.success).toBe(true)
  })
})
