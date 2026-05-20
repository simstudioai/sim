/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { FALAI_HOSTED_KEY_MARKUP_MULTIPLIER } from '@/lib/tools/falai-pricing'
import { imageGenerateTool } from '@/tools/image/generate'
import { falaiVideoTool } from '@/tools/video/falai'

describe('Fal.ai hosted key pricing', () => {
  it('applies hosted markup to image generation provider cost', () => {
    const pricing = imageGenerateTool.hosting?.pricing
    expect(pricing?.type).toBe('custom')
    if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')

    const result = pricing.getCost(
      {},
      {
        __falaiCostDollars: 0.1,
        __falaiBilling: {
          source: 'billing_events',
          endpointId: 'fal-ai/nano-banana-2',
        },
      }
    )

    expect(typeof result).toBe('object')
    if (typeof result === 'number') throw new Error('Expected structured pricing result')
    expect(result.cost).toBeCloseTo(0.1 * FALAI_HOSTED_KEY_MARKUP_MULTIPLIER)
    expect(result.metadata).toMatchObject({
      providerCostDollars: 0.1,
      markupMultiplier: FALAI_HOSTED_KEY_MARKUP_MULTIPLIER,
      source: 'billing_events',
    })
  })

  it('applies hosted markup to video generation provider cost', () => {
    const pricing = falaiVideoTool.hosting?.pricing
    expect(pricing?.type).toBe('custom')
    if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')

    const result = pricing.getCost(
      {},
      {
        __falaiCostDollars: 0.4,
        __falaiBilling: {
          source: 'billing_events',
          endpointId: 'fal-ai/veo3.1',
        },
      }
    )

    expect(typeof result).toBe('object')
    if (typeof result === 'number') throw new Error('Expected structured pricing result')
    expect(result.cost).toBeCloseTo(0.4 * FALAI_HOSTED_KEY_MARKUP_MULTIPLIER)
    expect(result.metadata).toMatchObject({
      providerCostDollars: 0.4,
      markupMultiplier: FALAI_HOSTED_KEY_MARKUP_MULTIPLIER,
      source: 'billing_events',
    })
  })
})
