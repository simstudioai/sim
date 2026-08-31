/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { slackAppendStreamV2Tool } from '@/tools/slack/append_stream_v2'
import { slackRenameAgentSessionV2Tool } from '@/tools/slack/rename_agent_session_v2'
import { slackSetAgentSessionStatusV2Tool } from '@/tools/slack/set_agent_session_status_v2'
import { slackSetSuggestedPromptsV2Tool } from '@/tools/slack/set_suggested_prompts_v2'
import { slackStartStreamV2Tool } from '@/tools/slack/start_stream_v2'
import { slackStopStreamV2Tool } from '@/tools/slack/stop_stream_v2'
import type { ToolConfig } from '@/tools/types'

const AGENT_TOOLS = [
  slackSetAgentSessionStatusV2Tool,
  slackRenameAgentSessionV2Tool,
  slackStartStreamV2Tool,
  slackAppendStreamV2Tool,
  slackStopStreamV2Tool,
]

function requestOf(tool: ToolConfig) {
  if (!tool.request) throw new Error(`${tool.id} must use Slack's external HTTP API`)
  return tool.request
}

describe('Slack Agent Sessions tools', () => {
  it('requires custom bot credentials and chat:write for every operation', () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.oauth).toMatchObject({
        provider: 'slack',
        credentialKind: 'service-account',
      })
      expect(tool.oauth?.requiredScopes).toContain('chat:write')
      expect(requestOf(tool).url({})).toMatch(/^https:\/\/slack\.com\/api\//)
    }
    for (const tool of [slackSetAgentSessionStatusV2Tool, slackStartStreamV2Tool]) {
      expect(tool.oauth?.requiredScopes).toContain('chat:write.customize')
    }
  })

  it('maps the documented session status request and response', async () => {
    const request = requestOf(slackSetAgentSessionStatusV2Tool)
    expect(
      request.body?.({
        accessToken: 'xoxb-token',
        authMethod: 'bot_token',
        botToken: '',
        channel: ' C1 ',
        threadTs: ' 1.2 ',
        status: 'processing',
        title: ' Research ',
        initiatorUserId: ' U1 ',
      })
    ).toEqual({
      channel_id: 'C1',
      thread_ts: '1.2',
      status: 'processing',
      title: 'Research',
      initiator_user_id: 'U1',
    })

    await expect(
      slackSetAgentSessionStatusV2Tool.transformResponse?.(
        new Response(
          JSON.stringify({
            ok: true,
            status: 'processing',
            agent_status: 'processing',
            title: 'Research',
          })
        )
      )
    ).resolves.toEqual({
      success: true,
      output: {
        ok: true,
        status: 'processing',
        agentStatus: 'processing',
        title: 'Research',
      },
    })
  })

  it('validates session titles before calling Slack', () => {
    const request = requestOf(slackRenameAgentSessionV2Tool)
    expect(() =>
      request.body?.({
        accessToken: 'xoxb-token',
        authMethod: 'bot_token',
        botToken: '',
        channel: 'C1',
        threadTs: '1.2',
        title: 'x'.repeat(201),
      })
    ).toThrow('200 characters or fewer')
  })

  it('sets Agent View prompts without requiring a thread timestamp', () => {
    expect(slackSetSuggestedPromptsV2Tool.oauth).toMatchObject({
      requiredScopes: ['assistant:write'],
      credentialKind: 'service-account',
    })
    const request = requestOf(slackSetSuggestedPromptsV2Tool)
    expect(
      request.body?.({
        accessToken: 'xoxb-token',
        authMethod: 'bot_token',
        botToken: '',
        channel: 'D1',
        prompts: '[{"title":"Summarize","message":"Summarize this conversation"}]',
        promptsTitle: 'Try one',
      })
    ).toEqual({
      channel_id: 'D1',
      prompts: [{ title: 'Summarize', message: 'Summarize this conversation' }],
      title: 'Try one',
    })
  })
})

describe('Slack streaming tools', () => {
  it('starts with Markdown and returns the stream timestamp', async () => {
    const request = requestOf(slackStartStreamV2Tool)
    expect(
      request.body?.({
        accessToken: 'xoxb-token',
        authMethod: 'bot_token',
        botToken: '',
        channel: 'C1',
        markdownText: 'First',
        recipientUserId: 'U1',
        recipientTeamId: 'T1',
        taskDisplayMode: 'timeline',
      })
    ).toEqual({
      channel: 'C1',
      markdown_text: 'First',
      recipient_user_id: 'U1',
      recipient_team_id: 'T1',
      task_display_mode: 'timeline',
    })

    await expect(
      slackStartStreamV2Tool.transformResponse?.(
        new Response(JSON.stringify({ ok: true, channel: 'C1', ts: '2.3' }))
      )
    ).resolves.toEqual({
      success: true,
      output: { ok: true, channel: 'C1', ts: '2.3' },
    })
  })

  it('requires recipient IDs for channel streams but not direct messages', () => {
    const request = requestOf(slackStartStreamV2Tool)
    const base = {
      accessToken: 'xoxb-token',
      authMethod: 'bot_token',
      botToken: '',
      markdownText: 'First',
    }

    expect(() => request.body?.({ ...base, channel: 'C1' })).toThrow(
      'Recipient User ID and Recipient Team ID are required for channel streams'
    )
    expect(request.body?.({ ...base, channel: 'D1' })).toEqual({
      channel: 'D1',
      markdown_text: 'First',
    })
  })

  it('rejects mixed streaming content modes and empty appends', () => {
    const append = requestOf(slackAppendStreamV2Tool)
    const base = {
      accessToken: 'xoxb-token',
      authMethod: 'bot_token',
      botToken: '',
      channel: 'C1',
      ts: '2.3',
    }
    expect(() =>
      append.body?.({ ...base, markdownText: 'hello', chunks: [{ type: 'text' }] })
    ).toThrow('not both')
    expect(() => append.body?.(base)).toThrow('Provide either Markdown Text or Stream Chunks')
  })

  it('maps final blocks, metadata, status, and the finalized message', async () => {
    const request = requestOf(slackStopStreamV2Tool)
    expect(
      request.body?.({
        accessToken: 'xoxb-token',
        authMethod: 'bot_token',
        botToken: '',
        channel: 'C1',
        ts: '2.3',
        blocks: '[{"type":"section"}]',
        metadata: '{"event_type":"agent_result","event_payload":{"id":"1"}}',
        sessionStatus: 'closed',
      })
    ).toEqual({
      channel: 'C1',
      ts: '2.3',
      blocks: [{ type: 'section' }],
      metadata: { event_type: 'agent_result', event_payload: { id: '1' } },
      session_status: 'closed',
    })

    await expect(
      slackStopStreamV2Tool.transformResponse?.(
        new Response(
          JSON.stringify({
            ok: true,
            channel: 'C1',
            ts: '2.3',
            message: {
              text: 'Done',
              bot_id: 'B1',
              ts: '2.3',
              type: 'message',
              subtype: 'bot_message',
            },
          })
        )
      )
    ).resolves.toEqual({
      success: true,
      output: {
        ok: true,
        channel: 'C1',
        ts: '2.3',
        message: {
          text: 'Done',
          bot_id: 'B1',
          ts: '2.3',
          type: 'message',
          subtype: 'bot_message',
        },
      },
    })
  })
})
