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

const EXTENDED_OPERATION_IDS = ['set_status', 'set_title', 'set_suggested_prompts']
const EXTENDED_TOOL_IDS = ['slack_set_status', 'slack_set_title', 'slack_set_suggested_prompts']

function operationIds(extendedScopesEnabled: boolean): string[] {
  const operation = getSlackV2ActionSubBlocks(extendedScopesEnabled).find(
    (subBlock) => subBlock.id === 'operation'
  )
  return operation?.options?.map((option) => option.id) ?? []
}

describe('Slack block extended-scope capability', () => {
  it('releases slack_v2 and keeps the legacy block executable but hidden', () => {
    expect(SlackBlock.hideFromToolbar).toBe(true)
    expect(SlackBlock.sunset).toEqual({ status: 'legacy', replacedBy: 'slack_v2' })
    expect(SlackV2Block.hideFromToolbar).toBe(false)
    expect(SlackV2Block.preview).toBeUndefined()
    expect(SlackV2Block.sunset).toBeUndefined()
  })

  it('removes extended-scope operations and tools when the capability is disabled', () => {
    expect(operationIds(false)).not.toEqual(expect.arrayContaining(EXTENDED_OPERATION_IDS))
    expect(getSlackV2ToolAccess(false)).not.toEqual(expect.arrayContaining(EXTENDED_TOOL_IDS))
    expect(Object.keys(getSlackV2OperationSentences(false))).not.toEqual(
      expect.arrayContaining(EXTENDED_OPERATION_IDS)
    )
  })

  it('restores extended-scope operations and tools when the capability is enabled', () => {
    expect(operationIds(true)).toEqual(expect.arrayContaining(EXTENDED_OPERATION_IDS))
    expect(getSlackV2ToolAccess(true)).toEqual(expect.arrayContaining(EXTENDED_TOOL_IDS))
    expect(Object.keys(getSlackV2OperationSentences(true))).toEqual(
      expect.arrayContaining(EXTENDED_OPERATION_IDS)
    )
  })
})
