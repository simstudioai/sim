import { describe, expect, it } from 'vitest'
import { describeUserTool } from '@/tools/identity_center/describe_user'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('identity_center_describe_user outputs', () => {
  it('emits null for every field the Identity Store omitted', async () => {
    const result = await describeUserTool.transformResponse?.(
      jsonResponse({ userId: 'u-1', userName: 'someone' })
    )

    expect(result?.output).toEqual({
      userId: 'u-1',
      userName: 'someone',
      displayName: null,
      email: null,
      userStatus: null,
      title: null,
      externalIds: [],
    })
  })
})
