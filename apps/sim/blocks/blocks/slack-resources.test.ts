import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { getSlackV2ActionSubBlocks, SlackV2Block } from '@/blocks/blocks/slack'

function visibleFields(operation: string, values: Record<string, unknown> = {}) {
  return getSlackV2ActionSubBlocks()
    .filter((field) => evaluateSubBlockCondition(field.condition, { operation, ...values }))
    .map((field) => field.id)
}

function mapParams(params: Record<string, unknown>) {
  return SlackV2Block.tools.config!.params!(params)
}

describe('Slack List and Canvas operations', () => {
  it('shares with only the selected recipient kind and defaults to view access', () => {
    expect(
      mapParams({
        operation: 'share_list',
        listCredentialId: 'bot',
        listId: 'F1',
        listShareUserIds: '["U1"]',
        listShareChannelIds: 'stale invalid JSON',
      })
    ).toEqual({ credential: 'bot', listId: 'F1', accessLevel: 'read', userIds: ['U1'] })
    expect(
      mapParams({
        operation: 'share_list',
        listCredentialId: 'bot',
        listId: 'F1',
        listShareTarget: 'channels',
        listAccessLevel: 'write',
        listShareChannelIds: ['C1'],
        listShareUserIds: 'stale invalid JSON',
      })
    ).toEqual({ credential: 'bot', listId: 'F1', accessLevel: 'write', channelIds: ['C1'] })
    for (const [target, shown, hidden] of [
      ['users', 'listShareUserIds', 'listShareChannelIds'],
      ['channels', 'listShareChannelIds', 'listShareUserIds'],
    ]) {
      const fields = visibleFields('share_list', { listShareTarget: target })
      expect(fields).toEqual(expect.arrayContaining(['listId', 'listAccessLevel', shown]))
      expect(fields).not.toContain(hidden)
    }
    expect(() => mapParams({ operation: 'share_list', listShareUserIds: 'bad JSON' })).toThrow(
      'User IDs'
    )
    expect(() => mapParams({ operation: 'share_list', listShareTarget: 'everyone' })).toThrow(
      'Share With'
    )
  })

  it('maps only the selected Lists credential and preserves post-selection variable resolution', () => {
    const params = {
      operation: 'list_items',
      listId: '<previous.listId>',
      listLimit: '<previous.limit>',
    }
    expect(SlackV2Block.tools.config!.tool!(params)).toBe('slack_lists_items_list')
    expect(params.listLimit).toBe('<previous.limit>')
    expect(
      mapParams({
        ...params,
        listLimit: '25',
        listCredentialId: 'custom-bot',
        oauthCredential: 'native-account',
        channel: 'C1',
      })
    ).toEqual({
      credential: 'custom-bot',
      listId: '<previous.listId>',
      limit: 25,
      cursor: undefined,
      archived: undefined,
      includeList: undefined,
    })
    expect(
      mapParams({ operation: 'list_items', oauthCredential: 'native-account' }).credential
    ).toBeUndefined()
    expect(visibleFields('update_list_items')).toEqual([
      'listBotCredential',
      'manualListBotCredential',
      'listId',
      'listCells',
    ])
  })

  it('parses resolved cell arrays and fails for malformed JSON and pagination', () => {
    const cells = [{ row_id: 'Rec1', column_id: 'Col1', checkbox: false }]
    expect(
      mapParams({ operation: 'update_list_items', listCells: JSON.stringify(cells) })
    ).toMatchObject({ cells })
    expect(mapParams({ operation: 'update_list_items', listCells: cells })).toMatchObject({ cells })
    expect(() => mapParams({ operation: 'update_list_items', listCells: 'bad json' })).toThrow(
      'Cells'
    )
    expect(() => mapParams({ operation: 'list_items', listLimit: '1garbage' })).toThrow()
    expect(() => mapParams({ operation: 'list_items', listArchived: 'maybe' })).toThrow('boolean')
  })

  it('rejects invalid canvas pagination instead of silently dropping it', () => {
    expect(() => mapParams({ operation: 'list_canvases', canvasListCount: '12garbage' })).toThrow()
    expect(() => mapParams({ operation: 'list_canvases', canvasListPage: '-1' })).toThrow()
    expect(
      mapParams({ operation: 'list_canvases', canvasListCount: '20', canvasListPage: '2' })
    ).toMatchObject({ count: 20, page: 2 })
  })

  it('allows whole-canvas replacement while requiring section IDs for targeted edits', () => {
    expect(SlackV2Block.subBlocks.find((field) => field.id === 'sectionId')?.required).toEqual({
      field: 'canvasOperation',
      value: ['insert_after', 'insert_before', 'delete'],
    })
  })
})
