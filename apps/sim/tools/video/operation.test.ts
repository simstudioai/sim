import { describe, expect, it } from 'vitest'
import { falaiVideoTool } from '@/tools/video'

describe('Video operation declarations', () => {
  it('preserves Fal.ai hosted admission and cost tracking', () => {
    expect(falaiVideoTool.hosting).toMatchObject({
      envKeyPrefix: 'FALAI_API_KEY',
      apiKeyParam: 'apiKey',
      byokProviderId: 'falai',
      rateLimit: { mode: 'per_request', requestsPerMinute: 40 },
    })
    const input = falaiVideoTool.operation.input({
      provider: 'falai',
      apiKey: 'key',
      model: 'veo-3.1',
      prompt: 'A cinematic sunrise',
      __usingHostedKey: true,
    } as Parameters<typeof falaiVideoTool.operation.input>[0] & {
      __usingHostedKey: boolean
    })
    expect(input).toMatchObject({ useHostedCostTracking: true })
  })
})
