import { describe, expect, it } from 'vitest'
import { CheckrBlock } from '@/blocks/blocks/checkr'

const mapper = CheckrBlock.tools.config?.params
if (!mapper) throw new Error('CheckrBlock has no params mapper')
const mapToolParams = mapper

/**
 * Agent tool calls carry the operation only in `context` and key model args by the tool's
 * param names; the result is spread over the merged params, as `buildBlockToolParamsTransform` does.
 */
const toolCall = (operation: string, merged: Record<string, unknown>) => ({
  ...merged,
  ...mapToolParams(merged, { operation }),
})

describe('CheckrBlock tool calls', () => {
  it('sends the stored report tags when ordering a report', () => {
    const params = toolCall('create_report', {
      apiKey: 'key',
      candidateId: 'cand_1',
      package: 'basic',
      reportTags: 'urgent, onsite',
    })

    expect(params.tags).toEqual(['urgent', 'onsite'])
  })

  it('keeps the model node and work locations when updating a continuous check', () => {
    const params = toolCall('update_continuous_check', {
      apiKey: 'key',
      continuousCheckId: 'cc_1',
      node: 'node_1',
      workLocations: [{ country: 'US', state: 'CA' }],
    })

    expect(params.node).toBe('node_1')
    expect(params.workLocations).toEqual([{ country: 'US', state: 'CA' }])
  })
})
