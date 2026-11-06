import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks'
import { GaugeBlock } from '@/blocks/blocks/gauge'
import { extractBlockParams } from '@/serializer/index'
import { prepareBlockState } from '@/stores/workflows/prepare-block-state'
import { gaugeListPromptsTool } from '@/tools/gauge/list_prompts'
import type { GaugeListPromptsParams } from '@/tools/gauge/types'
import { prepareToolRequest } from '@/tools/request-transport'

describe('Gauge canvas operation changes', () => {
  beforeEach(() => {
    vi.mocked(getBlock).mockReturnValue(GaugeBlock)
  })

  it.each([false, true])(
    'does not reuse an old topic array after clearing the prompt filter (advanced: %s)',
    (advancedMode) => {
      const block = prepareBlockState({
        id: 'gauge_fixture',
        type: 'gauge',
        name: 'Gauge',
        position: { x: 0, y: 0 },
      })
      block.advancedMode = advancedMode
      block.subBlocks.operation.value = 'gauge_list_prompts'
      block.subBlocks.manualOrg.value = 'example'
      block.subBlocks.manualCategory.value = 'example'
      block.subBlocks.topic.value = '["top_stale"]'
      const params = extractBlockParams(block)
      const mapped = GaugeBlock.tools.config?.params?.(params)
      if (!mapped) throw new Error('Gauge parameter mapping is unavailable')
      const request = prepareToolRequest(gaugeListPromptsTool, {
        ...mapped,
        org: 'example',
        category: 'example',
        accessToken: 'fixture-token',
      } as GaugeListPromptsParams)
      expect(new URL(request.url).searchParams.has('topic')).toBe(false)
    }
  )
})
