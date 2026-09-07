/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  addMothershipChatResourceBodySchema,
  createMothershipChatBodySchema,
} from '@/lib/api/contracts/mothership-chats'

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

  it('rejects a saved-view pin for a non-table resource', () => {
    expect(
      addMothershipChatResourceBodySchema.safeParse({
        chatId: 'chat-1',
        resource: { type: 'file', id: 'file-1', title: 'Accounts.csv', viewId: 'view-1' },
      }).success
    ).toBe(false)
  })
})

describe('chat owner contract', () => {
  it.each([{ workspaceId: 'ws-1' }, { organizationId: 'org-1' }])(
    'accepts exactly one owner: %j',
    (input) => {
      expect(createMothershipChatBodySchema.parse(input)).toEqual(input)
    }
  )
  it.each([{}, { workspaceId: 'ws-1', organizationId: 'org-1' }, { organizationId: '' }])(
    'rejects missing or ambiguous owners: %j',
    (input) => {
      expect(createMothershipChatBodySchema.safeParse(input).success).toBe(false)
    }
  )
})
