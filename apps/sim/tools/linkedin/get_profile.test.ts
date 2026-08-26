/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { linkedInGetProfileTool } from '@/tools/linkedin/get_profile'

function userinfoResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('linkedInGetProfileTool.transformResponse', () => {
  it('projects the OpenID userinfo payload onto the profile output', async () => {
    const response = userinfoResponse({
      sub: 'abc123',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      picture: 'https://media.example/ada.jpg',
      locale: 'en_US',
    })

    const result = await linkedInGetProfileTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      profile: {
        id: 'abc123',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        picture: 'https://media.example/ada.jpg',
      },
    })
  })
})

describe('linkedInGetProfileTool.outputs', () => {
  it('declares exactly the keys transformResponse returns', () => {
    expect(Object.keys(linkedInGetProfileTool.outputs ?? {})).toEqual(['profile'])
    expect(Object.keys(linkedInGetProfileTool.outputs?.profile.properties ?? {}).sort()).toEqual([
      'email',
      'id',
      'name',
      'picture',
    ])
  })
})
