import { describe, expect, it } from 'vitest'
import { ClerkBlock } from '@/blocks/blocks/clerk'
import { clerkListUsersTool } from '@/tools/clerk/list_users'
import type { ClerkListUsersParams } from '@/tools/clerk/types'

/**
 * A tool call merges the stored row with the model's args (keyed by tool param names) and spreads
 * the mapper result over them; the operation arrives only in `context`.
 */
const toolCall = (args: Record<string, unknown>, operation: string) => ({
  ...args,
  ...ClerkBlock.tools.config?.params?.(args, { operation }),
})

/**
 * The canvas executor spreads the mapper result over the block's serialized inputs and passes no
 * context. Serialized inputs keep non-empty advanced values saved under another operation.
 */
const canvasCall = (inputs: Record<string, unknown>) => ({
  ...inputs,
  ...ClerkBlock.tools.config?.params?.(inputs),
})

const stringParam = (value: unknown) => (typeof value === 'string' ? value : undefined)

const listUsersUrl = (params: Record<string, unknown>) => {
  const url = clerkListUsersTool.request.url
  if (typeof url !== 'function') throw new Error('expected a URL builder')
  const toolParams: ClerkListUsersParams = {
    secretKey: 'sk',
    emailAddress: stringParam(params.emailAddress),
    phoneNumber: stringParam(params.phoneNumber),
    externalId: stringParam(params.externalId),
    username: stringParam(params.username),
    userId: stringParam(params.userId),
  }
  return new URL(url(toolParams)).searchParams
}

describe('ClerkBlock tool calls', () => {
  it('parses metadata the model sends as a JSON string', () => {
    const params = toolCall(
      { secretKey: 'sk', emailAddress: ['a@example.com'], publicMetadata: '{"plan":"pro"}' },
      'clerk_create_user'
    )
    expect(params.publicMetadata).toEqual({ plan: 'pro' })
    expect(params.emailAddress).toEqual(['a@example.com'])
  })

  it('keeps the filters the model sends to List Users', () => {
    const query = listUsersUrl(
      toolCall({ secretKey: 'sk', username: 'alice', externalId: 'ext_1' }, 'clerk_list_users')
    )
    expect(query.getAll('username')).toEqual(['alice'])
    expect(query.getAll('external_id')).toEqual(['ext_1'])
  })
})

describe('ClerkBlock canvas List Users', () => {
  const staleCreateUserInputs = {
    secretKey: 'sk',
    username: 'stale-bob',
    externalId: 'stale-ext',
    phoneNumber: '+15550000000',
  }

  it('does not filter by values saved under Create or Update User', () => {
    const query = listUsersUrl(
      canvasCall({ ...staleCreateUserInputs, operation: 'clerk_list_users' })
    )
    expect(query.has('username')).toBe(false)
    expect(query.has('external_id')).toBe(false)
    expect(query.has('phone_number')).toBe(false)
  })

  it('filters by the List Users filter fields over stale same-named values', () => {
    const query = listUsersUrl(
      canvasCall({
        ...staleCreateUserInputs,
        operation: 'clerk_list_users',
        usernameFilter: 'alice',
      })
    )
    expect(query.getAll('username')).toEqual(['alice'])
  })
})
