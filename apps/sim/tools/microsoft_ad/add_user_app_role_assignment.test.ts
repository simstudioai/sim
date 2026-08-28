/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAddUserAppRoleAssignmentOperation } from '@/lib/internal/microsoft-ad/operations/add-user-app-role-assignment'

const OBJECT_ID = 'cde330e5-2150-4c11-9c5b-14bfdc948c79'
const RESOURCE_ID = '8e881353-1735-45af-af21-ee1344582a4d'
const APP_ROLE_ID = '00000000-0000-0000-0000-000000000000'
const UPN = 'jdoe@contoso.com'

const run = executeAddUserAppRoleAssignmentOperation

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as Response
}

describe('addUserAppRoleAssignmentTool principalId', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * `appRoleAssignment.principalId` is an `Edm.Guid`, so the userPrincipalName the User ID field
   * advertises has to be resolved before it reaches the body — the path segment accepting a UPN
   * says nothing about the body.
   * @see https://learn.microsoft.com/en-us/graph/api/resources/approleassignment
   */
  it('resolves a user principal name to an object ID before sending principalId', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: OBJECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ id: 'assignment-1', principalId: OBJECT_ID }))

    const result = await run(
      {
        accessToken: 'token',
        userId: UPN,
        resourceId: RESOURCE_ID,
        appRoleId: APP_ROLE_ID,
      },
      undefined
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [lookupUrl] = fetchMock.mock.calls[0]
    expect(lookupUrl).toBe(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(UPN)}?$select=id`
    )

    const [grantUrl, grantInit] = fetchMock.mock.calls[1]
    expect(grantUrl).toBe(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(UPN)}/appRoleAssignments`
    )
    const sent = JSON.parse(grantInit.body as string)
    expect(sent.principalId).toBe(OBJECT_ID)
    expect(sent.principalId).not.toBe(UPN)
    expect(sent).toEqual({
      principalId: OBJECT_ID,
      resourceId: RESOURCE_ID,
      appRoleId: APP_ROLE_ID,
    })
    expect(result.success).toBe(true)
    expect(result.output.assignment.id).toBe('assignment-1')
  })

  it('sends an object ID straight through without a lookup round trip', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'assignment-2', principalId: OBJECT_ID }))

    await run(
      {
        accessToken: 'token',
        userId: OBJECT_ID,
        resourceId: RESOURCE_ID,
        appRoleId: APP_ROLE_ID,
      },
      undefined
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [grantUrl, grantInit] = fetchMock.mock.calls[0]
    expect(grantUrl).toContain('/appRoleAssignments')
    expect(JSON.parse(grantInit.body as string).principalId).toBe(OBJECT_ID)
  })

  it("surfaces Graph's nested error message when the lookup fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'Request_ResourceNotFound', message: 'Resource does not exist.' } },
        { ok: false, status: 404 }
      )
    )

    await expect(
      run(
        {
          accessToken: 'token',
          userId: 'nobody@contoso.com',
          resourceId: RESOURCE_ID,
          appRoleId: APP_ROLE_ID,
        },
        undefined
      )
    ).rejects.toThrow('Resource does not exist.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces the grant failure message rather than a bare status', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: OBJECT_ID }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'Request_BadRequest', message: 'Invalid value specified.' } },
          { ok: false, status: 400 }
        )
      )

    await expect(
      run(
        { accessToken: 'token', userId: UPN, resourceId: RESOURCE_ID, appRoleId: APP_ROLE_ID },
        undefined
      )
    ).rejects.toThrow('Invalid value specified.')
  })

  it('does not turn an aborted response-body read into a successful assignment', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        controller.abort(new DOMException('cancelled', 'AbortError'))
        throw controller.signal.reason
      },
    } as Response)

    await expect(
      run(
        {
          accessToken: 'token',
          userId: OBJECT_ID,
          resourceId: RESOURCE_ID,
          appRoleId: APP_ROLE_ID,
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
