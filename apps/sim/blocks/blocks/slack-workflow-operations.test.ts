/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import { getScopesForService } from '@/lib/oauth/utils'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { SlackV2Block } from '@/blocks/blocks/slack'
import { SLACK_WORKFLOW_OPERATIONS } from '@/blocks/blocks/slack-workflow-operations'
import metadata from '@/tools/generated/tool-metadata'
import type { ToolMetadata } from '@/tools/metadata'
import { buildSlackManifest, SLACK_CAPABILITIES } from '@/triggers/slack/capabilities'

const tools = metadata as Record<string, ToolMetadata>
const mapParams = SlackV2Block.tools.config!.params!

function visibleFields(operation: string) {
  return SlackV2Block.subBlocks.filter(
    (field) =>
      !field.mode?.startsWith('trigger') &&
      evaluateSubBlockCondition(field.condition, { operation })
  )
}

describe('Slack workflow operations in the existing block', () => {
  it.each(SLACK_WORKFLOW_OPERATIONS)(
    '$id has reachable inputs and the correct credential restriction',
    (operation) => {
      expect(SlackV2Block.tools.config!.tool!({ operation: operation.id })).toBe(operation.tool)
      expect(SlackV2Block.tools.access).toContain(operation.tool)
      const fields = visibleFields(operation.id)
      const fieldIds = fields.map(({ id }) => id)
      for (const field of operation.fields) expect(fieldIds).toContain(field.id)
      for (const [param, config] of Object.entries(tools[operation.tool].params)) {
        if (config.required && config.visibility !== 'hidden') {
          expect(
            operation.fields.find((field) => field.param === param)?.required,
            `${operation.id}.${param}`
          ).toBe(true)
        }
      }
      const credentialId = operation.auth === 'bot' ? 'apiBotCredential' : 'apiOAuthCredential'
      expect(fieldIds).toContain(credentialId)
      expect(fieldIds).not.toContain('credential')
      expect(fieldIds).not.toContain('listBotCredential')
      if (operation.auth === 'bot')
        expect(fields.find(({ id }) => id === credentialId)?.credentialKind).toBe('service-account')
      expect(SlackV2Block.canvasPresentation?.sentences?.byOperation?.[operation.id]).toBeDefined()
    }
  )

  it('keeps message output types while exposing conversation and file metadata separately', () => {
    expect(SlackV2Block.outputs.channel.type).toBe('string')
    expect(SlackV2Block.outputs.files.type).toBe('file[]')
    for (const key of ['conversation', 'fileMetadata'])
      expect(SlackV2Block.outputs[key].type).toBe('json')
  })

  it('does not offer Canvas ownership for channels and clears stale access choices', () => {
    const field = SlackV2Block.subBlocks.find(({ id }) => id === 'slack_share_canvas_access_level')!
    const options = field.options
    if (typeof options !== 'function') throw new Error('Expected dynamic access options')
    for (const channels of ['["C1"]', ['C1'], '<Block.channels>']) {
      expect(
        options({ values: { slack_share_canvas_channel_ids: channels } }).map(({ id }) => id)
      ).toEqual(['read', 'write'])
    }
    for (const channels of ['', '[]', [], undefined]) {
      expect(
        options({ values: { slack_share_canvas_channel_ids: channels } }).map(({ id }) => id)
      ).toContain('owner')
    }
    expect(field.dependsOn).toEqual(['slack_share_canvas_channel_ids'])
  })

  it('keeps target alternatives available in basic mode', () => {
    for (const [operation, params] of [
      ['open_conversation', ['users', 'channel']],
      ['share_canvas', ['user_ids', 'channel_ids']],
      ['revoke_list_access', ['user_ids', 'channel_ids']],
      ['get_reactions', ['channel', 'timestamp', 'file', 'file_comment']],
    ] as const) {
      for (const param of params)
        expect(
          visibleFields(operation).find(({ id }) => id === `slack_${operation}_${param}`)?.mode
        ).not.toBe('advanced')
    }
  })

  it('maps JSON and numbers, preserves false and clears, and drops stale hidden fields', () => {
    expect(
      mapParams({
        operation: 'open_conversation',
        apiOAuthCredentialId: 'account',
        apiBotCredentialId: 'stale',
        slack_open_conversation_users: '["U1","U2"]',
        slack_open_conversation_return_im: false,
        slack_share_canvas_user_ids: 'invalid stale JSON',
      })
    ).toEqual({ credential: 'account', users: ['U1', 'U2'], return_im: false })
    expect(
      mapParams({
        operation: 'list_files',
        apiOAuthCredentialId: 'account',
        apiBotCredentialId: 'stale',
        slack_list_files_channel: 'C1',
        slack_list_files_count: '25',
      })
    ).toEqual({ credential: 'account', channel: 'C1', count: 25 })
    expect(
      mapParams({
        operation: 'edit_bookmark',
        apiBotCredentialId: 'bot',
        slack_edit_bookmark_channel_id: 'C1',
        slack_edit_bookmark_bookmark_id: 'Bk1',
        slack_edit_bookmark_emoji: '',
      })
    ).toEqual({ credential: 'bot', channel_id: 'C1', bookmark_id: 'Bk1', emoji: '' })
    expect(() => mapParams({ operation: 'list_files', slack_list_files_count: 'many' })).toThrow()
    expect(() =>
      mapParams({ operation: 'share_canvas', slack_share_canvas_user_ids: 'invalid JSON' })
    ).toThrow()
  })

  it('leaves List task tracking unchanged unless explicitly selected', () => {
    expect(
      mapParams({
        operation: 'rename_list',
        listCredentialId: 'bot',
        listId: 'F1',
        listName: 'Renamed',
        listTodoMode: false,
      })
    ).toEqual({
      credential: 'bot',
      listId: 'F1',
      name: 'Renamed',
      description: undefined,
      todoMode: undefined,
    })
    expect(
      mapParams({
        operation: 'rename_list',
        listCredentialId: 'bot',
        listId: 'F1',
        listDescription: 'Updated',
        listUpdateTodoMode: 'false',
      })
    ).toEqual({
      credential: 'bot',
      listId: 'F1',
      name: undefined,
      description: 'Updated',
      todoMode: false,
    })
  })
})

