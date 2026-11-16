import { describe, expect, it } from 'vitest'
import { AmplitudeBlock } from '@/blocks/blocks/amplitude'

/** Runs the mapper the way an Agent tool call does: its result is spread over the merged args. */
function toolCall(args: Record<string, unknown>, operation: string) {
  const mapParams = AmplitudeBlock.tools.config?.params
  if (!mapParams) throw new Error('Amplitude block has no params mapper')
  return { ...args, ...mapParams(args, { operation }) }
}

describe('AmplitudeBlock agent tool calls', () => {
  it('maps the block-field event key for an operation passed only in context', () => {
    expect(
      toolCall(
        { apiKey: 'k', secretKey: 's', segmentationEventType: 'signup', start: '20260101' },
        'event_segmentation'
      )
    ).toMatchObject({ eventType: 'signup', start: '20260101' })
  })
})
