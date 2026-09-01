/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { addMothershipChatResourceBodySchema } from '@/lib/api/contracts/mothership-chats'

const TABLE_RESOURCE = {
  type: 'table' as const,
  id: 'table-1',
  title: 'Accounts',
}

describe('addMothershipChatResourceBodySchema', () => {
  it('rejects an empty chat id', () => {
    expect(
      addMothershipChatResourceBodySchema.safeParse({
        chatId: '',
        resource: TABLE_RESOURCE,
      }).success
    ).toBe(false)
  })

  it('preserves an explicit saved-view pin clear through outbound parsing', () => {
    expect(
      addMothershipChatResourceBodySchema.parse({
        chatId: 'chat-1',
        resource: TABLE_RESOURCE,
        clearViewId: true,
      })
    ).toEqual({ chatId: 'chat-1', resource: TABLE_RESOURCE, clearViewId: true })
  })

  it('rejects a clear directive for a non-table resource', () => {
    expect(
      addMothershipChatResourceBodySchema.safeParse({
        chatId: 'chat-1',
        resource: { type: 'file', id: 'file-1', title: 'Accounts.csv' },
        clearViewId: true,
      }).success
    ).toBe(false)
  })

  it('rejects a clear directive paired with a replacement pin', () => {
    expect(
      addMothershipChatResourceBodySchema.safeParse({
        chatId: 'chat-1',
        resource: { ...TABLE_RESOURCE, viewId: 'view-1' },
        clearViewId: true,
      }).success
    ).toBe(false)
  })
})
