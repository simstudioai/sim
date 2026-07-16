/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { instagramGetPublishingLimitTool } from '@/tools/instagram/get_publishing_limit'

describe('instagramGetPublishingLimitTool', () => {
  it('maps and describes the structured quota config', async () => {
    const result = await instagramGetPublishingLimitTool.transformResponse?.(
      Response.json({
        data: [
          {
            quota_usage: 12,
            config: { quota_total: 100, quota_duration: 86_400 },
          },
        ],
      }),
      { accessToken: 'token' }
    )

    expect(result).toEqual({
      success: true,
      output: {
        quotaUsage: 12,
        config: { quotaTotal: 100, quotaDuration: 86_400 },
      },
    })
    expect(instagramGetPublishingLimitTool.outputs?.config.properties).toMatchObject({
      quotaTotal: { type: 'number', nullable: true },
      quotaDuration: { type: 'number', nullable: true },
    })
  })

  it('normalizes malformed quota values instead of leaking invalid output types', async () => {
    const result = await instagramGetPublishingLimitTool.transformResponse?.(
      Response.json({
        data: [{ quota_usage: '12', config: { quota_total: '100', quota_duration: null } }],
      }),
      { accessToken: 'token' }
    )

    expect(result).toEqual({
      success: true,
      output: {
        quotaUsage: null,
        config: { quotaTotal: null, quotaDuration: null },
      },
    })
  })
})
