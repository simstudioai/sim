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

import { environmentOperations as operations } from '@/lib/internal/oracle-epm-platform/operations/environment'

describe('Oracle EPM environment operations', () => {
  it.each([
    {
      name: 'get_environment_info',
      run: () => operations.get_environment_info(auth, context),
      method: 'GET',
      path: 'maintenance/getdailymaintenancestarttime?showTimeZone=true',
      response: {
        status: 0,
        items: [{ buildVersion: '26.09.01', amwTime: '02:00', timeZone: 'UTC' }],
      },
      output: {
        environments: [
          { buildVersion: '26.09.01', maintenanceStartTime: '02:00', timeZone: 'UTC' },
        ],
      },
    },
    {
      name: 'get_idle_session_timeout',
      run: () => operations.get_idle_session_timeout(auth, context),
      method: 'GET',
      path: 'config/services/idlesessiontimeout',
      response: { status: '0', items: [{ timeout: '30' }] },
      output: { timeoutMinutes: 30 },
    },
    {
      name: 'set_idle_session_timeout',
      run: () => operations.set_idle_session_timeout({ ...auth, timeoutMinutes: 45 }, context),
      method: 'PUT',
      path: 'config/services/idlesessiontimeout',
      body: { timeout: '45' },
    },
    {
      name: 'set_maintenance_window',
      run: () =>
        operations.set_maintenance_window(
          { ...auth, startTime: '03:00 America/Los_Angeles' },
          context
        ),
      method: 'PUT',
      path: 'maintenance/setdailymaintenancestarttime',
      body: { startTime: '03:00 America/Los_Angeles' },
    },
    {
      name: 'run_daily_maintenance',
      run: () => operations.run_daily_maintenance(auth, context),
      method: 'POST',
      path: 'maintenance/rundailymaintenance',
      body: { skipNext: 'false' },
      output: { completed: true },
    },
    {
      name: 'get_restricted_data_access',
      run: () => operations.get_restricted_data_access(auth, context),
      method: 'GET',
      path: 'config/services/restricteddataaccess',
      response: { status: 0, items: [{ dataAccessRestriction: 'false' }] },
      output: { enabled: false },
    },
    {
      name: 'set_restricted_data_access',
      run: () => operations.set_restricted_data_access({ ...auth, enabled: true }, context),
      method: 'PUT',
      path: 'config/services/restricteddataaccess',
      body: { dataAccessRestriction: 'true' },
    },
    {
      name: 'get_upload_virus_scan',
      run: () => operations.get_upload_virus_scan(auth, context),
      method: 'GET',
      path: 'config/services/virusscanonfileupload',
      response: { status: '0', items: [{ scanfiles: 'true' }] },
      output: { enabled: true },
    },
    {
      name: 'set_upload_virus_scan',
      run: () => operations.set_upload_virus_scan({ ...auth, enabled: false }, context),
      method: 'PUT',
      path: 'config/services/virusscanonfileupload',
      body: { scanfiles: 'false' },
    },
  ])(
    '$name maps the documented wire request and result',
    async ({ run, method, path, body, response, output }) => {
      mockSecureFetch.mockImplementation(async () => Response.json(response ?? { status: 0 }))
      expect(await run()).toMatchObject({ status: 0, ...output })
      expect(mockSecureFetch).toHaveBeenCalledWith(
        `https://epm.example.com/gateway/interop/rest/v2/${path}`,
        '203.0.113.10',
        expect.objectContaining({
          method,
          headers: expect.objectContaining({ Authorization: `Basic ${auth.accessToken}` }),
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
      )
    }
  )

  it('returns a serializable maintenance job without waiting', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: -1,
        links: [
          {
            rel: 'Job Status',
            action: 'GET',
            href: 'https://epm.example.com/gateway/interop/rest/v2/status/service/maintenancewindow/19',
          },
        ],
      })
    )
    const result = await operations.run_daily_maintenance({ ...auth, skipNext: true }, context)
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      status: -1,
      completed: false,
      jobId: '19',
      jobKind: 'maintenance',
    })
    expect(mockSecureFetch.mock.calls.map(([, , options]) => options.method)).toEqual(['POST'])
    expect(mockSecureFetch.mock.calls[0][2].body).toBe('{"skipNext":"true"}')
  })

  it('does not replay a maintenance mutation after an uncertain failure', async () => {
    mockSecureFetch.mockRejectedValue(new Error('socket reset'))
    await expect(operations.run_daily_maintenance(auth, context)).rejects.toThrow()
    expect(mockSecureFetch.mock.calls.map(([, , options]) => options.method)).toEqual(['POST'])
  })

  it('rejects malformed required fields and failed settings responses', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({ status: 0, items: [{ timeout: 'unknown' }] })
    )
    await expect(operations.get_idle_session_timeout(auth, context)).rejects.toThrow(
      'unexpected response'
    )
    mockSecureFetch.mockImplementation(async () =>
      Response.json({ status: 8, details: 'private provider error' })
    )
    await expect(
      operations.set_upload_virus_scan({ ...auth, enabled: true }, context)
    ).rejects.toThrow('status 8')
  })
})
