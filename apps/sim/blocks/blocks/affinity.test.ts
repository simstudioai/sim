import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/internal/workflows/read-tool-enrichment', () => ({
  readWorkflowInputFieldsForTool: vi.fn(),
  readWorkflowMetadataForTool: vi.fn(),
}))

import { AffinityBlock } from '@/blocks/blocks/affinity'
import { ToolCallParamsError } from '@/providers/tool-params-error'
import { prepareToolExecution, transformBlockTool } from '@/providers/utils'
import { affinityCreateListFieldDropdownOptionTool } from '@/tools/affinity/create_list_field_dropdown_option'

/** Runs the mapper the way an Agent tool call does: its result is spread over the merged args. */
function toolCall(args: Record<string, unknown>, operation: string) {
  const mapParams = AffinityBlock.tools.config?.params
  if (!mapParams) throw new Error('Affinity block has no params mapper')
  return { ...args, ...mapParams(args, { operation }) }
}

describe('AffinityBlock agent tool calls', () => {
  it('maps block-field keys and keeps model args instead of dropping them', () => {
    const result = toolCall(
      { apiKey: 'key', noteEntityType: 'company', entityId: '42', limit: '10' },
      'list_entity_notes'
    )
    expect(result).toMatchObject({ entityType: 'company', entityId: '42', limit: 10 })
    expect(result.noteEntityType).toBeUndefined()

    expect(
      toolCall({ apiKey: 'key', name: 'Deals', type: 'company', isPublic: true }, 'create_list')
    ).toMatchObject({ name: 'Deals', type: 'company', isPublic: true })
  })
})

describe('AffinityBlock dropdown option rank and win rate on a tool call', () => {
  const operation = 'create_list_field_dropdown_option'

  async function prepare(stored: Record<string, string>, modelArgs: Record<string, unknown>) {
    const providerTool = await transformBlockTool(
      { type: AffinityBlock.type, operation, params: { apiKey: 'key', ...stored } },
      {
        selectedOperation: operation,
        getAllBlocks: () => [AffinityBlock],
        getTool: () => affinityCreateListFieldDropdownOptionTool,
      }
    )
    if (!providerTool) throw new Error('Affinity agent tool was not created')
    return prepareToolExecution(providerTool, modelArgs, {}, undefined).executionParams
  }

  const pinnedStatusOption = {
    listId: 'l1',
    fieldId: 'f1',
    optionType: 'status-dropdown',
    optionText: 'Won',
    optionColor: 'green',
    optionStatusCategory: 'won',
  }

  it('fails the call instead of sending the model fields over the pinned option', async () => {
    await expect(
      prepare(pinnedStatusOption, { rank: 2, winRate: 150, type: 'ranked-dropdown', text: 'X' })
    ).rejects.toThrow(ToolCallParamsError)
  })

  it.each([
    ['Option Rank', { optionRank: '  ' }, { rank: 2.5 }],
    ['Win Rate', { optionWinRate: '  ' }, { rank: 1, winRate: 250 }],
  ])('validates the model value behind a blank %s', async (_label, stored, modelArgs) => {
    await expect(prepare({ ...pinnedStatusOption, ...stored }, modelArgs)).rejects.toThrow(
      ToolCallParamsError
    )
  })

  it('sends a valid model rank behind a blank Option Rank', async () => {
    const params = await prepare({ ...pinnedStatusOption, optionRank: '  ' }, { rank: 3 })
    expect(params).toMatchObject({ type: 'status-dropdown', text: 'Won', rank: 3 })
  })
})