describe('Slack custom-app permissions', () => {
  it('requests every new bot capability by default without incompatible Assistant events', () => {
    expect(SLACK_CAPABILITIES.every(({ defaultChecked }) => defaultChecked)).toBe(true)
    const manifest = buildSlackManifest(
      new Set(
        SLACK_CAPABILITIES.filter(({ defaultChecked }) => defaultChecked).map(({ id }) => id)
      ),
      { appName: 'Test', webhookUrl: 'https://example.com/slack' }
    )
    const oauth = manifest.oauth_config as { scopes: { bot: string[]; user?: string[] } }
    for (const operation of SLACK_WORKFLOW_OPERATIONS.filter(({ auth }) => auth === 'bot')) {
      expect(oauth.scopes.bot).toEqual(
        expect.arrayContaining(tools[operation.tool].oauth!.requiredScopes!)
      )
    }
    expect(oauth.scopes.bot).not.toContain('search:read')
    expect(oauth.scopes.bot).not.toContain('users.profile:write')
    expect(oauth.scopes.bot).not.toContain('dnd:write')
    const settings = manifest.settings as { event_subscriptions: { bot_events: string[] } }
    expect(settings.event_subscriptions.bot_events).not.toContain('assistant_thread_started')
    expect(settings.event_subscriptions.bot_events).not.toContain(
      'assistant_thread_context_changed'
    )
  })

  it('grants conversation reads when only conversation management is enabled', () => {
    const manifest = buildSlackManifest(new Set(['action_manage_conversations']), {
      appName: 'Test',
      webhookUrl: 'https://example.com/slack',
    })
    const oauth = manifest.oauth_config as { scopes: { bot: string[] } }
    expect(oauth.scopes.bot).toEqual(
      expect.arrayContaining(['channels:read', 'groups:read', 'im:read', 'mpim:read'])
    )
  })

  it('excludes user-only actions and their newly added scopes from the integration', () => {
    const operationField = SlackV2Block.subBlocks.find(({ id }) => id === 'operation')!
    const options = operationField.options
    if (!Array.isArray(options)) throw new Error('Expected static operation options')
    for (const operation of [
      'update_user_profile',
      'search_messages',
      'search_files',
      'search_all',
      'set_dnd_snooze',
      'end_dnd_snooze',
      'end_dnd',
    ]) {
      expect(options.map(({ id }) => id)).not.toContain(operation)
      expect(SlackV2Block.tools.access).not.toContain(`slack_${operation}`)
      expect(tools).not.toHaveProperty(`slack_${operation}`)
    }
    expect(SlackV2Block.subBlocks.map(({ id }) => id)).not.toContain('apiManagedUserCredentialId')
    expect(SLACK_MANAGED_USER_SCOPES).not.toContain('dnd:write')
    expect(SLACK_MANAGED_USER_SCOPES).not.toContain('search:read')
  })

  it('leaves native Sim scopes unchanged', () => {
    const native = getScopesForService('slack')
    for (const scope of [
      'lists:read',
      'lists:write',
      'search:read',
      'bookmarks:write',
      'pins:write',
      'usergroups:write',
      'dnd:write',
    ])
      expect(native).not.toContain(scope)
  })
})
