/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveFireworksWireModel } from '@/providers/fireworks/utils'

describe('resolveFireworksWireModel', () => {
  it('maps the static hosted catalog ids to their serverless resource paths', () => {
    expect(resolveFireworksWireModel('glm-5.2')).toBe('accounts/fireworks/models/glm-5p2')
    expect(resolveFireworksWireModel('kimi-k3')).toBe('accounts/fireworks/models/kimi-k3')
  })

  it('passes user-configured dynamic ids through untouched', () => {
    expect(resolveFireworksWireModel('accounts/acme/models/custom')).toBe(
      'accounts/acme/models/custom'
    )
  })
})
