/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  resolveCredential: vi.fn(),
  listLibraryArtifacts: vi.fn(),
  getLibraryArtifact: vi.fn(),
  createLibraryFolder: vi.fn(),
  createLibraryFile: vi.fn(),
  deleteLibraryArtifact: vi.fn(),
  listReports: vi.fn(),
  getReport: vi.fn(),
  getReportGlobalPov: vi.fn(),
  getReportPrompts: vi.fn(),
  downloadReportOutput: vi.fn(),
  listBooks: vi.fn(),
  getBook: vi.fn(),
  getBookGlobalPov: vi.fn(),
  downloadBookOutput: vi.fn(),
  listReportSnapshots: vi.fn(),
  getReportSnapshot: vi.fn(),
  createReportSnapshot: vi.fn(),
  downloadReportSnapshotOutput: vi.fn(),
  getReportPackage: vi.fn(),
  refreshReportPackageDataSources: vi.fn(),
  getJob: vi.fn(),
  waitForJob: vi.fn(),
  exportLibraryArtifact: vi.fn(),
  importLibraryArtifact: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-epm/client.server', () => ({
  createOracleEpmClient: mocks.createClient,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: mocks.resolveCredential,
}))
vi.mock('@/lib/internal/oracle-epm-narrative-reporting/operations', () => mocks)

import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import { executeOracleEpmNarrativeReportingTool } from '@/lib/internal/oracle-epm-narrative-reporting/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://epm.example.com',
}
function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oracle_epm_narrative_reporting_get_report',
    input: { ...auth, resourceId: 'r' },
    context: { workflowId: 'trusted-workflow', userId: 'trusted-user' },
    headers: new Headers(),
    requestId: 'request',
    ...overrides,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveCredential.mockResolvedValue({
    credentialType: 'service_account',
    providerId: 'oracle-epm-service-account',
  })
  mocks.createClient.mockReturnValue({ request: vi.fn() })
  for (const name of [
    'listLibraryArtifacts',
    'getLibraryArtifact',
    'createLibraryFolder',
    'createLibraryFile',
    'deleteLibraryArtifact',
    'listReports',
    'getReport',
    'getReportGlobalPov',
    'getReportPrompts',
    'downloadReportOutput',
    'listBooks',
    'getBook',
    'getBookGlobalPov',
    'downloadBookOutput',
    'listReportSnapshots',
    'getReportSnapshot',
    'createReportSnapshot',
    'downloadReportSnapshotOutput',
    'getReportPackage',
    'refreshReportPackageDataSources',
    'getJob',
    'waitForJob',
    'exportLibraryArtifact',
    'importLibraryArtifact',
  ] as const)
    mocks[name].mockResolvedValue({ success: true, output: { handled: true } })
})
describe('Narrative Reporting dispatcher', () => {
  it.each([
    'oracle_epm_narrative_reporting_download_report_output',
    'oracle_epm_narrative_reporting_download_report_snapshot_output',
  ])('rejects non-PDF input before credentials or I/O for %s', async (toolId) => {
    const response = await executeOracleEpmNarrativeReportingTool(
      call({ toolId, input: { ...auth, resourceId: 'report', format: 'xlsx' } })
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      details: [expect.objectContaining({ path: ['format'] })],
    })
    expect(mocks.resolveCredential).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.downloadReportOutput).not.toHaveBeenCalled()
    expect(mocks.downloadReportSnapshotOutput).not.toHaveBeenCalled()
  })
  it('keeps documented XLSX output available for books', async () => {
    const response = await executeOracleEpmNarrativeReportingTool(
      call({
        toolId: 'oracle_epm_narrative_reporting_download_book_output',
        input: { ...auth, resourceId: 'book', format: 'xlsx' },
      })
    )
    expect(response.status).toBe(200)
    expect(mocks.downloadBookOutput).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'xlsx' }),
      expect.any(Object)
    )
  })
  it('uses trusted context and strips undeclared ownership, headers and endpoint inputs', async () => {
    const request = call({
      input: {
        ...auth,
        resourceId: 'r',
        userId: 'attacker',
        workspaceId: 'attacker',
        endpoint: 'https://attacker.example',
        headers: { Authorization: 'attacker' },
      },
    })
    expect((await executeOracleEpmNarrativeReportingTool(request)).status).toBe(200)
    expect(mocks.getReport).toHaveBeenCalledExactlyOnceWith(
      { ...auth, resourceId: 'r' },
      { client: expect.any(Object), execution: request.context, signal: undefined }
    )
    expect(mocks.createClient).toHaveBeenCalledWith(auth)
  })
  it('rejects missing credentials and invalid input before credential, network or storage work', async () => {
    expect(
      (await executeOracleEpmNarrativeReportingTool(call({ input: { resourceId: 'r' } }))).status
    ).toBe(401)
    expect(
      (await executeOracleEpmNarrativeReportingTool(call({ input: { ...auth, resourceId: '' } })))
        .status
    ).toBe(400)
    expect(mocks.resolveCredential).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it.each([
    null,
    { credentialType: 'oauth', providerId: 'oracle-epm-service-account' },
    { credentialType: 'service_account', providerId: 'netsuite-service-account' },
  ])('rejects a missing or wrong provider credential', async (credential) => {
    mocks.resolveCredential.mockResolvedValue(credential)
    expect((await executeOracleEpmNarrativeReportingTool(call())).status).toBe(403)
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.getReport).not.toHaveBeenCalled()
  })
  it('preserves abort before any work and after credential lookup', async () => {
    const controller = new AbortController()
    mocks.resolveCredential.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return { credentialType: 'service_account', providerId: 'oracle-epm-service-account' }
    })
    await expect(
      executeOracleEpmNarrativeReportingTool(call({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.createClient).not.toHaveBeenCalled()
    await expect(
      executeOracleEpmNarrativeReportingTool(call({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.resolveCredential).toHaveBeenCalledTimes(1)
  })
  it('does not reflect provider errors, credentials or failed operation values', async () => {
    mocks.getReport.mockRejectedValueOnce(new Error('secret token raw provider response'))
    const response = await executeOracleEpmNarrativeReportingTool(call())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Narrative Reporting operation failed',
    })
    mocks.getReport.mockRejectedValueOnce(oracleEpmLocalError('payload_too_large'))
    expect((await executeOracleEpmNarrativeReportingTool(call())).status).toBe(413)
  })
  it.each([
    'oracle_epm_narrative_reporting_list_report_packages',
    'oracle_epm_narrative_reporting_upload_temporary_file',
    '__proto__',
  ])('does not expose contract-gated or inherited operation %s', async (toolId) => {
    expect((await executeOracleEpmNarrativeReportingTool(call({ toolId }))).status).toBe(400)
    expect(mocks.resolveCredential).not.toHaveBeenCalled()
  })
})
