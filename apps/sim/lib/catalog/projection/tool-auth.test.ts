import { describe, expect, it } from 'vitest'
import { v2ToolSummarySchema } from '@/lib/api/contracts/v2/catalog'
import { projectToolSummary } from '@/lib/catalog/projection/tool'
import { supportsSlackBotToken } from '@/tools/slack/auth'
import { slackListFilesTool } from '@/tools/slack/list_files'
import { slackMessageTool } from '@/tools/slack/message'
import { slackUpdateMessageTool } from '@/tools/slack/update_message'

const deployment = { hostedKeys: false }

describe('declared Slack authentication alternatives', () => {
  it.each([slackMessageTool, slackUpdateMessageTool])(
    'publishes optional OAuth for $id with a declared bot-token alternative',
    (tool) => {
      expect(supportsSlackBotToken(tool)).toBe(true)
      expect(
        v2ToolSummarySchema.parse(projectToolSummary(tool.id, tool, deployment)).oauth
      ).toMatchObject({
        required: false,
        provider: 'slack',
        requiredScopes: ['chat:write'],
      })
      expect(tool.oauth?.required).toBe(true)
    }
  )

  it('does not invent a bot-token option for an OAuth-only Slack tool', () => {
    expect(supportsSlackBotToken(slackListFilesTool)).toBe(false)
    expect(
      projectToolSummary(slackListFilesTool.id, slackListFilesTool, deployment).oauth?.required
    ).toBe(true)
  })

  it('does not exempt other OAuth providers with similarly named parameters', () => {
    const tool = { ...slackMessageTool, oauth: { required: true, provider: 'github' as const } }
    expect(supportsSlackBotToken(tool)).toBe(false)
    expect(projectToolSummary(tool.id, tool, deployment).oauth?.required).toBe(true)
  })
})
