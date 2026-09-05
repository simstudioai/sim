/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applications: vi.fn(),
  jobs: vi.fn(),
  files: vi.fn(),
  credential: vi.fn(),
  bundle: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-epm-enterprise-profitability/operations', () => ({
  listOracleEpcmApplications: mocks.applications,
  listOracleEpcmJobDefinitions: mocks.jobs,
}))
vi.mock('@/lib/internal/oracle-epm-enterprise-profitability/files.server', () => ({
  listOracleEpcmFiles: mocks.files,
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.credential }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import { buildSelectorContextFromValues } from '@/lib/selectors/context'
import { isSelectorReady } from '@/lib/selectors/manifest'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import {
  oracleEpcmSelectorAttachments,
  resolveOracleEpcmSelectorJobType,
} from '@/lib/selectors/server/providers/oracle-epm-enterprise-profitability'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { OracleEpcmBlock } from '@/blocks/blocks/oracle_epm_enterprise_profitability'

const auth = {
  oauthCredential: 'credential-1',
  accessToken: 'server-token',
  instanceUrl: 'https://epm.example.com/gateway',
}
function args(
  key: keyof typeof oracleEpcmSelectorAttachments = 'oracleEpm.applications'
): ExecuteServerSelectorArgs {
  return {
    selectorKey: key,
    context: {
      oauthCredential: 'credential-1',
      applicationName: 'Profitability',
      jobType: 'IMPORT_DATA',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: {
      suppliedId: 'credential-1',
      access: {
        ok: true,
        resolvedCredentialId: 'credential-1',
        credentialType: 'service_account',
        credentialOwnerUserId: 'user-1',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal: new AbortController().signal,
  }
}

describe('Oracle EPCM server selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credential.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'oracle-epm-service-account',
    })
    mocks.bundle.mockResolvedValue({ accessToken: auth.accessToken, instanceUrl: auth.instanceUrl })
    mocks.applications.mockResolvedValue([{ name: 'Profitability', untrusted: 'not projected' }])
    mocks.jobs.mockResolvedValue([{ jobName: 'Daily Load', jobType: 'IMPORT_DATA' }])
    mocks.files.mockResolvedValue([
      { name: 'data.csv', type: 'EXTERNAL', size: 123, lastModifiedTime: 0 },
    ])
  })
  it('binds to the Oracle EPM credential and projects safe stable application options', async () => {
    const request = args()
    expect(await oracleEpcmSelectorAttachments['oracleEpm.applications'].execute(request)).toEqual({
      kind: 'list',
      items: [{ id: 'Profitability', label: 'Profitability' }],
    })
    expect(mocks.credential).toHaveBeenCalledWith('credential-1')
    expect(mocks.applications).toHaveBeenCalledWith(auth, request.signal)
    expect(mocks.bundle).toHaveBeenCalledWith({
      credential: request.credential,
      protectedValues: request.protectedValues,
    })
  })
  it.each(['netsuite-service-account', 'google-drive', undefined])(
    'rejects non-EPM providers before minting or reading',
    async (providerId) => {
      mocks.credential.mockResolvedValue({ credentialType: 'service_account', providerId })
      await expect(
        oracleEpcmSelectorAttachments['oracleEpm.applications'].execute(args())
      ).rejects.toThrow()
      expect(mocks.bundle).not.toHaveBeenCalled()
      expect(mocks.applications).not.toHaveBeenCalled()
    }
  )
  it('rejects missing authorization instead of accepting a context token', async () => {
    await expect(
      oracleEpcmSelectorAttachments['oracleEpm.applications'].execute({
        ...args(),
        credential: undefined,
      })
    ).rejects.toThrow()
    expect(mocks.bundle).not.toHaveBeenCalled()
  })
  it('passes application and exchange-type dependencies to shared product discovery', async () => {
    const request = args('oracleEpm.jobDefinitions')
    request.context.jobType = 'oracle_epm_enterprise_profitability_import_data'
    expect(
      await oracleEpcmSelectorAttachments['oracleEpm.jobDefinitions'].execute(request)
    ).toEqual({
      kind: 'list',
      items: [{ id: 'Daily Load', label: 'Daily Load', meta: { jobType: 'IMPORT_DATA' } }],
    })
    expect(mocks.jobs).toHaveBeenCalledWith(
      { ...auth, applicationName: 'Profitability', jobType: 'IMPORT_DATA' },
      request.signal
    )
  })
  it('projects repository filenames and nullable size without remote links', async () => {
    const request = args('oracleEpm.repositoryFiles')
    expect(
      await oracleEpcmSelectorAttachments['oracleEpm.repositoryFiles'].execute(request)
    ).toEqual({ kind: 'list', items: [{ id: 'data.csv', label: 'data.csv', meta: { size: 123 } }] })
    expect(mocks.files).toHaveBeenCalledWith(auth, request.signal)
  })
  it('deduplicates, sorts, and resolves details only from the documented list', async () => {
    mocks.applications.mockResolvedValue([{ name: 'Z' }, { name: 'A' }, { name: 'A' }])
    const attachment = oracleEpcmSelectorAttachments['oracleEpm.applications']
    expect(await attachment.execute(args())).toEqual({
      kind: 'list',
      items: [
        { id: 'A', label: 'A' },
        { id: 'Z', label: 'Z' },
      ],
    })
    expect(await attachment.execute({ ...args(), request: { kind: 'detail', id: 'A' } })).toEqual({
      kind: 'detail',
      item: { id: 'A', label: 'A' },
    })
    expect(
      await attachment.execute({ ...args(), request: { kind: 'detail', id: 'Unknown' } })
    ).toEqual({ kind: 'detail', item: null })
    mocks.applications.mockResolvedValue([])
    expect(await attachment.execute(args())).toEqual({ kind: 'list', items: [] })
  })
  it('preserves safe provider failures and cancellation', async () => {
    mocks.applications.mockRejectedValue(oracleEpmLocalError('invalid_response'))
    await expect(
      oracleEpcmSelectorAttachments['oracleEpm.applications'].execute(args())
    ).rejects.toThrow()
    const request = args()
    request.signal = AbortSignal.abort()
    mocks.applications.mockClear()
    await expect(
      oracleEpcmSelectorAttachments['oracleEpm.applications'].execute(request)
    ).rejects.toThrow()
    expect(mocks.applications).not.toHaveBeenCalled()
  })
  it('requires dependencies and excludes calculations from the job selector', () => {
    expect(
      isSelectorReady('oracleEpm.jobDefinitions', { oauthCredential: 'c', applicationName: 'a' })
    ).toBe(false)
    expect(
      isSelectorReady('oracleEpm.jobDefinitions', {
        oauthCredential: 'c',
        applicationName: 'a',
        jobType: 'IMPORT_DATA',
      })
    ).toBe(true)
    expect(() => resolveOracleEpcmSelectorJobType('Calculation')).toThrow()
    expect(() =>
      resolveOracleEpcmSelectorJobType('oracle_epm_enterprise_profitability_calculate_model')
    ).toThrow()
  })
  it('projects canonical manual dependencies and the active operation alias', () => {
    const context = buildSelectorContextFromValues({
      selectorKey: 'oracleEpm.jobDefinitions',
      contextConfigs: OracleEpcmBlock.subBlocks,
      values: {
        operation: 'oracle_epm_enterprise_profitability_export_metadata',
        credential: 'old',
        manualCredential: 'current',
        applicationSelector: 'Old App',
        applicationManual: 'Current App',
      },
      canonicalModes: { oauthCredential: 'advanced', applicationName: 'advanced' },
      dependsOn: ['oauthCredential', 'applicationName', 'operation'],
    })
    expect(context).toEqual({
      oauthCredential: 'current',
      applicationName: 'Current App',
      jobType: 'oracle_epm_enterprise_profitability_export_metadata',
    })
  })
})
