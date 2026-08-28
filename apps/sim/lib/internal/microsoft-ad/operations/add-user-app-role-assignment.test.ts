/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAddUserAppRoleAssignmentOperation } from '@/lib/internal/microsoft-ad/operations/add-user-app-role-assignment'

const INPUT = {
  accessToken: 'access-token',
  userId: '11111111-1111-4111-8111-111111111111',
  resourceId: '22222222-2222-4222-8222-222222222222',
  appRoleId: '33333333-3333-4333-8333-333333333333',
}

describe('executeAddUserAppRoleAssignmentOperation', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('rejects malformed successful Graph JSON instead of fabricating a null assignment', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not-json'))

    await expect(executeAddUserAppRoleAssignmentOperation(INPUT)).rejects.toThrow(
      'Microsoft Graph returned malformed JSON for the app role assignment'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a successful non-object assignment payload', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(null))

    await expect(executeAddUserAppRoleAssignmentOperation(INPUT)).rejects.toThrow(
      'Microsoft Graph returned an invalid app role assignment'
    )
  })

  it('rejects a successful empty assignment payload', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}))

    await expect(executeAddUserAppRoleAssignmentOperation(INPUT)).rejects.toThrow(
      'Microsoft Graph returned an invalid app role assignment'
    )
  })
})
