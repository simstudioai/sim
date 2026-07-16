/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { GitLabBlock } from './gitlab'

const block = GitLabBlock

describe('GitLabBlock access operations', () => {
  it('routes every access operation to its matching tool id without serialization-time coercion', () => {
    const accessOps = [
      'gitlab_list_members',
      'gitlab_add_member',
      'gitlab_update_member',
      'gitlab_remove_member',
      'gitlab_invite_member',
      'gitlab_approve_access_request',
      'gitlab_search_users',
      'gitlab_block_user',
      'gitlab_add_saml_group_link',
    ]
    for (const toolId of accessOps) {
      expect(block.tools.access).toContain(toolId)
      expect(block.tools.config.tool?.({ operation: toolId })).toBe(toolId)
    }
  })

  it('exposes the named access-level dropdown with GitLab integer ids', () => {
    const accessLevel = block.subBlocks.find((s) => s.id === 'accessLevel')
    expect(accessLevel?.type).toBe('dropdown')
    const options = typeof accessLevel?.options === 'function' ? undefined : accessLevel?.options
    expect(options?.map((o) => o.id)).toEqual(['0', '5', '10', '15', '20', '25', '30', '40', '50'])
    expect(accessLevel?.value?.()).toBe('30')
  })

  it('coerces the selected access level from the dropdown string to an integer at execution time', () => {
    const addParams = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_add_member',
      resourceType: 'group',
      resourceId: '42',
      userId: '7',
      accessLevel: '40',
      expiresAt: '2026-12-31',
      memberRoleId: '5',
    })
    expect(addParams).toMatchObject({
      resourceType: 'group',
      resourceId: '42',
      userId: 7,
      accessLevel: 40,
      expiresAt: '2026-12-31',
      memberRoleId: 5,
    })
    expect(typeof addParams?.accessLevel).toBe('number')
  })

  it('defaults list members to inherited members (directOnly falsy)', () => {
    const listParams = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_list_members',
      resourceType: 'project',
      resourceId: 'grp/proj',
    })
    expect(listParams).toMatchObject({ resourceType: 'project', resourceId: 'grp/proj' })
    expect(listParams?.directOnly).toBeUndefined()

    const directParams = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_list_members',
      resourceType: 'project',
      resourceId: 'grp/proj',
      directMembersOnly: true,
    })
    expect(directParams?.directOnly).toBe(true)
  })

  it('coerces the target user id for admin user actions', () => {
    const blockParams = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_block_user',
      userId: '99',
    })
    expect(blockParams).toMatchObject({ userId: 99 })
    expect(typeof blockParams?.userId).toBe('number')
  })

  it('optionally coerces the granted access level for approve access request', () => {
    const approveParams = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_approve_access_request',
      resourceType: 'group',
      resourceId: '42',
      userId: '7',
      accessLevel: '30',
    })
    expect(approveParams).toMatchObject({ userId: 7, accessLevel: 30 })
  })

  it('throws when required access fields are missing', () => {
    expect(() =>
      block.tools.config.params?.({
        accessToken: 'pat',
        operation: 'gitlab_add_member',
        resourceType: 'group',
        resourceId: '42',
      })
    ).toThrow()
  })
})
