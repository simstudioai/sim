/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { SLACK_WORKFLOW_OPERATIONS } from '@/blocks/blocks/slack-workflow-operations'
import { slackAddBookmarkTool } from '@/tools/slack/add_bookmark'
import { slackCloseConversationTool } from '@/tools/slack/close_conversation'
import { slackCreateUserGroupTool } from '@/tools/slack/create_user_group'
import { slackDeleteFileTool } from '@/tools/slack/delete_file'
import { slackDisableUserGroupTool } from '@/tools/slack/disable_user_group'
import { slackEditBookmarkTool } from '@/tools/slack/edit_bookmark'
import { slackEnableUserGroupTool } from '@/tools/slack/enable_user_group'
import fixtures from '@/tools/slack/fixtures/workflow-api-responses.json'
import { slackGetDndInfoTool } from '@/tools/slack/get_dnd_info'
import { slackGetFileInfoTool } from '@/tools/slack/get_file_info'
import { slackGetReactionsTool } from '@/tools/slack/get_reactions'
import { slackGetTeamDndInfoTool } from '@/tools/slack/get_team_dnd_info'
import { slackGetTeamInfoTool } from '@/tools/slack/get_team_info'
import { slackGetTeamProfileTool } from '@/tools/slack/get_team_profile'
import { slackGetUserProfileTool } from '@/tools/slack/get_user_profile'
import { slackJoinConversationTool } from '@/tools/slack/join_conversation'
import { slackKickConversationTool } from '@/tools/slack/kick_conversation'
import { slackLeaveConversationTool } from '@/tools/slack/leave_conversation'
import { slackListBookmarksTool } from '@/tools/slack/list_bookmarks'
import { slackListEmojiTool } from '@/tools/slack/list_emoji'
import { slackListFilesTool } from '@/tools/slack/list_files'
import { slackListPinsTool } from '@/tools/slack/list_pins'
import { slackListReactionsTool } from '@/tools/slack/list_reactions'
import { slackListUserConversationsTool } from '@/tools/slack/list_user_conversations'
import { slackListUserGroupMembersTool } from '@/tools/slack/list_user_group_members'
import { slackListUserGroupsTool } from '@/tools/slack/list_user_groups'
import { slackLookupUserByEmailTool } from '@/tools/slack/lookup_user_by_email'
import { slackMarkConversationReadTool } from '@/tools/slack/mark_conversation_read'
import { slackOpenConversationTool } from '@/tools/slack/open_conversation'
import { slackPinMessageTool } from '@/tools/slack/pin_message'
import { slackRemoveBookmarkTool } from '@/tools/slack/remove_bookmark'
import { slackRevokeCanvasAccessTool } from '@/tools/slack/revoke_canvas_access'
import { slackSetUserPresenceTool } from '@/tools/slack/set_user_presence'
import { slackShareCanvasTool } from '@/tools/slack/share_canvas'
import { slackUnarchiveConversationTool } from '@/tools/slack/unarchive_conversation'
import { slackUnfurlLinksTool } from '@/tools/slack/unfurl_links'
import { slackUnpinMessageTool } from '@/tools/slack/unpin_message'
import { slackUpdateUserGroupTool } from '@/tools/slack/update_user_group'
import { slackUpdateUserGroupMembersTool } from '@/tools/slack/update_user_group_members'
import { slackListsAccessDeleteTool } from '@/tools/slack_lists/access_delete'
import { slackListsDownloadGetTool } from '@/tools/slack_lists/download_get'
import { slackListsDownloadStartTool } from '@/tools/slack_lists/download_start'
import { slackListsItemsDeleteMultipleTool } from '@/tools/slack_lists/items_delete_multiple'
import type { ToolConfig } from '@/tools/types'

