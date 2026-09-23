/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import { getScopesForService } from '@/lib/oauth/utils'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { SlackV2Block } from '@/blocks/blocks/slack'
import { SlackCanvasBlock } from '@/blocks/blocks/slack_canvas'
import { SlackListsBlock } from '@/blocks/blocks/slack_lists'
import { buildSlackManifest } from '@/triggers/slack/capabilities'

describe('Slack resource catalog blocks', () => {
  it.each([
    { block: SlackListsBlock, credentialKind: 'service-account' },
    { block: SlackCanvasBlock, credentialKind: 'any' },
  ])(
    'exposes $block.name with $credentialKind credentials and unique fields',
    ({ block, credentialKind }) => {
      expect(block.hideFromToolbar).not.toBe(true)
      expect(block.subBlocks.find((field) => field.id === 'credential')).toMatchObject({
        type: 'oauth-input',
        serviceId: 'slack',
        credentialKind,
        required: true,
      })
      expect(new Set(block.subBlocks.map((field) => field.id)).size).toBe(block.subBlocks.length)
      for (const field of block.subBlocks) {
        if (field.canonicalParamId)
          expect(block.subBlocks.some((candidate) => candidate.id === field.canonicalParamId)).toBe(
            false
          )
      }
      const operation = block.subBlocks.find((field) => field.id === 'operation')!
      const options =
        typeof operation.options === 'function' ? operation.options() : operation.options!
      for (const option of options) {
        expect(block.tools.access).toContain(block.tools.config!.tool!({ operation: option.id }))
        expect(block.canvasPresentation?.sentences?.byOperation?.[option.id]).toBeDefined()
      }
    }
  )
  it('reuses the existing Canvas tools without removing Slack operations', () => {
    expect(SlackV2Block.tools.access).toEqual(expect.arrayContaining(SlackCanvasBlock.tools.access))
    expect(SlackCanvasBlock.tools.config).toBe(SlackV2Block.tools.config)
    expect(
      SlackCanvasBlock.tools.config!.params!({
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
  it('exposes only relevant List fields and keeps variable resolution after tool selection', () => {
    const params = {
      operation: 'slack_lists_items_list',
      listId: '<previous.listId>',
      limit: '<previous.limit>',
    }
    expect(SlackListsBlock.tools.config!.tool!(params)).toBe('slack_lists_items_list')
    expect(params.limit).toBe('<previous.limit>')
    expect(SlackListsBlock.tools.config!.params!({ ...params, limit: '25' })).toMatchObject({
      limit: 25,
    })
    const fields = SlackListsBlock.subBlocks
      .filter((field) =>
        evaluateSubBlockCondition(field.condition, { operation: 'slack_lists_items_update' })
      )
      .map((field) => field.id)
    expect(fields).toEqual(['operation', 'credential', 'listId', 'cells'])
  })
  it('rejects invalid canvas pagination instead of silently dropping it', () => {
    expect(() =>
      SlackCanvasBlock.tools.config!.params!({
        operation: 'list_canvases',
        canvasListCount: '12garbage',
      })
    ).toThrow()
    expect(() =>
      SlackCanvasBlock.tools.config!.params!({ operation: 'list_canvases', canvasListPage: '-1' })
    ).toThrow()
    expect(
      SlackCanvasBlock.tools.config!.params!({
        operation: 'list_canvases',
        canvasListCount: '20',
        canvasListPage: '2',
      })
    ).toMatchObject({ count: 20, page: 2 })
  })
  it('handles resolved JSON arrays and rejects malformed JSON', () => {
    const cells = [{ row_id: 'Rec1', column_id: 'Col1', checkbox: false }]
    expect(SlackListsBlock.tools.config!.params!({ cells: JSON.stringify(cells) })).toMatchObject({
      cells,
    })
    expect(SlackListsBlock.tools.config!.params!({ cells })).toMatchObject({ cells })
    expect(() => SlackListsBlock.tools.config!.params!({ cells: 'bad json' })).toThrow()
  })
  it('allows whole-canvas replacement while requiring section IDs for destructive section edits', () => {
    const section = SlackCanvasBlock.subBlocks.find((field) => field.id === 'sectionId')!
    expect(section.required).toEqual({
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
