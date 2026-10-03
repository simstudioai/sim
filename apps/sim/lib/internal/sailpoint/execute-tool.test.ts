import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

import { clearSailPointTokenStateForTests } from '@/lib/internal/sailpoint/client'
import { executeSailPointTool } from '@/lib/internal/sailpoint/execute-tool'
import { MAX_SAILPOINT_CSV_BYTES } from '@/lib/internal/sailpoint/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns

const mockFetch = vi.fn<typeof fetch>()
const credentials = { clientId: 'client', clientSecret: 'secret', tenant: 'acme' }

function tokenResponse(): Response {
  return Response.json({ access_token: 'token', expires_in: 3600 })
}

function request(operation: string, input: Record<string, unknown>, userId?: string) {
  return executeSailPointTool({
    toolId: operation,
    input: { ...credentials, operation, ...input },
    headers: new Headers(),
    context: { workflowId: 'workflow', userId },
    requestId: 'request-id',
  })
}

describe('SailPoint internal tool handler', () => {
  beforeEach(() => {
    clearSailPointTokenStateForTests()
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    mockAssertToolFileAccess.mockReset().mockResolvedValue(null)
    mockProcessFilesToUserFiles.mockReset()
    mockDownloadServableFileFromStorage.mockReset()
  })

  it.each(['sailpoint_request_access', 'sailpoint_get_account_selections'])(
    'enforces the nested entitlement cap at the %s handler boundary',
    async (operation) => {
      const response = await request(operation, {
        requestType: 'MODIFY_ACCESS',
        requestedForWithRequestedItems: [
          {
            identityId: 'identity',
            identityType: 'HUMAN',
            requestedItems: Array.from({ length: 26 }, (_, index) => ({
              type: 'ENTITLEMENT',
              id: `entitlement-${index}`,
            })),
          },
        ],
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('rejects mismatched tool and input operation before making a provider call', async () => {
    const response = await executeSailPointTool({
      toolId: 'sailpoint_get_identity',
      input: { ...credentials, operation: 'sailpoint_get_account', id: 'id' },
      headers: new Headers(),
      context: { workflowId: 'workflow' },
      requestId: 'request-id',
    })
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps an oversized stored CSV to a bounded validation error', async () => {
    mockProcessFilesToUserFiles.mockReturnValue([
      { key: 'workspace/file.csv', name: 'file.csv', type: 'text/csv' },
    ])
    mockDownloadServableFileFromStorage.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'SailPoint CSV',
        maxBytes: MAX_SAILPOINT_CSV_BYTES,
        observedBytes: MAX_SAILPOINT_CSV_BYTES + 1,
      })
    )
    const response = await request(
      'sailpoint_load_accounts',
      { sourceId: 'source', file: { key: 'file', name: 'file.csv', size: 7 } },
      'user'
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'SailPoint CSV file exceeds the 25 MiB limit',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('allows actorless provider calls but rejects stored-file loads without an actor', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ id: 'identity' }))
    const providerResponse = await request('sailpoint_get_identity', { id: 'identity' })
    expect(providerResponse.status).toBe(200)

    clearSailPointTokenStateForTests()
    mockFetch.mockReset()
    const fileResponse = await request('sailpoint_load_accounts', {
      sourceId: 'source',
      file: { key: 'file', name: 'file.csv', size: 7 },
    })
    expect(fileResponse.status).toBe(401)
    expect(mockProcessFilesToUserFiles).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