const tools: ToolConfig[] = [
  slackListsAccessDeleteTool,
  slackListsDownloadStartTool,
  slackListsDownloadGetTool,
  slackListsItemsDeleteMultipleTool,
  slackShareCanvasTool,
  slackRevokeCanvasAccessTool,
  slackJoinConversationTool,
  slackLeaveConversationTool,
  slackKickConversationTool,
  slackUnarchiveConversationTool,
  slackCloseConversationTool,
  slackMarkConversationReadTool,
  slackOpenConversationTool,
  slackLookupUserByEmailTool,
  slackListUserConversationsTool,
  slackGetUserProfileTool,
  slackSetUserPresenceTool,
  slackGetFileInfoTool,
  slackListFilesTool,
  slackDeleteFileTool,
  slackGetReactionsTool,
  slackListReactionsTool,
  slackPinMessageTool,
  slackUnpinMessageTool,
  slackListPinsTool,
  slackAddBookmarkTool,
  slackEditBookmarkTool,
  slackListBookmarksTool,
  slackRemoveBookmarkTool,
  slackCreateUserGroupTool,
  slackUpdateUserGroupTool,
  slackEnableUserGroupTool,
  slackDisableUserGroupTool,
  slackListUserGroupsTool,
  slackListUserGroupMembersTool,
  slackUpdateUserGroupMembersTool,
  slackGetDndInfoTool,
  slackGetTeamDndInfoTool,
  slackListEmojiTool,
  slackGetTeamInfoTool,
  slackGetTeamProfileTool,
  slackUnfurlLinksTool,
]
const responses: Record<string, Record<string, unknown>[]> = fixtures
const auth = { accessToken: 'test-token' }

/** Samples from the official reference linked in each tool; no live requests are made. */
describe('Slack workflow API response contracts', () => {
  it.each(tools)(
    '$id accepts every published success example and preserves known outputs',
    async (tool) => {
      expect(responses[tool.id]?.length).toBeGreaterThan(0)
      for (const sample of responses[tool.id]) {
        const result = await tool.transformResponse!(Response.json(sample))
        expect(result.success).toBe(true)
        for (const key of Object.keys(tool.outputs!)) {
          if (key in sample) expect(result.output[key], `${tool.id}.${key}`).toEqual(sample[key])
        }
      }
    }
  )

  it.each(tools)('$id surfaces Slack failures', async (tool) => {
    await expect(
      tool.transformResponse!(
        Response.json({ ok: false, error: 'missing_scope', needed: 'lists:write' })
      )
    ).rejects.toThrow('missing_scope')
  })

  it('rejects rate limits and malformed successes rather than returning partial success', async () => {
    await expect(
      slackListFilesTool.transformResponse!(
        Response.json({ ok: false, error: 'ratelimited' }, { status: 429 })
      )
    ).rejects.toThrow('ratelimited')
    await expect(
      slackLookupUserByEmailTool.transformResponse!(Response.json({ ok: true }))
    ).rejects.toThrow()
  })

  it('projects metadata separately from legacy message channel and stored-file outputs', async () => {
    const channel = { id: 'D1', is_im: true }
    for (const tool of [slackOpenConversationTool, slackJoinConversationTool]) {
      expect((await tool.transformResponse!(Response.json({ ok: true, channel }))).output).toEqual({
        ok: true,
        conversation: channel,
      })
    }
    const files = [{ id: 'F1', title: 'Example file' }]
    expect(
      (await slackListFilesTool.transformResponse!(Response.json({ ok: true, files }))).output
    ).toEqual({ ok: true, fileMetadata: files })
  })

  it('exercises documented DND and emoji fields beyond the minimal success envelopes', async () => {
    const dnd = responses.slack_get_dnd_info.find((sample) => 'dnd_enabled' in sample)!
    expect(dnd).toBeDefined()
    expect((await slackGetDndInfoTool.transformResponse!(Response.json(dnd))).output).toEqual(dnd)
    const emoji = responses.slack_list_emoji.find((sample) => 'emoji' in sample)!
    expect(emoji).toBeDefined()
    expect((await slackListEmojiTool.transformResponse!(Response.json(emoji))).output).toEqual(
      emoji
    )
  })

  it('preserves cursor metadata and nullable user profile fields', async () => {
    const result = await slackGetUserProfileTool.transformResponse!(
      Response.json({ ok: true, profile: { fields: null }, ignored: 'provider envelope' })
    )
    expect(result.output).toEqual({ ok: true, profile: { fields: null } })
    const files = await slackGetFileInfoTool.transformResponse!(
      Response.json({
        ok: true,
        file: { id: 'F1' },
        comments: [{ id: 'Fc1', comment: 'Review', created: 123 }],
        response_metadata: { next_cursor: 'page2' },
      })
    )
    expect(files.output.comments?.[0].comment).toBe('Review')
    expect(files.output.response_metadata?.next_cursor).toBe('page2')
  })
})

