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

const credentials = vi.hoisted(() => ({
  resolve: vi.fn(),
  verifyFileAccess: vi.fn(),
  readFile: vi.fn(),
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: credentials.resolve }))
vi.mock('@/app/api/files/authorization', () => ({ verifyFileAccess: credentials.verifyFileAccess }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: credentials.readFile,
  createMultipartUpload: vi.fn(),
  deleteFile: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
}))

import { executeOracleEpmPlatformTool } from '@/lib/internal/oracle-epm-platform/execute-tool'

beforeEach(() => {
  credentials.resolve.mockResolvedValue({
    credentialType: 'service_account',
    providerId: 'oracle-epm-service-account',
  })
})
function execute(operation: string, input: unknown = auth, signal?: AbortSignal) {
  return executeOracleEpmPlatformTool({
    toolId: `oracle_epm_platform_${operation}`,
    input,
    headers: new Headers(),
    context: { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' },
    requestId: 'request-1',
    signal,
  })
}
describe('Oracle EPM Platform in-process execution', () => {
  it('dispatches a valid operation through the guarded foundation client', async () => {
    mockSecureFetch.mockImplementation(async () => Response.json({ status: 0, items: [] }))
    const response = await execute('list_files')
    expect(await response.json()).toMatchObject({
      success: true,
      output: { status: 0, files: [] },
      retryable: false,
    })
    expect(credentials.resolve).toHaveBeenCalledWith(auth.oauthCredential)
    expect(mockSecureFetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/v2/files/list'
    )
  })

  it.each([
    null,
    { credentialType: 'oauth', providerId: 'oracle-epm-service-account' },
    { credentialType: 'service_account', providerId: 'netsuite-service-account' },
  ])(
    'rejects a mismatched credential before destination creation or file access',
    async (credential) => {
      credentials.resolve.mockResolvedValue(credential)
      const response = await execute('upload_snapshot', {
        ...auth,
        snapshotName: 'new.zip',
        file: {
          id: 'f',
          key: 'workspace/f',
          context: 'workspace',
          size: 1,
          name: 'new.zip',
          type: 'application/zip',
          url: '',
        },
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ success: false, retryable: false })
      expect(mockValidateUrl).not.toHaveBeenCalled()
      expect(mockSecureFetch).not.toHaveBeenCalled()
      expect(credentials.verifyFileAccess).not.toHaveBeenCalled()
      expect(credentials.readFile).not.toHaveBeenCalled()
    }
  )

  it.each(['unknown', 'constructor', '__proto__'])(
    'rejects unsupported operation %s',
    async (operation) => {
      expect((await execute(operation)).status).toBe(400)
      expect(credentials.resolve).not.toHaveBeenCalled()
      expect(mockSecureFetch).not.toHaveBeenCalled()
    }
  )

  it.each([
    { operation: 'set_idle_session_timeout', input: { timeoutMinutes: '30' } },
    { operation: 'set_idle_session_timeout', input: { timeoutMinutes: 481 } },
    {
      operation: 'get_admin_job_status',
      input: { jobKind: 'migration', jobId: 'https://untrusted.example/status' },
    },
    { operation: 'get_admin_job_status', input: { jobKind: 'planning', jobId: '12' } },
    { operation: 'delete_file', input: { fileName: '../other' } },
    { operation: 'create_users', input: { users: [{ userlogin: 'u', password: 'input-secret' }] } },
    { operation: 'update_users', input: { users: [{ userlogin: 'u', password: 'input-secret' }] } },
    {
      operation: 'import_snapshot',
      input: { snapshotName: 'Snapshot', userPassword: 'input-secret', importUsers: false },
    },
  ])('rejects invalid $operation input without exposing it', async ({ operation, input }) => {
    const response = await execute(operation, { ...auth, ...input })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Invalid Oracle EPM Platform input',
      retryable: false,
    })
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('reports identity partial failure as tool failure while retaining structured item results', async () => {
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
              userlogin: 'missing',
              errorcode: 'EPMCSS-21001',
              errormessage: 'private-password-echo',
            },
          ],
        },
      })
    )
    const response = await execute('delete_users', {
      ...auth,
      users: [{ userlogin: 'missing' }, { userlogin: 'present' }],
    })
    const result = await response.json()
    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: { status: 0, partialFailure: true, failed: 1 },
    })
    expect(JSON.stringify(result)).not.toContain('private-password-echo')
  })

  it('does not call an in-progress job a failure, but reports terminal failure', async () => {
    mockSecureFetch.mockImplementation(async () => Response.json({ status: -1 }))
    expect(
      await (
        await execute('get_admin_job_status', { ...auth, jobId: '12', jobKind: 'migration' })
      ).json()
    ).toMatchObject({
      success: true,
      output: { completed: false },
    })
    mockSecureFetch.mockImplementation(async () => Response.json({ status: 7 }))
    expect(
      await (
        await execute('get_admin_job_status', { ...auth, jobId: '12', jobKind: 'migration' })
      ).json()
    ).toMatchObject({
      success: false,
      retryable: false,
      output: { status: 7, completed: true },
    })
  })

  it('keeps arbitrary provider and credential-service error text outside tool results', async () => {
    credentials.resolve.mockRejectedValue(new Error('credential-private-echo'))
    const response = await execute('list_files')
    expect(response.status).toBe(500)
    const result = await response.json()
    expect(result.retryable).toBe(false)
    expect(JSON.stringify(result)).not.toContain('credential-private-echo')
  })

  it('propagates cancellation before credential or network work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    await expect(execute('list_files', auth, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(credentials.resolve).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })
})
