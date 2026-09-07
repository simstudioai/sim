/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { describeUserTool } from '@/tools/identity_center/describe_user'

/**
 * Identity Store `DescribeUser` marks `DisplayName`, `Emails`, `UserStatus` and
 * `Title` optional, so the transform substitutes `null` for each. The output
 * metadata has to advertise that same shape.
 *
 * @see https://docs.aws.amazon.com/singlesignon/latest/IdentityStoreAPIReference/API_DescribeUser.html
 */
const NULLABLE_OUTPUTS = ['displayName', 'email', 'userStatus', 'title'] as const

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('identity_center_describe_user outputs', () => {
  it('keeps the tool id byte-identical', () => {
    expect(describeUserTool.id).toBe('identity_center_describe_user')
  })

  it.each(NULLABLE_OUTPUTS)('declares %s nullable rather than optional', (key) => {
    const output = describeUserTool.outputs?.[key]
    expect(output).toBeDefined()
    expect(output?.nullable).toBe(true)
    expect(output?.optional).toBeUndefined()
  })

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