describe('Slack workflow API request contracts', () => {
  it('allows requesting member counts without changing another group property', () => {
    for (const include_count of [true, false]) {
      expect(
        slackUpdateUserGroupTool.request.body!({ ...auth, usergroup: 'S1', include_count })
      ).toEqual({ usergroup: 'S1', include_count })
    }
    expect(() => slackUpdateUserGroupTool.request.body!({ ...auth, usergroup: 'S1' })).toThrow()
  })

  it('opens a group DM with CSV users and preserves false without sending credentials in the body', () => {
    expect(
      slackOpenConversationTool.request.body!({ ...auth, users: '[" U1 ","U2"]', return_im: false })
    ).toEqual({ users: 'U1,U2', return_im: false })
    expect(slackOpenConversationTool.request.body!({ ...auth, channel: ' D1 ' })).toEqual({
      channel: 'D1',
    })
  })

  it.each([{}, { users: [] }, { users: ['U1'], channel: 'C1' }, { users: Array(9).fill('U1') }])(
    'rejects invalid DM targets %j',
    (input) => {
      expect(() => slackOpenConversationTool.request.body!({ ...auth, ...input })).toThrow()
    }
  )

  it('encodes pagination without leaking credentials', () => {
    const buildUrl = slackListReactionsTool.request.url
    if (typeof buildUrl !== 'function') throw new Error('Expected query builder')
    const url = new URL(buildUrl({ ...auth, user: 'U1', limit: 100, cursor: 'a+b/=' }))
    expect(url.origin + url.pathname).toBe('https://slack.com/api/reactions.list')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      user: 'U1',
      limit: '100',
      cursor: 'a+b/=',
    })
    expect(() => buildUrl({ ...auth, limit: 1000 })).toThrow()
  })

  it('requires exactly one reaction target and both message identifiers', () => {
    const buildUrl = slackGetReactionsTool.request.url
    if (typeof buildUrl !== 'function') throw new Error('Expected query builder')
    expect(
      new URL(
        buildUrl({ ...auth, channel: 'C1', timestamp: '123.456', full: false })
      ).searchParams.get('full')
    ).toBe('false')
    for (const target of [
      {},
      { channel: 'C1' },
      { timestamp: '123.456' },
      { file: 'F1', channel: 'C1', timestamp: '123.456' },
    ]) {
      expect(() => buildUrl({ ...auth, ...target })).toThrow()
    }
  })

  it('validates canvas ownership and preserves both recipient arrays when removing access', () => {
    expect(
      slackShareCanvasTool.request.body!({
        ...auth,
        canvas_id: ' F1 ',
        access_level: 'owner',
        user_ids: '[" U1 "]',
      })
    ).toEqual({ canvas_id: 'F1', access_level: 'owner', user_ids: ['U1'] })
    expect(() =>
      slackShareCanvasTool.request.body!({
        ...auth,
        canvas_id: 'F1',
        access_level: 'owner',
        channel_ids: ['C1'],
      })
    ).toThrow('Only users')
    expect(() =>
      slackShareCanvasTool.request.body!({
        ...auth,
        canvas_id: 'F1',
        access_level: 'read',
        channel_ids: ['C1'],
        user_ids: ['U1'],
      })
    ).toThrow('exactly one')
    expect(
      slackRevokeCanvasAccessTool.request.body!({
        ...auth,
        canvas_id: 'F1',
        channel_ids: ['C1'],
        user_ids: ['U1'],
      })
    ).toEqual({ canvas_id: 'F1', channel_ids: ['C1'], user_ids: ['U1'] })
  })

  it('validates List recipients and export combinations before sending', () => {
    expect(() =>
      slackListsAccessDeleteTool.request.body!({
        ...auth,
        list_id: 'F1',
        user_ids: ['U1'],
        channel_ids: ['C1'],
      })
    ).toThrow('exactly one')
    expect(() =>
      slackListsItemsDeleteMultipleTool.request.body!({ ...auth, list_id: 'F1', ids: [] })
    ).toThrow()
    expect(() =>
      slackListsDownloadStartTool.request.body!({
        ...auth,
        list_id: 'F1',
        format: 'csv',
        include_threads: true,
      })
    ).toThrow()
    expect(
      slackListsDownloadStartTool.request.body!({
        ...auth,
        list_id: 'F1',
        format: 'json',
        include_archived: false,
        include_threads: true,
      })
    ).toEqual({ list_id: 'F1', format: 'json', include_archived: false, include_threads: true })
  })

  it('supports deliberate user-group clears without accepting empty membership replacements', () => {
    expect(
      slackUpdateUserGroupTool.request.body!({
        ...auth,
        usergroup: 'S1',
        description: '',
        channels: [],
        enable_section: false,
      })
    ).toEqual({ usergroup: 'S1', description: '', channels: '', enable_section: false })
    expect(() =>
      slackUpdateUserGroupMembersTool.request.body!({ ...auth, usergroup: 'S1', users: [] })
    ).toThrow()
    expect(
      slackUpdateUserGroupMembersTool.request.body!({
        ...auth,
        usergroup: 'S1',
        users: [' U1 ', 'U2'],
      })
    ).toEqual({ usergroup: 'S1', users: 'U1,U2' })
  })

  it('requires actual changes for bookmark and user-group edits', () => {
    expect(() =>
      slackEditBookmarkTool.request.body!({ ...auth, channel_id: 'C1', bookmark_id: 'Bk1' })
    ).toThrow('Provide')
    expect(() => slackUpdateUserGroupTool.request.body!({ ...auth, usergroup: 'S1' })).toThrow(
      'Provide'
    )
    expect(
      slackEditBookmarkTool.request.body!({
        ...auth,
        channel_id: 'C1',
        bookmark_id: 'Bk1',
        emoji: '',
      })
    ).toEqual({ channel_id: 'C1', bookmark_id: 'Bk1', emoji: '' })
  })

  it('rejects invalid and empty unfurl JSON', () => {
    expect(() =>
      slackUnfurlLinksTool.request.body!({ ...auth, channel: 'C1', ts: '123.456', unfurls: '{' })
    ).toThrow('Invalid JSON')
    expect(() =>
      slackUnfurlLinksTool.request.body!({ ...auth, channel: 'C1', ts: '123.456', unfurls: {} })
    ).toThrow('at least one')
  })

  it('declares credential kinds and scopes for every exposed operation', () => {
    for (const operation of SLACK_WORKFLOW_OPERATIONS) {
      const tool = tools.find(({ id }) => id === operation.tool)!
      expect(tool, operation.tool).toBeDefined()
      expect(tool.oauth?.credentialKind).toBe(
        operation.auth === 'bot' ? 'service-account' : undefined
      )
      expect(tool.oauth?.requiredScopes).toBeDefined()
    }
  })
})
