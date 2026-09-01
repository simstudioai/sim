/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { slackAddReactionTool } from '@/tools/slack/add_reaction'
import { slackDeleteMessageTool } from '@/tools/slack/delete_message'
import { slackDownloadTool } from '@/tools/slack/download'
import { slackEphemeralMessageTool } from '@/tools/slack/ephemeral_message'
import { slackMessageTool } from '@/tools/slack/message'
import { slackMessageReaderTool } from '@/tools/slack/message_reader'
import { slackRemoveReactionTool } from '@/tools/slack/remove_reaction'
import { slackUpdateMessageTool } from '@/tools/slack/update_message'

const SLACK_INTERNAL_TOOLS = [
  slackAddReactionTool,
  slackDeleteMessageTool,
  slackDownloadTool,
  slackEphemeralMessageTool,
  slackMessageTool,
  slackMessageReaderTool,
  slackRemoveReactionTool,
  slackUpdateMessageTool,
]

describe('Slack internal tool declarations', () => {
  it('exposes only typed operation input without HTTP transport metadata', () => {
    for (const tool of SLACK_INTERNAL_TOOLS) {
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool).not.toHaveProperty('request')
    }
  })

  it('preserves OAuth selection, DM routing, blocks, and protected file references', () => {
    const file = { key: 'workspace/file-1', name: 'report.pdf', size: 3 }
    expect(
      slackMessageTool.operation.input({
        destinationType: 'dm',
        botToken: 'xoxb-token',
        dmUserId: ' U1 ',
        text: 'hello',
        threadTs: ' 1.0 ',
        blocks: '[{"type":"section"}]',
        files: [file],
      })
    ).toEqual({
      accessToken: 'xoxb-token',
      channel: undefined,
      userId: 'U1',
      text: 'hello',
      thread_ts: '1.0',
      blocks: [{ type: 'section' }],
      files: [file],
    })
  })
})
