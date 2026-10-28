import { jsonResponse } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { describeUserTool } from '@/tools/identity_center/describe_user'

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
