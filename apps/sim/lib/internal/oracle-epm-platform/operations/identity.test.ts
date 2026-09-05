/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'

const auth = {
  oauthCredential: 'service-account-id',
  instanceUrl: 'https://epm.example.com/gateway',
  accessToken: Buffer.from('operator:credential').toString('base64'),
}
const client = createOracleEpmClient(auth)
const context = { client }
beforeEach(() => {
  vi.clearAllMocks()
  mockValidateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  mockSecureFetch.mockImplementation(async () => Response.json({ status: 0 }))
})

import { identityOperations as operations } from '@/lib/internal/oracle-epm-platform/operations/identity'

const user = {
  userlogin: 'reader',
  firstname: 'Test',
  lastname: 'Reader',
  email: 'reader@example.com',
}
const users = [{ userlogin: 'reader' }]
const groups = [{ groupname: 'Reviewers' }]
const batch = {
  status: 0,
  error: null,
  details: { processed: 1, succeeded: 1, failed: 0, faileditems: null },
}
const createUsers = [
  {
    userlogin: 'reader',
    firstname: 'Test',
    lastname: 'Reader',
    email: 'reader@example.com',
    resetpassword: true,
    password: 'input-secret',
  },
]

describe('Oracle EPM identity operations', () => {
  it.each([
    {
      name: 'create_users',
      run: () => operations.create_users({ ...auth, users: createUsers }, context),
      method: 'POST',
      path: 'users/add',
      body: { users: createUsers },
    },
    {
      name: 'update_users',
      run: () =>
        operations.update_users(
          { ...auth, users: [{ userlogin: 'reader', lastname: 'Updated' }] },
          context
        ),
      method: 'PUT',
      path: 'users/update',
      body: { users: [{ userlogin: 'reader', lastname: 'Updated' }] },
    },
    {
      name: 'delete_users',
      run: () => operations.delete_users({ ...auth, users }, context),
      method: 'POST',
      path: 'users/remove',
      body: { users },
    },
    {
      name: 'create_groups',
      run: () =>
        operations.create_groups(
          { ...auth, groups: [{ ...groups[0], members: { users } }] },
          context
        ),
      method: 'POST',
      path: 'groups/add',
      body: { groups: [{ ...groups[0], members: { users } }] },
    },
    {
      name: 'delete_groups',
      run: () => operations.delete_groups({ ...auth, groups }, context),
      method: 'POST',
      path: 'groups/remove',
      body: { groups },
    },
    {
      name: 'add_users_to_group',
      run: () => operations.add_users_to_group({ ...auth, groupname: 'Reviewers', users }, context),
      method: 'PUT',
      path: 'groups/adduserstogroup',
      body: { groupname: 'Reviewers', users },
    },
    {
      name: 'remove_users_from_group',
      run: () =>
        operations.remove_users_from_group({ ...auth, groupname: 'Reviewers', users }, context),
      method: 'PUT',
      path: 'groups/removeusersfromgroup',
      body: { groupname: 'Reviewers', users },
    },
    {
      name: 'assign_role',
      run: () =>
        operations.assign_role({ ...auth, rolename: 'Access Control - View', users }, context),
      method: 'PUT',
      path: 'role/assign/user',
      body: { rolename: 'Access Control - View', users },
    },
    {
      name: 'unassign_role',
      run: () =>
        operations.unassign_role({ ...auth, rolename: 'Access Control - View', users }, context),
      method: 'PUT',
      path: 'role/unassign/user',
      body: { rolename: 'Access Control - View', users },
    },
  ])('$name sends only the documented mutation body', async ({ run, method, path, body }) => {
    mockSecureFetch.mockImplementation(async () => Response.json(batch))
    const output = await run()
    expect(output).toMatchObject({
      status: 0,
      processed: 1,
      succeeded: 1,
      failed: 0,
      partialFailure: false,
      failedItems: [],
    })
    expect(JSON.stringify(output)).not.toContain('input-secret')
    expect(mockSecureFetch).toHaveBeenCalledWith(
      `https://epm.example.com/gateway/interop/rest/security/v2/${path}`,
      '203.0.113.10',
      expect.objectContaining({ method, body: JSON.stringify(body) })
    )
  })

  it.each([
    {
      name: 'list_users',
      run: () =>
        operations.list_users(
          { ...auth, userlogin: 'reader', epmgroups: true, indirect: false },
          context
        ),
      method: 'POST',
      path: 'v1/users/list',
      body: { userlogin: 'reader', epmgroups: true, indirect: false },
      details: [{ ...user, epmgroups: [{ groupname: 'Reviewers', description: '', type: 'EPM' }] }],
      key: 'users',
    },
    {
      name: 'list_groups',
      run: () =>
        operations.list_groups(
          { ...auth, groupname: 'Reviewers', members: true, roles: true },
          context
        ),
      method: 'POST',
      path: 'v1/groups/list',
      body: { groupname: 'Reviewers', members: true, roles: true },
      details: [
        {
          groupname: 'Reviewers',
          description: '',
          type: 'EPM',
          identity: 'g1',
          members: { users: [user], groups: [] },
          roles: [{ rolename: 'User', id: 'r1' }],
        },
      ],
      key: 'groups',
    },
    {
      name: 'list_roles',
      run: () => operations.list_roles({ ...auth, type: 'granular' }, context),
      method: 'GET',
      path: 'v2/role/getavailableroles?type=granular',
      details: [{ name: 'Access Control - View', id: 'tenant-role-id' }],
      key: 'roles',
    },
    {
      name: 'get_role_assignments',
      run: () =>
        operations.get_role_assignments(
          { ...auth, userlogin: 'reader', rolename: 'Power User' },
          context
        ),
      method: 'GET',
      path: 'v2/report/roleassignmentreport/user?userlogin=reader&rolename=Power+User',
      details: [
        {
          ...user,
          roles: [{ rolename: 'Power User', roletype: 'APPLICATION', grantedthroughgroup: '' }],
        },
      ],
      key: 'assignments',
    },
  ])(
    '$name preserves documented details and filters',
    async ({ run, method, path, body, details, key }) => {
      mockSecureFetch.mockImplementation(async () => Response.json({ status: 0, details }))
      expect(await run()).toMatchObject({ status: 0, [key]: details })
      expect(mockSecureFetch).toHaveBeenCalledWith(
        `https://epm.example.com/gateway/interop/rest/security/${path}`,
        '203.0.113.10',
        expect.objectContaining({ method, ...(body ? { body: JSON.stringify(body) } : {}) })
      )
    }
  )

  it('get_user_group_report decodes direct membership, including indirect membership', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: 0,
        details: [
          {
            ...user,
            groups: [
              { groupname: 'Reviewers', direct: 'Yes' },
              { groupname: 'All', direct: 'No' },
            ],
          },
        ],
      })
    )
    const result = await operations.get_user_group_report(
      { ...auth, groupname: 'Reviewers', userattribute: 'reader@example.com' },
      context
    )
    expect(result.users[0].groups).toEqual([
      { groupname: 'Reviewers', direct: true },
      { groupname: 'All', direct: false },
    ])
    expect(mockSecureFetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/security/v2/report/usergroupreport?groupname=Reviewers&userattribute=reader%40example.com'
    )
  })

  it('preserves item failures despite successful HTTP and outer status, without password echoes', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: 0,
        error: null,
        details: {
          processed: 2,
          succeeded: 1,
          failed: 1,
          faileditems: [
            {
              userlogin: 'reader',
              errorcode: 'EPMCSS-21001',
              errormessage: 'input-secret was rejected',
              password: 'input-secret',
            },
          ],
        },
      })
    )
    const result = await operations.create_users({ ...auth, users: createUsers }, context)
    expect(result).toMatchObject({
      status: 0,
      partialFailure: true,
      failed: 1,
      failedItems: [{ userlogin: 'reader', errorcode: 'EPMCSS-21001' }],
    })
    expect(JSON.stringify(result)).not.toContain('input-secret')
  })

  it('returns a documented whole-request failure rather than a false empty success', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: 1,
        error: { errorcode: 'EPMCSS-21001', errormessage: 'private echo' },
        details: null,
      })
    )
    expect(await operations.delete_users({ ...auth, users }, context)).toMatchObject({
      status: 1,
      processed: null,
      failed: null,
      errorCode: 'EPMCSS-21001',
    })
  })

  it('does not replay identity writes after a network failure', async () => {
    mockSecureFetch.mockRejectedValue(new Error('uncertain write'))
    await expect(
      operations.create_users({ ...auth, users: createUsers }, context)
    ).rejects.toThrow()
    expect(mockSecureFetch.mock.calls.map(([, , options]) => options.method)).toEqual(['POST'])
  })

  it('rejects malformed nested expansions instead of exposing unknown JSON', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({ status: 0, details: [{ ...user, applicationroles: [{ unknown: 'role' }] }] })
    )
    await expect(operations.list_users(auth, context)).rejects.toThrow('unexpected response')
  })
})
