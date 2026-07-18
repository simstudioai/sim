import { describe, expect, it } from 'vitest'
import { tiktokGetUserTool } from '@/tools/tiktok/get_user'
import { TIKTOK_USER_FIELDS } from '@/tools/tiktok/utils'

function getRequestUrl(fields?: string): string {
  const url = tiktokGetUserTool.request.url
  if (typeof url !== 'function') throw new Error('Expected a dynamic TikTok user URL')
  return url({ accessToken: 'token', fields })
}

describe('TikTok Get User fields', () => {
  it('always requests stable identity fields and de-duplicates custom fields', () => {
    const url = new URL(getRequestUrl('avatar_large_url,open_id,avatar_large_url'))

    expect(url.searchParams.get('fields')).toBe('open_id,display_name,avatar_large_url')
  })

  it('uses the canonical field set when the custom value is blank', () => {
    const url = new URL(getRequestUrl('   '))

    expect(url.searchParams.get('fields')).toBe(TIKTOK_USER_FIELDS)
  })

  it('normalizes App-facing camelCase output aliases', () => {
    const url = new URL(getRequestUrl('openId,displayName,followerCount'))

    expect(url.searchParams.get('fields')).toBe('open_id,display_name,follower_count')
  })

  it('rejects unsupported custom fields deterministically', () => {
    expect(() => getRequestUrl('open_id,not_a_field,also_bad,not_a_field')).toThrow(
      'Unsupported TikTok user field(s): not_a_field, also_bad'
    )
  })
})
