import { describe, expect, it } from 'vitest'
import type { TrelloUpdateCardParams } from '@/tools/trello/types'
import { trelloUpdateCardTool } from '@/tools/trello/update_card'

function buildBody(params: Partial<TrelloUpdateCardParams>) {
  const body = trelloUpdateCardTool.request.body
  if (!body) throw new Error('trello_update_card has no request body builder')
  return body({ accessToken: 'token', cardId: 'card-1', ...params })
}

describe('trello_update_card body', () => {
  it.each([
    [['label-1', 'label-2'], ['member-1'], 'label-1,label-2', 'member-1'],
    [' label-1,label-2 ', 'member-1, member-2', 'label-1,label-2', 'member-1, member-2'],
  ])(
    'sends label IDs %j and member IDs %j comma-separated',
    (labelIds, memberIds, idLabels, idMembers) => {
      expect(buildBody({ labelIds, memberIds })).toEqual({ idLabels, idMembers })
    }
  )

  it.each([[[]], [''], ['   ']])('leaves labels and members unchanged for %j', (ids) => {
    expect(buildBody({ name: 'Renamed', labelIds: ids, memberIds: ids })).toEqual({
      name: 'Renamed',
    })
  })
})
