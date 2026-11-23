import { describe, expect, it } from 'vitest'
import { zepDeleteThreadTool } from '@/tools/zep/delete_thread'
import { zepGetUserTool } from '@/tools/zep/get_user'

const API = 'https://api.getzep.com/api/v2'

function requestUrl(tool: typeof zepDeleteThreadTool, params: Record<string, string>): string {
  const url = tool.request.url
  if (typeof url !== 'function') throw new Error('Zep URL must be built per request')
  return url(params)
}

describe('zep ids at the end of the URL', () => {
  it.each([
    ['thread-1 ', `${API}/threads/thread-1`],
    ['thread 1  \u0001', `${API}/threads/thread%201`],
  ])('deletes thread %j at the URL a raw id resolved to', (threadId, expected) => {
    expect(requestUrl(zepDeleteThreadTool, { threadId, apiKey: 'k' })).toBe(expected)
  })

  it('gets the user at the URL a raw id resolved to', () => {
    expect(requestUrl(zepGetUserTool, { userId: 'user-1 ', apiKey: 'k' })).toBe(
      `${API}/users/user-1`
    )
  })
})
