import { evaluateSubBlockCondition } from '@sim/workflow-code/catalog/canonical-index'
import { describe, expect, it } from 'vitest'
import { SlackBlock, SlackV2Block } from '@/blocks/blocks/slack'

function mapSlackV2Params(params: Record<string, unknown>): Record<string, unknown> {
  const mapParams = SlackV2Block.tools.config?.params
  if (!mapParams) throw new Error('Slack v2 parameter mapper is required')
  return mapParams(params)
}

/**
 * Runs a mapper the way an Agent tool call does: stored row values merged with the model's args,
 * the operation only in context, and the mapper's result spread over the merged params.
 */
function toolCall(
  block: typeof SlackBlock,
  operation: string,
  merged: Record<string, unknown>
): Record<string, unknown> {
  const mapParams = block.tools.config?.params
  if (!mapParams) throw new Error('Slack parameter mapper is required')
  return { ...merged, ...mapParams(merged, { operation }) }
}

function isSlackV2SubBlockVisible(subBlockId: string, values: Record<string, unknown>): boolean {
  const subBlock = SlackV2Block.subBlocks.find((candidate) => candidate.id === subBlockId)
  if (!subBlock) throw new Error(`Slack v2 subblock not found: ${subBlockId}`)
  return evaluateSubBlockCondition(subBlock.condition, values)
}

