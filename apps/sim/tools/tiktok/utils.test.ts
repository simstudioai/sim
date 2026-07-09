/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tiktokPublishInitApiDataSchema } from '@/tools/tiktok/api-schemas'
import {
  assertTikTokArrayLength,
  assertTikTokVideoSourceInput,
  mapTikTokVideo,
  readTikTokApiResponse,
  readTikTokPublishInitResponse,
  resolveTikTokPhotoCoverIndex,
} from '@/tools/tiktok/utils'

describe('TikTok tool utilities', () => {
  it('turns non-JSON HTTP failures into a structured TikTok error', async () => {
    const response = new Response('Bad gateway', { status: 502 })

    await expect(readTikTokApiResponse(response, tiktokPublishInitApiDataSchema)).resolves.toEqual({
      data: null,
      error: {
        code: 'http_502',
        message: 'TikTok request failed with HTTP 502: Bad gateway',
      },
      rawBody: 'Bad gateway',
    })
  })

  it('preserves internal publish route failures', async () => {
    const response = Response.json(
      { success: false, output: { publishId: '' }, error: 'Upload failed' },
      { status: 400 }
    )

    await expect(readTikTokPublishInitResponse(response)).resolves.toEqual({
      success: false,
      publishId: '',
      error: 'Upload failed',
    })
  })

  it('validates TikTok response data before exposing it to tools', async () => {
    const response = Response.json({
      data: { publish_id: 123 },
      error: { code: 'ok' },
    })

    await expect(readTikTokApiResponse(response, tiktokPublishInitApiDataSchema)).resolves.toEqual({
      data: null,
      error: {
        code: 'invalid_response',
        message: 'TikTok returned an unexpected data shape',
      },
      rawBody: '{"data":{"publish_id":123},"error":{"code":"ok"}}',
    })
  })

  it('normalizes direct TikTok publish responses', async () => {
    const response = Response.json({
      data: { publish_id: 'publish-1' },
      error: { code: 'ok' },
    })

    await expect(readTikTokPublishInitResponse(response)).resolves.toEqual({
      success: true,
      publishId: 'publish-1',
    })
  })

  it('enforces TikTok array limits', () => {
    expect(() => assertTikTokArrayLength([], 'videoIds', 20)).toThrow(
      'videoIds must contain at least one item'
    )
    expect(() => assertTikTokArrayLength(Array.from({ length: 21 }), 'videoIds', 20)).toThrow(
      'videoIds supports at most 20 items'
    )
    expect(() => assertTikTokArrayLength(['video-1'], 'videoIds', 20)).not.toThrow()
  })

  it('requires the input matching the selected video source', () => {
    expect(() => assertTikTokVideoSourceInput('PULL_FROM_URL', undefined, undefined)).toThrow(
      'videoUrl is required when source is PULL_FROM_URL'
    )
    expect(() => assertTikTokVideoSourceInput('FILE_UPLOAD', undefined, undefined)).toThrow(
      'file is required when source is FILE_UPLOAD'
    )
    expect(() =>
      assertTikTokVideoSourceInput('PULL_FROM_URL', 'https://example.com/video.mp4', undefined)
    ).not.toThrow()
  })

  it('validates photo cover indexes against the image list', () => {
    expect(resolveTikTokPhotoCoverIndex(['photo-1'])).toBe(0)
    expect(() => resolveTikTokPhotoCoverIndex(['photo-1'], 1)).toThrow(
      'photoCoverIndex must refer to an item in photoImages'
    )
  })

  it('maps TikTok embed HTML', () => {
    expect(mapTikTokVideo({ id: 'video-1', embed_html: '<blockquote />' }).embedHtml).toBe(
      '<blockquote />'
    )
  })
})
