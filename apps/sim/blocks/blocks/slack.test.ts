/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import {
  getSlackV2ActionSubBlocks,
  getSlackV2OperationSentences,
  getSlackV2ToolAccess,
  SlackBlock,
  SlackV2Block,
} from '@/blocks/blocks/slack'

const AGENT_OPERATION_IDS = [
  'set_agent_suggested_prompts',
  'set_agent_session_status',
  'rename_agent_session',
]
const AGENT_TOOL_IDS = [
  'slack_set_suggested_prompts_v2',
  'slack_set_agent_session_status_v2',
  'slack_rename_agent_session_v2',
]
const ASSISTANT_OPERATION_IDS = ['set_status', 'set_title', 'set_suggested_prompts']
const ASSISTANT_TOOL_IDS = ['slack_set_status', 'slack_set_title']

function operationIds(): string[] {
  const operation = SlackV2Block.subBlocks.find((subBlock) => subBlock.id === 'operation')
  return operation?.options?.map((option) => option.id) ?? []
}

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
  it('releases slack_v2 and keeps the legacy block executable but hidden', () => {
    expect(SlackBlock.hideFromToolbar).toBe(true)
    expect(SlackBlock.sunset).toEqual({ status: 'legacy', replacedBy: 'slack_v2' })
    expect(SlackV2Block.hideFromToolbar).toBe(false)
    expect(SlackV2Block.preview).toBeUndefined()
    expect(SlackV2Block.sunset).toBeUndefined()
  })

  it('adds custom-bot Agent Sessions operations without removing assistant operations', () => {
    expect(operationIds()).toEqual(
      expect.arrayContaining([...ASSISTANT_OPERATION_IDS, ...AGENT_OPERATION_IDS])
    )
    expect(getSlackV2ToolAccess()).toEqual(
      expect.arrayContaining([...ASSISTANT_TOOL_IDS, ...AGENT_TOOL_IDS])
    )
    expect(getSlackV2ToolAccess()).toContain('slack_set_suggested_prompts')
    expect(Object.keys(getSlackV2OperationSentences())).toEqual(
      expect.arrayContaining([...ASSISTANT_OPERATION_IDS, ...AGENT_OPERATION_IDS])
    )
  })

  it('keeps assistant operations routed to their original tools', () => {
    const selectTool = SlackV2Block.tools.config?.tool
    if (!selectTool) throw new Error('Slack v2 tool selector is required')

    expect(selectTool({ operation: 'set_status' })).toBe('slack_set_status')
    expect(selectTool({ operation: 'set_title' })).toBe('slack_set_title')
  })

  it('uses a service-account-only picker for Agent Sessions operations', () => {
    const credential = getSlackV2ActionSubBlocks().find(
      (subBlock) => subBlock.id === 'agentBotCredential'
    )
    expect(credential).toMatchObject({
      credentialKind: 'service-account',
      canonicalParamId: 'agentCredentialId',
      required: true,
    })
  })

  it('keeps assistant suggested prompts on the original fields and tool', () => {
    const selectTool = SlackV2Block.tools.config?.tool
    if (!selectTool) throw new Error('Slack v2 tool selector is required')

    expect(
      selectTool({ operation: 'set_suggested_prompts', oauthCredential: 'oauth-credential' })
    ).toBe('slack_set_suggested_prompts')
    expect(
      mapSlackV2Params({
        operation: 'set_suggested_prompts',
        oauthCredential: 'oauth-credential',
        channel: 'C123',
        getThreadTimestamp: '1700000000.000001',
        suggestedPrompts: '[{"title":"Summarize","message":"Summarize this thread"}]',
        promptsTitle: 'Try asking',
      })
    ).toMatchObject({
      credential: 'oauth-credential',
      channel: 'C123',
      threadTs: '1700000000.000001',
      prompts: '[{"title":"Summarize","message":"Summarize this thread"}]',
      promptsTitle: 'Try asking',
    })

    const assistantValues = {
      operation: 'set_suggested_prompts',
      credential: 'oauth-credential',
      channel: 'C123',
      getThreadTimestamp: '1700000000.000001',
    }
    expect(isSlackV2SubBlockVisible('credential', assistantValues)).toBe(true)
    expect(isSlackV2SubBlockVisible('channel', assistantValues)).toBe(true)
    expect(isSlackV2SubBlockVisible('getThreadTimestamp', assistantValues)).toBe(true)
    expect(isSlackV2SubBlockVisible('suggestedPrompts', assistantValues)).toBe(true)
    expect(isSlackV2SubBlockVisible('agentBotCredential', assistantValues)).toBe(false)
    expect(isSlackV2SubBlockVisible('agentChannel', assistantValues)).toBe(false)
    expect(isSlackV2SubBlockVisible('agentThreadTs', assistantValues)).toBe(false)
  })

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
