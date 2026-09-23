/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import { getScopesForService } from '@/lib/oauth/utils'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { getSlackV2ActionSubBlocks, SlackBlock, SlackV2Block } from '@/blocks/blocks/slack'
import { buildSlackManifest } from '@/triggers/slack/capabilities'

const LIST_OPERATIONS = [
  ['create_list', 'slack_lists_create'],
  ['rename_list', 'slack_lists_update'],
  ['list_items', 'slack_lists_items_list'],
  ['get_list_item', 'slack_lists_items_info'],
  ['create_list_item', 'slack_lists_items_create'],
  ['update_list_items', 'slack_lists_items_update'],
  ['delete_list_item', 'slack_lists_items_delete'],
] as const

function visibleFields(operation: string) {
  return getSlackV2ActionSubBlocks()
    .filter((field) => evaluateSubBlockCondition(field.condition, { operation }))
    .map((field) => field.id)
}

function mapParams(params: Record<string, unknown>) {
  return SlackV2Block.tools.config!.params!(params)
}

describe('Slack List and Canvas operations', () => {
  it.each(LIST_OPERATIONS)('offers %s inside the Slack block using %s', (operationId, toolId) => {
    const operation = SlackV2Block.subBlocks.find((field) => field.id === 'operation')!
    const options =
      typeof operation.options === 'function' ? operation.options() : operation.options!
    expect(options.some((option) => option.id === operationId)).toBe(true)
    expect(SlackV2Block.tools.config!.tool!({ operation: operationId })).toBe(toolId)
    expect(SlackV2Block.tools.access).toContain(toolId)
    expect(SlackV2Block.canvasPresentation?.sentences?.byOperation?.[operationId]).toBeDefined()
    expect(visibleFields(operationId)).toContain('listBotCredential')
    expect(visibleFields(operationId)).toContain('manualListBotCredential')
    for (const hidden of [
      'credential',
      'manualCredential',
      'agentBotCredential',
      'channel',
      'manualChannel',
    ]) {
      expect(visibleFields(operationId)).not.toContain(hidden)
    }
  })

  it('uses a canonical custom-bot credential pair for Lists without changing Canvas credentials', () => {
    expect(SlackV2Block.subBlocks.find((field) => field.id === 'listBotCredential')).toMatchObject({
      type: 'oauth-input',
      serviceId: 'slack',
      canonicalParamId: 'listCredentialId',
      credentialKind: 'service-account',
      mode: 'basic',
      required: true,
    })
    expect(
      SlackV2Block.subBlocks.find((field) => field.id === 'manualListBotCredential')
    ).toMatchObject({
      canonicalParamId: 'listCredentialId',
      mode: 'advanced',
      required: true,
    })
    expect(SlackV2Block.subBlocks.find((field) => field.id === 'credential')?.credentialKind).toBe(
      'any'
    )
    for (const operation of ['send', 'canvas', 'edit_canvas', 'list_canvases']) {
      expect(visibleFields(operation)).toContain('credential')
      expect(
        visibleFields(operation).some((id) => id.startsWith('list') && id !== 'listChannels')
      ).toBe(false)
    }
    expect(new Set(SlackV2Block.subBlocks.map((field) => field.id)).size).toBe(
      SlackV2Block.subBlocks.length
    )
  })

  it('keeps the existing Canvas operations and IDs in Slack', () => {
    for (const operation of [
      'canvas',
      'get_canvas',
      'list_canvases',
      'create_channel_canvas',
      'edit_canvas',
      'lookup_canvas_sections',
      'delete_canvas',
    ]) {
      expect(SlackV2Block.tools.config!.tool!({ operation })).toBe(
        SlackBlock.tools.config!.tool!({ operation })
      )
    }
    expect(
      mapParams({
        operation: 'edit_canvas',
        oauthCredential: 'cred1',
        editCanvasId: 'F1',
        canvasOperation: 'insert_at_end',
        canvasContent: '<resolved text>',
      })
    ).toMatchObject({
      credential: 'cred1',
      canvasId: 'F1',
      operation: 'insert_at_end',
      content: '<resolved text>',
    })
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

  it('maps List create, rename, row lookup, row create, and row delete fields', () => {
    expect(
      mapParams({
        operation: 'create_list',
        listCredentialId: 'bot',
        listName: 'Tasks',
        listSchema: '[{"key":"title","name":"Title","type":"text"}]',
        listTodoMode: 'false',
        listDescription: '',
      })
    ).toMatchObject({
      credential: 'bot',
      name: 'Tasks',
      schema: [{ key: 'title', name: 'Title', type: 'text' }],
      todoMode: false,
      description: undefined,
    })
    expect(visibleFields('create_list')).not.toContain('listId')
    expect(
      mapParams({
        operation: 'rename_list',
        listId: 'F1',
        listName: 'Renamed',
        listLimit: 'stale invalid value',
      })
    ).toMatchObject({ listId: 'F1', name: 'Renamed' })
    for (const operation of ['get_list_item', 'delete_list_item']) {
      expect(mapParams({ operation, listId: 'F1', listItemId: 'Rec1' })).toMatchObject({
        listId: 'F1',
        itemId: 'Rec1',
      })
    }
    expect(
      mapParams({
        operation: 'create_list_item',
        listInitialFields: '[]',
        listParentItemId: 'Rec1',
        listDuplicatedItemId: '',
      })
    ).toMatchObject({ initialFields: [], parentItemId: 'Rec1', duplicatedItemId: undefined })
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

  it('keeps Lists scopes out of native connections and includes them in opt-in custom bot setup', () => {
    for (const scope of ['lists:read', 'lists:write']) {
      expect(getScopesForService('slack')).not.toContain(scope)
      expect(SLACK_MANAGED_USER_SCOPES).not.toContain(scope)
    }
    const manifest = buildSlackManifest(new Set(['action_lists', 'action_canvases']), {
      appName: 'Test',
      webhookUrl: 'https://example.com/api/webhooks/slack',
    })
    expect(manifest).toMatchObject({
      oauth_config: {
        scopes: {
          bot: expect.arrayContaining([
            'lists:read',
            'lists:write',
            'canvases:read',
            'canvases:write',
            'files:read',
          ]),
        },
      },
    })
  })
})
