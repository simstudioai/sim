import { describe, expect, it } from 'vitest'
import { BrightDataBlock } from '@/blocks/blocks/brightdata'

const mapper = BrightDataBlock.tools.config?.params
if (!mapper) throw new Error('BrightDataBlock has no params mapper')
const mapToolParams = mapper

/**
 * Agent tool calls carry the operation only in `context` and key model args by the tool's
 * param names; the result is spread over the merged params, as `buildBlockToolParamsTransform` does.
 */
const toolCall = (operation: string, merged: Record<string, unknown>) => ({
  ...merged,
  ...mapToolParams(merged, { operation }),
})

describe('BrightDataBlock tool calls', () => {
  it('maps stored block fields and keeps the model dataset and URLs for sync scrape', () => {
    const params = toolCall('sync_scrape', {
      apiKey: 'key',
      datasetId: 'gd_model',
      urls: '[{"url":"https://example.com"}]',
      syncFormat: 'csv',
    })

    expect(params.datasetId).toBe('gd_model')
    expect(params.urls).toBe('[{"url":"https://example.com"}]')
    expect(params.format).toBe('csv')
  })
})
