/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  bundle: vi.fn(),
  client: vi.fn(),
  periods: vi.fn(),
  files: vi.fn(),
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.resolve }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))
vi.mock('@/lib/internal/oracle-epm', () => ({
  createOracleEpmClient: mocks.client,
  normalizeOracleEpmDestination: (url: string) => url.replace(/\/$/, ''),
}))
vi.mock('@/lib/internal/oracle-epm-account-reconciliation/operations/list-periods', () => ({
  listArcsPeriods: mocks.periods,
}))
vi.mock('@/lib/internal/oracle-epm-account-reconciliation/operations/list-files', () => ({
  listArcsFiles: mocks.files,
}))

import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleEpmAccountReconciliationSelectorAttachments as attachments } from '@/lib/selectors/server/providers/oracle-epm-account-reconciliation'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const client = { request: vi.fn() }
function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oracleEpmAccountReconciliation.periods',
    context: {},
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'w' },
    workspaceId: 'w',
    principal: { kind: 'session', userId: 'u', sessionId: 's' },
    requesterUserId: 'u',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    credential: {
      suppliedId: 'c',
      access: { ok: true, credentialType: 'service_account', resolvedCredentialId: 'resolved-c' },
    },
    ...overrides,
  }
}
describe('Account Reconciliation selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolve.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'oracle-epm-service-account',
    })
    mocks.bundle.mockResolvedValue({
      accessToken: 'server-token',
      instanceUrl: 'https://epm.example.com/gateway/',
    })
    mocks.client.mockReturnValue(client)
    mocks.periods.mockResolvedValue({
      status: 0,
      items: [{ Id: '12', Name: 'January 2026', Status: '52', providerSecret: 'not-projected' }],
    })
    mocks.files.mockResolvedValue({
      status: 0,
      items: [
        {
          name: 'inbox/Quarter 1.csv',
          type: 'EXTERNAL',
          size: '12',
          lastmodifiedtime: null,
          href: 'not-projected',
        },
      ],
    })
  })
  it('constructs clients from the bound credential and ignores browser destinations', async () => {
    const input = args({
      context: { instanceUrl: 'https://attacker.example', accessToken: 'browser-token' },
    })
    await attachments[input.selectorKey as keyof typeof attachments].execute(input)
    expect(mocks.resolve).toHaveBeenCalledWith('resolved-c')
    expect(mocks.bundle).toHaveBeenCalledWith({
      credential: input.credential,
      protectedValues: input.protectedValues,
    })
    expect(mocks.client).toHaveBeenCalledWith({
      instanceUrl: 'https://epm.example.com/gateway',
      accessToken: 'server-token',
    })
  })
  it.each([
    undefined,
    { suppliedId: 'c' },
    { suppliedId: 'c', access: { ok: true, credentialType: 'oauth' as const } },
  ])('rejects missing or non-service-account binding', async (credential) => {
    await expect(
      attachments['oracleEpmAccountReconciliation.periods'].execute(args({ credential }))
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it.each(['netsuite-service-account', 'snowflake-service-account'])(
    'rejects wrong provider %s',
    async (providerId) => {
      mocks.resolve.mockResolvedValue({ credentialType: 'service_account', providerId })
      await expect(
        attachments['oracleEpmAccountReconciliation.periods'].execute(args())
      ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
      expect(mocks.bundle).not.toHaveBeenCalled()
    }
  )
  it('requires a credential-bound destination', async () => {
    mocks.bundle.mockResolvedValue({ accessToken: 'server-token' })
    await expect(
      attachments['oracleEpmAccountReconciliation.periods'].execute(args())
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
  })
  it('returns period names as values with only documented metadata', async () => {
    const signal = new AbortController().signal
    expect(
      await attachments['oracleEpmAccountReconciliation.periods'].execute(args({ signal }))
    ).toEqual({
      kind: 'list',
      items: [
        { id: 'January 2026', label: 'January 2026', meta: { periodId: '12', status: '52' } },
      ],
    })
    expect(mocks.periods).toHaveBeenCalledWith(client, 'ALL', signal)
  })
  it('preserves exact repository filenames and projects scalar file metadata', async () => {
    expect(
      await attachments['oracleEpmAccountReconciliation.files'].execute(
        args({ selectorKey: 'oracleEpmAccountReconciliation.files' })
      )
    ).toEqual({
      kind: 'list',
      items: [
        {
          id: 'inbox/Quarter 1.csv',
          label: 'inbox/Quarter 1.csv',
          meta: { type: 'EXTERNAL', size: '12', lastmodifiedtime: null },
        },
      ],
    })
  })
  it('searches case-insensitively and resolves known and unknown details', async () => {
    const attachment = attachments['oracleEpmAccountReconciliation.periods']
    expect(
      await attachment.execute(args({ request: { kind: 'list', search: 'JANUARY' } }))
    ).toMatchObject({ items: [{ id: 'January 2026' }] })
    expect(
      await attachment.execute(args({ request: { kind: 'list', search: 'February' } }))
    ).toEqual({ kind: 'list', items: [] })
    expect(
      await attachment.execute(args({ request: { kind: 'detail', id: 'January 2026' } }))
    ).toMatchObject({ kind: 'detail', item: { id: 'January 2026' } })
    expect(await attachment.execute(args({ request: { kind: 'detail', id: '12' } }))).toEqual({
      kind: 'detail',
      item: null,
    })
  })
  it('bounds lists without losing searchable and detail-addressable options beyond the cap', async () => {
    const items = Array.from({ length: MAX_SELECTOR_OPTIONS + 1 }, (_, index) => ({
      Id: String(index),
      Name: `Period ${index}`,
      Status: '52',
    }))
    mocks.periods.mockResolvedValue({ status: 0, items })
    const attachment = attachments['oracleEpmAccountReconciliation.periods']
    const result = await attachment.execute(args())
    expect(result).toMatchObject({
      kind: 'list',
      diagnostics: { truncated: { reason: 'provider-cap', limit: MAX_SELECTOR_OPTIONS } },
    })
    if (result.kind !== 'list') throw new Error('Expected list')
    expect(result.items).toHaveLength(MAX_SELECTOR_OPTIONS)
    const lastName = items.at(-1)?.Name ?? ''
    expect(
      await attachment.execute(args({ request: { kind: 'detail', id: lastName } }))
    ).toMatchObject({ item: { id: lastName } })
    expect(
      await attachment.execute(args({ request: { kind: 'list', search: lastName } }))
    ).toMatchObject({ items: [{ id: lastName }] })
  })
  it('declares the API-key integration boundary and only its stored credential service', () => {
    for (const attachment of Object.values(attachments)) {
      expect(attachment.credential).toEqual({
        kind: 'stored',
        field: 'oauthCredential',
        serviceIds: ['oracle-epm-account-reconciliation'],
      })
      expect(attachment.integrationBlockTypes).toEqual(['oracle_epm_account_reconciliation'])
      expect(attachment.destination).toMatchObject({ kind: 'credential-bound' })
    }
  })
})
