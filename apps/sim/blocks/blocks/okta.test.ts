/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OktaBlock } from '@/blocks/blocks/okta'

/**
 * The generic block handler runs `{ ...inputs, ...transformedParams }`, so the
 * transform can only drop a value by assigning `undefined` to its key. Omitting
 * the key leaves the raw subBlock string in place. These cases pin that
 * behavior by asserting on the merge, not on the transform alone.
 */
function merge(inputs: Record<string, unknown>): Record<string, unknown> {
  const transform = OktaBlock.tools.config?.params
  if (!transform) throw new Error('Okta block has no params transform')
  return { ...inputs, ...transform(inputs) }
}

const BASE = { operation: 'okta_list_users', apiKey: 'token', domain: 'dev-1.okta.com' }

describe('Okta block params transform', () => {
  it('coerces a numeric limit', () => {
    expect(merge({ ...BASE, limit: '25' }).limit).toBe(25)
  })

  it('drops a non-numeric limit rather than forwarding the raw entry', () => {
    expect(merge({ ...BASE, limit: 'twenty' }).limit).toBeUndefined()
  })

  it('drops a non-numeric priority rather than forwarding the raw entry', () => {
    const merged = merge({
      ...BASE,
      operation: 'okta_assign_group_to_app',
      priority: 'high',
    })
    expect(merged.priority).toBeUndefined()
  })

  it('drops a blank profile field so a partial update leaves Okta untouched', () => {
    const merged = merge({
      ...BASE,
      operation: 'okta_update_user',
      userId: '00u1',
      firstName: 'Ada',
      lastName: '',
    })
    expect(merged.firstName).toBe('Ada')
    expect(merged.lastName).toBeUndefined()
  })

  it('maps the group name and description onto the tool param names', () => {
    const merged = merge({
      ...BASE,
      operation: 'okta_create_group',
      groupName: 'Engineering',
      groupDescription: 'Eng team',
    })
    expect(merged.name).toBe('Engineering')
    expect(merged.description).toBe('Eng team')
  })

  /**
   * The update tool declares `name` optional and its merge helper carries the
   * stored name through when the field is blank, so requiring it on the block
   * would block a description-only update the tool and the API both accept.
   * Create has no stored name to fall back on and still requires it.
   */
  it('requires the group name only when creating a group', () => {
    const groupName = OktaBlock.subBlocks.find((subBlock) => subBlock.id === 'groupName')

    expect(groupName?.condition).toEqual({
      field: 'operation',
      value: ['okta_create_group', 'okta_update_group'],
    })
    expect(groupName?.required).toEqual({ field: 'operation', value: ['okta_create_group'] })
  })

  it('keeps a false toggle, which is a real choice rather than a blank field', () => {
    const merged = merge({
      ...BASE,
      operation: 'okta_activate_user',
      userId: '00u1',
      sendEmail: false,
    })
    expect(merged.sendEmail).toBe(false)
  })
})

describe('Okta block outputs', () => {
  it('declares only fields a tool emits at the top level', () => {
    const declared = Object.keys(OktaBlock.outputs)
    expect(declared).not.toContain('targets')
    expect(declared).not.toContain('debugData')
    expect(declared).toContain('events')
  })
})
