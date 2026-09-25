import { describe, expect, it } from 'vitest'
import { GitLabBlock } from './gitlab'

const block = GitLabBlock

describe('GitLabBlock access operations', () => {
  it('coerces the selected access level from the combobox string to an integer at execution time', () => {
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

  it('accepts a runtime-resolved numeric 0 ("No access") on a required op', () => {
    // A reference can resolve to the number 0; a truthiness guard would wrongly
    // reject it as missing. It must pass and coerce to 0.
    const byZero = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_add_member',
      resourceType: 'group',
      resourceId: '42',
      userId: '7',
      accessLevel: 0,
    })
    expect(byZero).toMatchObject({ userId: 7, accessLevel: 0 })
    expect(byZero?.accessLevel).toBe(0)
  })

  it('sends a numeric 0 on optional ops instead of silently omitting it', () => {
    const approve = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_approve_access_request',
      resourceType: 'group',
      resourceId: '42',
      userId: '7',
      accessLevel: 0,
    })
    expect(approve?.accessLevel).toBe(0)

    const invite = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_update_invitation',
      resourceType: 'group',
      resourceId: '42',
      email: 'a@b.com',
      invitationAccessLevel: 0,
    })
    expect(invite?.accessLevel).toBe(0)
  })

  it('throws loudly when a resolved access level is not a valid GitLab level', () => {
    expect(() =>
      block.tools.config.params?.({
        accessToken: 'pat',
        operation: 'gitlab_add_member',
        resourceType: 'group',
        resourceId: '42',
        userId: '7',
        accessLevel: 'root',
      })
    ).toThrow(/access level/i)
  })

  it('sends admin:false so update user can demote an administrator', () => {
    const demote = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_update_user',
      userId: '9',
      userAdminIsAdmin: false,
    })
    expect(demote?.admin).toBe(false)

    // An untouched switch is undefined and must leave the admin flag unchanged.
    const untouched = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_update_user',
      userId: '9',
    })
    expect(untouched?.admin).toBeUndefined()
  })
})
