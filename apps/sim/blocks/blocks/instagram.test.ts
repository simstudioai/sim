/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { InstagramBlock } from '@/blocks/blocks/instagram'

describe('InstagramBlock', () => {
  const buildParams = InstagramBlock.tools.config.params!
  const selectTool = InstagramBlock.tools.config.tool!

  it('stays hidden from discovery until the Instagram integration is approved', () => {
    expect(InstagramBlock.hideFromToolbar).toBe(true)
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

  it('offers only current account insight periods and requires a demographic timeframe', () => {
    const period = InstagramBlock.subBlocks.find((subBlock) => subBlock.id === 'period')
    const timeframe = InstagramBlock.subBlocks.find((subBlock) => subBlock.id === 'timeframe')

    expect(period?.options?.map((option) => option.id)).toEqual(['day', 'lifetime'])
    expect(timeframe?.options?.map((option) => option.id)).toEqual(['this_week', 'this_month'])
    expect(timeframe?.value?.()).toBe('this_month')
    expect(timeframe?.required).toEqual({
      field: 'operation',
      value: 'instagram_get_account_insights',
      and: { field: 'period', value: 'lifetime' },
    })
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
})
