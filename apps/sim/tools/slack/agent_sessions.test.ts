/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { slackRenameAgentSessionV2Tool } from '@/tools/slack/rename_agent_session_v2'
import { slackSetAgentSessionStatusV2Tool } from '@/tools/slack/set_agent_session_status_v2'
import { slackSetSuggestedPromptsV2Tool } from '@/tools/slack/set_suggested_prompts_v2'
import type { ToolConfig } from '@/tools/types'

const AGENT_TOOLS = [slackSetAgentSessionStatusV2Tool, slackRenameAgentSessionV2Tool]

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
    expect(slackSetAgentSessionStatusV2Tool.oauth?.requiredScopes).toContain('chat:write.customize')
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
