/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ files: vi.fn(), credential: vi.fn(), bundle: vi.fn() }))
vi.mock('@/lib/internal/oracle-epm-profitability/files.server', () => ({
  listOraclePcmFiles: mocks.files,
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
import { isSelectorReady } from '@/lib/selectors/manifest'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oraclePcmSelectorAttachments } from '@/lib/selectors/server/providers/oracle-epm-profitability'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const auth = {
  oauthCredential: 'credential-1',
  accessToken: 'server-token',
  instanceUrl: 'https://epm.example.com/gateway',
}
function args(
  key: keyof typeof oraclePcmSelectorAttachments = 'oracleEpmPcm.inputFiles'
): ExecuteServerSelectorArgs {
  return {
    selectorKey: key,
    context: { oauthCredential: 'credential-1' },
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

describe('Oracle PCM repository selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credential.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'oracle-epm-service-account',
    })
    mocks.bundle.mockResolvedValue({ accessToken: auth.accessToken, instanceUrl: auth.instanceUrl })
    mocks.files.mockResolvedValue([
      { name: 'profitinbox/data.csv', size: 123, untrusted: 'not projected' },
      { name: 'profitinbox/nested/data.csv', size: 123 },
      { name: 'profitoutbox/report.csv ', size: null },
      { name: 'profitoutbox/report.csv ', size: null },
      { name: `profitoutbox/${'é'.repeat(123)}.csv`, size: 123 },
    ])
  })

  it('binds input files to credential authority and returns usable bare filenames', async () => {
    const request = args()
    expect(
      await oraclePcmSelectorAttachments[request.selectorKey as 'oracleEpmPcm.inputFiles'].execute(
        request
      )
    ).toEqual({
      kind: 'list',
      items: [{ id: 'data.csv', label: 'data.csv', meta: { size: 123 } }],
    })
    expect(mocks.credential).toHaveBeenCalledWith('credential-1')
    expect(mocks.files).toHaveBeenCalledWith(auth, request.signal)
    expect(mocks.bundle).toHaveBeenCalledWith({
      credential: request.credential,
      protectedValues: request.protectedValues,
    })
  })

  it('returns exact outbox paths without links, duplicates, or unusable long names', async () => {
    expect(
      await oraclePcmSelectorAttachments['oracleEpmPcm.outputFiles'].execute(
        args('oracleEpmPcm.outputFiles')
      )
    ).toEqual({
      kind: 'list',
      items: [{ id: 'profitoutbox/report.csv ', label: 'report.csv ', meta: { size: null } }],
    })
  })

  it.each(['netsuite-service-account', 'google-drive', undefined])(
    'rejects non-EPM provider %s before credential minting or remote discovery',
    async (providerId) => {
      mocks.credential.mockResolvedValue({ credentialType: 'service_account', providerId })
      await expect(
        oraclePcmSelectorAttachments['oracleEpmPcm.inputFiles'].execute(args())
      ).rejects.toThrow()
      expect(mocks.bundle).not.toHaveBeenCalled()
      expect(mocks.files).not.toHaveBeenCalled()
    }
  )

  it('requires authorized credentials and a credential-owned destination', async () => {
    const attachment = oraclePcmSelectorAttachments['oracleEpmPcm.inputFiles']
    await expect(attachment.execute({ ...args(), credential: undefined })).rejects.toThrow()
    expect(mocks.bundle).not.toHaveBeenCalled()
    mocks.bundle.mockResolvedValue({ accessToken: 'server-token' })
    await expect(attachment.execute(args())).rejects.toThrow()
    expect(mocks.files).not.toHaveBeenCalled()
  })

  it('resolves details only from the same filtered list', async () => {
    const attachment = oraclePcmSelectorAttachments['oracleEpmPcm.inputFiles']
    expect(
      await attachment.execute({ ...args(), request: { kind: 'detail', id: 'data.csv' } })
    ).toEqual({
      kind: 'detail',
      item: { id: 'data.csv', label: 'data.csv', meta: { size: 123 } },
    })
    expect(
      await attachment.execute({ ...args(), request: { kind: 'detail', id: 'report.csv' } })
    ).toEqual({
      kind: 'detail',
      item: null,
    })
    mocks.files.mockResolvedValue([])
    expect(await attachment.execute(args())).toEqual({ kind: 'list', items: [] })
  })

  it('preserves safe failures and cancellation', async () => {
    const attachment = oraclePcmSelectorAttachments['oracleEpmPcm.inputFiles']
    mocks.files.mockRejectedValue(oracleEpmLocalError('invalid_response'))
    await expect(attachment.execute(args())).rejects.toThrow()
    mocks.files.mockClear()
    await expect(attachment.execute({ ...args(), signal: AbortSignal.abort() })).rejects.toThrow()
    expect(mocks.files).not.toHaveBeenCalled()
  })

  it.each(['oracleEpmPcm.inputFiles', 'oracleEpmPcm.outputFiles'] as const)(
    '%s requires only the shared credential, without speculative discovery inputs',
    (key) => {
      expect(isSelectorReady(key, {})).toBe(false)
      expect(isSelectorReady(key, { oauthCredential: 'credential-1' })).toBe(true)
    }
  )
})