describe('Slack block release', () => {
  it('uses service-account tools for new agent operations', () => {
    const selectTool = SlackV2Block.tools.config?.tool
    if (!selectTool) throw new Error('Slack v2 tool selector is required')

    expect(
      selectTool({ operation: 'set_agent_suggested_prompts', agentCredentialId: 'custom-bot' })
    ).toBe('slack_set_suggested_prompts_v2')
    expect(selectTool({ operation: 'set_agent_session_status' })).toBe(
      'slack_set_agent_session_status_v2'
    )

    const mapped = mapSlackV2Params({
      operation: 'set_agent_session_status',
      agentCredentialId: 'custom-bot',
      agentChannelId: 'C123',
      agentThreadTs: '1700000000.000001',
      agentSessionStatus: 'processing',
    })
    expect(mapped).toMatchObject({
      credential: 'custom-bot',
      channel: 'C123',
      threadTs: '1700000000.000001',
      status: 'processing',
    })

    const agentPromptValues = {
      operation: 'set_agent_suggested_prompts',
      agentBotCredential: 'custom-bot',
      agentChannel: 'D123',
      agentThreadTs: '1700000000.000001',
    }
    expect(isSlackV2SubBlockVisible('credential', agentPromptValues)).toBe(false)
    expect(isSlackV2SubBlockVisible('channel', agentPromptValues)).toBe(false)
    expect(isSlackV2SubBlockVisible('getThreadTimestamp', agentPromptValues)).toBe(false)
    expect(isSlackV2SubBlockVisible('suggestedPrompts', agentPromptValues)).toBe(true)
    expect(isSlackV2SubBlockVisible('agentBotCredential', agentPromptValues)).toBe(true)
    expect(isSlackV2SubBlockVisible('agentChannel', agentPromptValues)).toBe(true)
    expect(isSlackV2SubBlockVisible('agentThreadTs', agentPromptValues)).toBe(true)

    expect(
      mapSlackV2Params({
        operation: 'set_agent_suggested_prompts',
        agentCredentialId: 'custom-bot',
        agentChannelId: 'D123',
        agentThreadTs: '1700000000.000001',
        suggestedPrompts: '[{"title":"Summarize","message":"Summarize this thread"}]',
        promptsTitle: 'Try asking',
      })
    ).toMatchObject({
      credential: 'custom-bot',
      channel: 'D123',
      threadTs: '1700000000.000001',
      prompts: '[{"title":"Summarize","message":"Summarize this thread"}]',
      promptsTitle: 'Try asking',
    })

    const repurposedValues = {
      operation: 'set_agent_suggested_prompts',
      credential: 'stale-credential',
      channel: 'C123',
      suggestedPrompts: '[{"title":"Summarize","message":"Summarize this thread"}]',
    }
    expect(isSlackV2SubBlockVisible('credential', repurposedValues)).toBe(false)
    expect(isSlackV2SubBlockVisible('channel', repurposedValues)).toBe(false)
    expect(isSlackV2SubBlockVisible('agentBotCredential', repurposedValues)).toBe(true)
    expect(isSlackV2SubBlockVisible('agentChannel', repurposedValues)).toBe(true)
    expect(selectTool(repurposedValues)).toBe('slack_set_suggested_prompts_v2')
  })

  it('maps a single page and cursor for list channels', () => {
    const values = { operation: 'list_channels' }
    expect(SlackV2Block.outputs.hasMore.description).toBe(
      'Whether more thread messages or provider pages remain beyond the fetched window'
    )
    expect(SlackV2Block.subBlocks.some((subBlock) => subBlock.id === 'channelMaxPages')).toBe(false)
    expect(isSlackV2SubBlockVisible('paginationCursor', values)).toBe(true)
    expect(
      mapSlackV2Params({
        ...values,
        channelLimit: '50',
        channelMaxPages: '4',
        paginationCursor: ' cursor-1 ',
      })
    ).toMatchObject({
      limit: 50,
      cursor: 'cursor-1',
    })
    expect(() => mapSlackV2Params({ ...values, channelLimit: '201' })).toThrow(
      'Conversations per page must be an integer between 1 and 200'
    )
    expect(mapSlackV2Params({ ...values, channelMaxPages: '200' })).not.toHaveProperty('maxPages')
    expect(mapSlackV2Params({ ...values, channelLimit: null, channelMaxPages: ' ' })).toMatchObject(
      { limit: 100 }
    )
  })

  describe('tool calls (operation only in context)', () => {
    it('sends the stored bot credential for workflow operations', () => {
      expect(
        toolCall(SlackV2Block, 'add_bookmark', {
          apiBotCredentialId: 'bot-cred',
          channel_id: 'C1',
          title: 'Docs',
          link: 'https://example.com',
        })
      ).toMatchObject({ credential: 'bot-cred', channel_id: 'C1', title: 'Docs' })
    })

    it('keeps the model value over a workflow field default', () => {
      expect(
        toolCall(SlackV2Block, 'get_team_profile', {
          apiBotCredentialId: 'bot-cred',
          visibility: 'hidden',
        })
      ).toMatchObject({ credential: 'bot-cred', visibility: 'hidden' })
    })

    it('maps stored workflow fields when the model omits them', () => {
      expect(
        toolCall(SlackV2Block, 'list_files', {
          apiOAuthCredentialId: 'cred',
          slack_list_files_channel: 'C123',
        })
      ).toMatchObject({ credential: 'cred', channel: 'C123' })
    })

    it('keeps model args the v1 branches would otherwise overwrite', () => {
      expect(
        toolCall(SlackBlock, 'edit_canvas', {
          oauthCredential: 'cred',
          canvasId: 'F1',
          operation: 'insert_at_end',
          content: 'x',
        })
      ).toMatchObject({ credential: 'cred', canvasId: 'F1', operation: 'insert_at_end' })
      expect(
        toolCall(SlackBlock, 'get_channel_history', { channel: 'C1', inclusive: true })
      ).toMatchObject({ inclusive: true })
      expect(toolCall(SlackBlock, 'list_users', { includeDeleted: true, limit: 5 })).toMatchObject({
        includeDeleted: true,
        limit: 5,
      })
      expect(
        toolCall(SlackBlock, 'list_channels', { includePrivate: false, limit: 20 })
      ).toMatchObject({ includePrivate: false, limit: 20 })
      expect(toolCall(SlackBlock, 'list_channels', { excludeArchived: false })).toMatchObject({
        excludeArchived: false,
      })
      expect(
        toolCall(SlackBlock, 'schedule_message', { channel: 'C1', text: 'hi', postAt: 1900000000 })
      ).toMatchObject({ postAt: 1900000000 })
      expect(
        toolCall(SlackBlock, 'update_view', { externalId: 'ext-1', view: { type: 'modal' } })
      ).toMatchObject({ externalId: 'ext-1', view: { type: 'modal' } })
    })

    it('maps stored v1 fields under their tool param names', () => {
      expect(
        toolCall(SlackV2Block, 'lookup_canvas_sections', {
          oauthCredential: 'cred',
          lookupCanvasId: 'F1',
          sectionCriteria: '{"contains_text":"x"}',
        })
      ).toMatchObject({ canvasId: 'F1', criteria: '{"contains_text":"x"}' })
    })

    it('keeps model args for List and agent session operations', () => {
      expect(
        toolCall(SlackV2Block, 'list_items', {
          listCredentialId: 'bot',
          listId: 'L1',
          limit: 10,
          cursor: 'c1',
        })
      ).toMatchObject({ credential: 'bot', listId: 'L1', limit: 10, cursor: 'c1' })
      expect(
        toolCall(SlackV2Block, 'set_agent_session_status', {
          agentCredentialId: 'bot',
          channel: 'C1',
          threadTs: '1.2',
          status: 'processing',
        })
      ).toMatchObject({ credential: 'bot', channel: 'C1', threadTs: '1.2', status: 'processing' })
    })
  })
})
