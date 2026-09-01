/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getSlackV2ActionSubBlocks,
  getSlackV2OperationSentences,
  getSlackV2ToolAccess,
  SlackBlock,
  SlackV2Block,
} from '@/blocks/blocks/slack'

const AGENT_OPERATION_IDS = [
  'set_suggested_prompts',
  'set_agent_session_status',
  'rename_agent_session',
]
const AGENT_TOOL_IDS = [
  'slack_set_suggested_prompts_v2',
  'slack_set_agent_session_status_v2',
  'slack_rename_agent_session_v2',
]

function operationIds(): string[] {
  const operation = SlackV2Block.subBlocks.find((subBlock) => subBlock.id === 'operation')
  return operation?.options?.map((option) => option.id) ?? []
}

function mapSlackV2Params(params: Record<string, unknown>): Record<string, unknown> {
  const mapParams = SlackV2Block.tools.config?.params
  if (!mapParams) throw new Error('Slack v2 parameter mapper is required')
  return mapParams(params)
}

describe('Slack block release', () => {
  it('releases slack_v2 and keeps the legacy block executable but hidden', () => {
    expect(SlackBlock.hideFromToolbar).toBe(true)
    expect(SlackBlock.sunset).toEqual({ status: 'legacy', replacedBy: 'slack_v2' })
    expect(SlackV2Block.hideFromToolbar).toBe(false)
    expect(SlackV2Block.preview).toBeUndefined()
    expect(SlackV2Block.sunset).toBeUndefined()
  })

  it('replaces legacy assistant operations with custom-bot Agent Sessions operations', () => {
    expect(operationIds()).toEqual(expect.arrayContaining(AGENT_OPERATION_IDS))
    for (const id of ['set_status', 'set_title']) {
      expect(operationIds()).not.toContain(id)
    }
    expect(getSlackV2ToolAccess()).toEqual(expect.arrayContaining(AGENT_TOOL_IDS))
    expect(getSlackV2ToolAccess()).toContain('slack_set_suggested_prompts')
    for (const id of ['slack_set_status', 'slack_set_title']) {
      expect(getSlackV2ToolAccess()).not.toContain(id)
    }
    expect(Object.keys(getSlackV2OperationSentences())).toEqual(
      expect.arrayContaining(AGENT_OPERATION_IDS)
    )
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

  it('keeps persisted OAuth suggested prompts on the compatibility tool', () => {
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
  })

  it('uses service-account tools for new agent operations', () => {
    const selectTool = SlackV2Block.tools.config?.tool
    if (!selectTool) throw new Error('Slack v2 tool selector is required')

    expect(
      selectTool({ operation: 'set_suggested_prompts', agentCredentialId: 'custom-bot' })
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
  })
})
