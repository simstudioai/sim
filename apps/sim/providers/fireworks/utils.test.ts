/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveFireworksWireModel } from '@/providers/fireworks/utils'

describe('resolveFireworksWireModel', () => {
  it('maps the static hosted catalog ids to their serverless resource paths', () => {
    expect(resolveFireworksWireModel('deepseek-v4-pro')).toBe(
      'accounts/fireworks/models/deepseek-v4-pro'
    )
    expect(resolveFireworksWireModel('glm-5.2')).toBe('accounts/fireworks/models/glm-5p2')
    expect(resolveFireworksWireModel('kimi-k3')).toBe('accounts/fireworks/models/kimi-k3')
  })

  it.each([
    ['minimax-m2.7', 'accounts/fireworks/models/minimax-m2p7'],
    ['qwen3.7-max', 'accounts/fireworks/models/qwen3p7-max'],
    ['gpt-oss-120b', 'accounts/fireworks/models/gpt-oss-120b'],
    ['nemotron-3-ultra-nvfp4', 'accounts/fireworks/models/nemotron-3-ultra-nvfp4'],
    ['nemotron-3-ultra-bf16', 'accounts/fireworks/models/nemotron-3-ultra-bf16'],
    [
      'nemotron-3-super-120b-a12b-nvfp4',
      'accounts/fireworks/models/nvidia-nemotron-3-super-120b-a12b-nvfp4',
    ],
    [
      'nemotron-3-super-120b-a12b-fp8',
      'accounts/fireworks/models/nvidia-nemotron-3-super-120b-a12b-fp8',
    ],
    ['ling-3-flash', 'accounts/fireworks/models/ling-3-flash'],
  ])('maps JSON-only alias %s to the documented Fireworks resource', (id, wireId) => {
    expect(resolveFireworksWireModel(id)).toBe(wireId)
  })

  it('passes user-configured dynamic ids through untouched', () => {
    expect(resolveFireworksWireModel('accounts/acme/models/custom')).toBe(
      'accounts/acme/models/custom'
    )
  })
})
