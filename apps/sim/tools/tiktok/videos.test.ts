import { describe, expect, it } from 'vitest'
import { tiktokListVideosTool } from '@/tools/tiktok/list_videos'
import { tiktokQueryVideosTool } from '@/tools/tiktok/query_videos'

describe('TikTok video response boundaries', () => {
  it('requires list pagination while accepting query responses without it', async () => {
    const listResult = await tiktokListVideosTool.transformResponse?.(
      Response.json({
        data: { videos: [{ id: 'video-1' }], cursor: 123, has_more: false },
        error: { code: 'ok' },
      })
    )
    const queryResult = await tiktokQueryVideosTool.transformResponse?.(
      Response.json({
        data: { videos: [{ id: 'video-1' }] },
        error: { code: 'ok' },
      })
    )

    expect(listResult).toMatchObject({
      success: true,
      output: { videos: [{ id: 'video-1' }], cursor: 123, hasMore: false },
    })
    expect(queryResult).toMatchObject({
      success: true,
      output: { videos: [{ id: 'video-1' }] },
    })
  })

  it('rejects a malformed list payload instead of returning empty success', async () => {
    const result = await tiktokListVideosTool.transformResponse?.(
      Response.json({
        data: { videos: [{ id: 'video-1' }] },
        error: { code: 'ok' },
      })
    )

    expect(result).toEqual({
      success: false,
      output: { videos: [], cursor: null, hasMore: false },
      error: 'TikTok returned an unexpected data shape',
    })
  })

  it('rejects a null query payload instead of returning empty success', async () => {
    const result = await tiktokQueryVideosTool.transformResponse?.(
      Response.json({ data: null, error: { code: 'ok' } })
    )

    expect(result).toEqual({
      success: false,
      output: { videos: [] },
      error: 'No video query data returned',
    })
  })
})
