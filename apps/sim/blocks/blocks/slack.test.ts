import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { SlackV2Block } from '@/blocks/blocks/slack'

function mapSlackV2Params(params: Record<string, unknown>): Record<string, unknown> {
  const mapParams = SlackV2Block.tools.config?.params
  if (!mapParams) throw new Error('Slack v2 parameter mapper is required')
  return mapParams(params)
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
})

describe.each([SlackBlock, SlackV2Block])('$type Block Kit fallback text', (block) => {
  it.each(['send', 'ephemeral', 'update', 'schedule_message'])(
    'keeps optional fallback text visible for %s and preserves it through parameter mapping',
    (operation) => {
      const fieldId = operation === 'update' ? 'updateText' : 'text'
      const field = block.subBlocks.find((candidate) => candidate.id === fieldId)
      if (!field || !block.tools.config?.params) throw new Error('Slack message field is missing')
      const values = {
        operation,
        messageFormat: 'blocks',
        [fieldId]: 'Deployment is ready.\nReview the release notes.',
        blocks: '[{"type":"section","text":{"type":"mrkdwn","text":"*Ready*"}}]',
        scheduleAt: '2000000000',
      }

      expect(evaluateSubBlockCondition(field.condition, values)).toBe(true)
      expect(typeof field.required).toBe('object')
      expect(evaluateSubBlockCondition(field.required as typeof field.condition, values)).toBe(
        false
      )
      expect(
        evaluateSubBlockCondition(field.required as typeof field.condition, {
          ...values,
          messageFormat: 'text',
        })
      ).toBe(true)
      expect(block.tools.config.params(values)).toMatchObject({
        text: values[fieldId],
        blocks: values.blocks,
      })
      expect(block.tools.config.params({ ...values, [fieldId]: undefined }).text).toBeUndefined()
    }
  )
})

describe.each([SlackBlock, SlackV2Block])('$type channel target visibility', (block) => {
  it.each(['update', 'react', 'archive_conversation', 'get_channel_history', 'ephemeral'])(
    'keeps both channel inputs visible for %s after a DM action',
    (operation) => {
      for (const fieldId of ['channel', 'manualChannel']) {
        const field = block.subBlocks.find((candidate) => candidate.id === fieldId)
        if (!field) throw new Error(`Missing ${fieldId}`)
        expect(
          evaluateSubBlockCondition(field.condition, { operation, destinationType: 'dm' }),
          fieldId
        ).toBe(true)
      }
    }
  )

  it.each(['send', 'read', 'schedule_message'])(
    'preserves the channel/DM switch for %s in both modes',
    (operation) => {
      for (const fieldId of ['channel', 'manualChannel']) {
        const field = block.subBlocks.find((candidate) => candidate.id === fieldId)
        if (!field) throw new Error(`Missing ${fieldId}`)
        for (const destinationType of ['channel', 'dm']) {
          expect(
            evaluateSubBlockCondition(field.condition, { operation, destinationType }),
            `${fieldId} ${destinationType}`
          ).toBe(destinationType === 'channel')
        }
      }
    }
  )
})
