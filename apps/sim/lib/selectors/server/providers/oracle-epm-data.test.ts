/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connections: vi.fn(),
  files: vi.fn(),
  pov: vi.fn(),
  account: vi.fn(),
  bundle: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-epm-data/operations/list-connections', () => ({
  executeOracleEpmDataListConnectionsOperation: mocks.connections,
}))
vi.mock('@/lib/internal/oracle-epm-data/operations/list-files', () => ({
  executeOracleEpmDataListFilesOperation: mocks.files,
}))
vi.mock('@/lib/internal/oracle-epm-data/operations/get-pov-status', () => ({
  executeOracleEpmDataGetPovStatusOperation: mocks.pov,
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.account }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))

import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleEpmDataSelectorAttachments as attachments } from '@/lib/selectors/server/providers/oracle-epm-data'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'server-token',
  instanceUrl: 'https://epm.example.com/gateway',
}
function args(
  selectorKey: ExecuteServerSelectorArgs['selectorKey'] = 'oracle_epm_data.connections'
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: {},
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace' },
    workspaceId: 'workspace',
    principal: { kind: 'session', userId: 'user', sessionId: 'session' },
    requesterUserId: 'user',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    credential: {
      suppliedId: 'credential',
      access: {
        ok: true,
        resolvedCredentialId: 'credential',
        credentialOwnerUserId: 'owner',
        credentialType: 'service_account',
      },
    },
  }
}
describe('Data Integration server selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.account.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'oracle-epm-service-account',
    })
    mocks.bundle.mockResolvedValue({ accessToken: auth.accessToken, instanceUrl: auth.instanceUrl })
    mocks.connections.mockResolvedValue({ success: true, output: { connections: [] } })
  })

  it('binds all selectors to this block and the existing service-account provider', async () => {
    for (const attachment of Object.values(attachments)) {
      expect(attachment.credential).toEqual({
        kind: 'stored',
        field: 'oauthCredential',
        serviceIds: ['oracle-epm-data'],
      })
      expect(attachment.integrationBlockTypes).toEqual(['oracle_epm_data'])
      expect(attachment.destination).toMatchObject({ kind: 'credential-bound' })
    }
    await attachments['oracle_epm_data.connections'].execute(args())
    expect(mocks.connections).toHaveBeenCalledWith(auth, undefined)
    expect(mocks.account).toHaveBeenCalledWith('credential')
  })

  it('rejects wrong credential kinds/providers and missing authoritative destination', async () => {
    const attachment = attachments['oracle_epm_data.connections']
    await expect(attachment.execute({ ...args(), credential: undefined })).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    mocks.account.mockResolvedValueOnce({
      credentialType: 'service_account',
      providerId: 'netsuite-service-account',
    })
    await expect(attachment.execute(args())).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    mocks.bundle.mockResolvedValueOnce({ accessToken: 'server-token' })
    await expect(attachment.execute(args())).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    expect(mocks.connections).not.toHaveBeenCalled()
  })

  it('projects only connection names, deduplicates and supports selected-item detail', async () => {
    mocks.connections.mockResolvedValue({
      success: true,
      output: {
        connections: [
          { connectionName: 'Zulu', refUrl: 'https://do-not-fetch.example.com/secret' },
          { connectionName: 'Alpha', refUrl: 'https://do-not-fetch.example.com/secret' },
          { connectionName: 'Zulu', refUrl: 'https://do-not-fetch.example.com/secret' },
        ],
      },
    })
    const result = await attachments['oracle_epm_data.connections'].execute(args(), auth)
    expect(result).toMatchObject({
      kind: 'list',
      items: [
        { id: 'Alpha', label: 'Alpha' },
        { id: 'Zulu', label: 'Zulu' },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('refUrl')
    expect(
      await attachments['oracle_epm_data.connections'].execute(
        { ...args(), request: { kind: 'detail', id: 'Alpha' } },
        auth
      )
    ).toMatchObject({ kind: 'detail', item: { id: 'Alpha', label: 'Alpha' } })
  })

  it('projects file names and nullable safe metadata', async () => {
    mocks.files.mockResolvedValue({
      success: true,
      output: {
        files: [{ name: 'outbox/map.csv', type: 'EXTERNAL', size: '3', lastmodifiedtime: null }],
      },
    })
    expect(
      await attachments['oracle_epm_data.files'].execute(args('oracle_epm_data.files'), auth)
    ).toMatchObject({
      items: [
        { id: 'outbox/map.csv', label: 'outbox/map.csv', meta: { type: 'EXTERNAL', size: '3' } },
      ],
    })
  })

  it('requires the complete location scope and excludes application summaries or out-of-scope rows', async () => {
    const scoped = {
      ...args('oracle_epm_data.locations'),
      context: { application: 'Plan', period: 'Jan-26', category: 'Actual' },
    }
    await expect(
      attachments['oracle_epm_data.locations'].execute(args('oracle_epm_data.locations'), auth)
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    expect(mocks.pov).not.toHaveBeenCalled()
    const row = { ...scoped.context, location: 'Source', status: 'Locked' }
    mocks.pov.mockResolvedValue({
      success: true,
      output: {
        povs: [
          row,
          { ...row, location: 'Plan' },
          { ...row, application: 'Other' },
          { ...row, period: 'Feb-26' },
          { ...row, category: 'Budget' },
        ],
      },
    })
    expect(await attachments['oracle_epm_data.locations'].execute(scoped, auth)).toMatchObject({
      items: [{ id: 'Source', label: 'Source', meta: { status: 'Locked' } }],
    })
    expect(mocks.pov).toHaveBeenCalledWith({ ...auth, ...scoped.context }, undefined)
  })

  it('does not expose provider errors, credentials or arbitrary response properties', async () => {
    mocks.connections.mockResolvedValue({
      success: false,
      output: { data: 'synthetic-private-canary' },
      error: 'synthetic-private-canary',
    })
    await expect(attachments['oracle_epm_data.connections'].execute(args(), auth)).rejects.toEqual(
      new SelectorOptionsUnavailableError()
    )
  })

  it('preserves exact configured connection names in selector IDs', async () => {
    mocks.connections.mockResolvedValue({
      success: true,
      output: { connections: [{ connectionName: ' Source ', refUrl: '/unused' }] },
    })
    expect(await attachments['oracle_epm_data.connections'].execute(args(), auth)).toMatchObject({
      items: [{ id: ' Source ', label: ' Source ' }],
    })
  })

  it.each([
    [401, new SelectorConnectionUnavailableError(401)],
    [403, new SelectorConnectionUnavailableError(403)],
    [429, new SelectorOptionsUnavailableError(429)],
    [500, new SelectorOptionsUnavailableError(502)],
    [200, new SelectorOptionsUnavailableError(502)],
  ])(
    'preserves safe HTTP %s categories without exposing provider bodies',
    async (httpStatus, expected) => {
      const result = {
        success: false,
        output: { httpStatus, status: 401, details: 'synthetic-private-canary' },
        error: 'synthetic-private-canary',
      }
      mocks.connections.mockResolvedValue(result)
      mocks.files.mockResolvedValue(result)
      mocks.pov.mockResolvedValue(result)
      for (const key of [
        'oracle_epm_data.connections',
        'oracle_epm_data.files',
        'oracle_epm_data.locations',
      ] as const) {
        await expect(
          attachments[key].execute(
            {
              ...args(key),
              context: { application: 'Plan', period: 'Jan-26', category: 'Actual' },
            },
            auth
          )
        ).rejects.toEqual(expected)
      }
    }
  )

  it('honors cancellation before calling an operation', async () => {
    await expect(
      attachments['oracle_epm_data.connections'].execute(
        { ...args(), signal: AbortSignal.abort() },
        auth
      )
    ).rejects.toThrow()
    expect(mocks.connections).not.toHaveBeenCalled()
  })
})
