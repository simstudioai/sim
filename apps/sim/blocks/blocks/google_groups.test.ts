import { describe, expect, it } from 'vitest'
import { GoogleGroupsBlock } from '@/blocks/blocks/google_groups'

/**
 * The executor builds tool params as `{ ...inputs, ...transformedParams }`, so an empty dropdown
 * value the serializer fills in reaches the tool unless the mapper assigns that key explicitly.
 */
describe('GoogleGroupsBlock update settings', () => {
  const mapParams = GoogleGroupsBlock.tools.config?.params as (
    params: Record<string, unknown>
  ) => Record<string, unknown>

  it('maps every unchanged setting to undefined so empty values are never sent', () => {
    const mapped = mapParams({
      operation: 'update_settings',
      oauthCredential: 'cred-1',
      groupEmail: 'team@example.com',
      whoCanJoin: '',
      whoCanViewMembership: '',
      whoCanViewGroup: '',
      whoCanPostMessage: '',
      allowExternalMembers: '',
      customReplyTo: '',
    })
    for (const key of [
      'whoCanJoin',
      'whoCanViewMembership',
      'whoCanViewGroup',
      'whoCanPostMessage',
      'allowExternalMembers',
      'customReplyTo',
    ]) {
      expect(mapped).toHaveProperty(key, undefined)
    }
  })

  it('forwards a chosen setting as a string', () => {
    const mapped = mapParams({
      operation: 'update_settings',
      oauthCredential: 'cred-1',
      groupEmail: 'team@example.com',
      whoCanJoin: 'INVITED_CAN_JOIN',
    })
    expect(mapped.whoCanJoin).toBe('INVITED_CAN_JOIN')
  })
})

describe('GoogleGroupsBlock agent tool calls', () => {
  it('keeps the model orderBy on list_groups when no sort order is chosen', () => {
    const inputs = { customer: 'my_customer', orderBy: 'email' }
    const mapped = GoogleGroupsBlock.tools.config?.params?.(inputs, { operation: 'list_groups' })
    expect({ ...inputs, ...mapped }.orderBy).toBe('email')
  })

  it.each([
    ['update_group', { groupKey: 'team@example.com', name: 'Team', email: 'new@example.com' }],
    ['add_member', { groupKey: 'team@example.com', email: 'member@example.com', role: 'MEMBER' }],
  ])('keeps the model name and email on %s', (operation, inputs) => {
    const mapped = GoogleGroupsBlock.tools.config?.params?.(inputs, { operation })
    expect({ ...inputs, ...mapped }).toMatchObject(inputs)
  })
})
