/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { InstagramBlock } from '@/blocks/blocks/instagram'

describe('InstagramBlock', () => {
  const buildParams = InstagramBlock.tools.config.params!
  const selectTool = InstagramBlock.tools.config.tool!

  it('keeps all 24 dropdown operations aligned with tool access', () => {
    const operation = InstagramBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const optionIds = operation?.options?.map((option) => option.id)

    expect(optionIds).toHaveLength(24)
    expect(new Set(optionIds)).toEqual(new Set(InstagramBlock.tools.access))
  })

  it('clears stale operation parameters from the runtime input merge', () => {
    const inputs = {
      operation: 'instagram_get_conversation_messages',
      oauthCredential: 'credential-1',
      conversationId: 'conversation-1',
      limit: '12',
      after: 'message-cursor',
      mediaId: 'stale-media-id',
      filename: 'stale-filename.jpg',
      caption: 'stale caption',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs).toMatchObject({
      credential: 'credential-1',
      conversationId: 'conversation-1',
      limit: 12,
      after: 'message-cursor',
    })
    expect(finalInputs.mediaId).toBeUndefined()
    expect(finalInputs.filename).toBeUndefined()
    expect(finalInputs.caption).toBeUndefined()
  })

  it('rejects operations outside the registered Instagram tool set', () => {
    expect(() => selectTool({ operation: 'instagram_unknown_operation' })).toThrow(
      'Unsupported Instagram operation'
    )
  })

  it('normalizes publishing files without accepting public URL strings', () => {
    const file = {
      id: 'file-1',
      key: 'execution/workflow/execution/photo.jpg',
      name: 'photo.jpg',
      size: 1024,
      type: 'image/jpeg',
    }

    expect(buildParams({ operation: 'instagram_publish_image', image: file }).image).toEqual(file)
    expect(
      buildParams({
        operation: 'instagram_publish_carousel',
        carouselMedia: JSON.stringify([file, { ...file, id: 'file-2', name: 'photo-2.jpg' }]),
      }).media
    ).toHaveLength(2)
    expect(
      buildParams({ operation: 'instagram_publish_image', image: 'https://example.com/photo.jpg' })
        .image
    ).toBeUndefined()
  })

  it('clears account insight parameters that do not apply to the selected period', () => {
    const day = buildParams({
      operation: 'instagram_get_account_insights',
      period: 'day',
      since: '2026-07-01',
      until: '2026-07-13',
      timeframe: 'this_month',
    })
    expect(day).toMatchObject({ period: 'day', since: '2026-07-01', until: '2026-07-13' })
    expect(day.timeframe).toBeUndefined()

    const lifetime = buildParams({
      operation: 'instagram_get_account_insights',
      period: 'lifetime',
      since: '2026-07-01',
      until: '2026-07-13',
      timeframe: 'this_month',
    })
    expect(lifetime).toMatchObject({ period: 'lifetime', timeframe: 'this_month' })
    expect(lifetime.since).toBeUndefined()
    expect(lifetime.until).toBeUndefined()

    expect(() =>
      buildParams({ operation: 'instagram_get_account_insights', period: 'week' })
    ).toThrow('Instagram account insights period must be day or lifetime')
  })

  it('maps the provider-local insight field to the tool metrics parameter', () => {
    const metricsSubBlock = InstagramBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'insightMetrics'
    )

    expect(metricsSubBlock?.type).toBe('short-input')
    expect(InstagramBlock.subBlocks.some((subBlock) => subBlock.id === 'metrics')).toBe(false)
    expect(
      buildParams({
        operation: 'instagram_get_media_insights',
        insightMetrics: 'reach,views',
      })
    ).toMatchObject({ metrics: 'reach,views', insightMetrics: undefined })
  })
})
