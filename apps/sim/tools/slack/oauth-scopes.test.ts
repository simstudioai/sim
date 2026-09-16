/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isAssistantIntegrationTool } from '@/lib/copilot/assistant/tool-policy'
import metadata from '@/tools/generated/tool-metadata'
import type { ToolMetadata } from '@/tools/metadata'

const tools = metadata as Record<string, ToolMetadata>
const slackTools = Object.values(tools).filter((tool) => tool.oauth?.provider === 'slack')

describe('Slack personal-token scope policy', () => {
  it('declares an operation scope policy instead of inheriting all installation scopes', () => {
    expect(slackTools.length).toBeGreaterThan(40)
    for (const tool of slackTools) {
      expect(tool.oauth?.requiredScopes, tool.id).toBeDefined()
    }
  })

  it.each([
    'slack_get_channel_info',
    'slack_get_channel_history',
    'slack_get_thread',
    'slack_get_thread_replies',
    'slack_list_channels',
    'slack_list_members',
  ])('lets Slack evaluate conversation-specific scope alternatives for %s', (toolId) => {
    expect(tools[toolId].oauth?.requiredScopes).toEqual([])
    expect(isAssistantIntegrationTool(tools[toolId])).toBe(true)
  })

  it.each(['slack_message', 'slack_update_message', 'slack_delete_message'])(
    'requires the personal writing scope for %s',
    (toolId) => {
      expect(tools[toolId].oauth?.requiredScopes).toEqual(['chat:write'])
      expect(isAssistantIntegrationTool(tools[toolId])).toBe(true)
    }
  )

  it.each([
    'slack_set_status',
    'slack_set_title',
    'slack_set_suggested_prompts',
    'slack_set_suggested_prompts_v2',
    'slack_set_agent_session_status_v2',
    'slack_rename_agent_session_v2',
  ])('keeps the app-owned operation %s outside personal execution', (toolId) => {
    expect(isAssistantIntegrationTool(tools[toolId])).toBe(false)
  })

  it('uses the metadata API scope when reading a canvas file', () => {
    expect(tools.slack_get_canvas.oauth?.requiredScopes).toEqual(['files:read'])
    expect(tools.slack_edit_canvas.oauth?.requiredScopes).toEqual(['canvases:write'])
  })
})
