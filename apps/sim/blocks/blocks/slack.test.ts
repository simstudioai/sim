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
  'start_stream',
  'append_stream',
  'stop_stream',
]
const AGENT_TOOL_IDS = [
  'slack_set_suggested_prompts_v2',
  'slack_set_agent_session_status_v2',
  'slack_rename_agent_session_v2',
  'slack_start_stream_v2',
  'slack_append_stream_v2',
  'slack_stop_stream_v2',
]

function operationIds(): string[] {
  const operation = SlackV2Block.subBlocks.find((subBlock) => subBlock.id === 'operation')
  return operation?.options?.map((option) => option.id) ?? []
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
    expect(operationIds()).not.toEqual(expect.arrayContaining(['set_status', 'set_title']))
    expect(getSlackV2ToolAccess()).toEqual(expect.arrayContaining(AGENT_TOOL_IDS))
    expect(getSlackV2ToolAccess()).not.toEqual(
      expect.arrayContaining(['slack_set_status', 'slack_set_title', 'slack_set_suggested_prompts'])
    )
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
})
