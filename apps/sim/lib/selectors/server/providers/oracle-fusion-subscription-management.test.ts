/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), list: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))
vi.mock('@/lib/internal/oracle-fusion-subscription-management/operations', () => ({
  listOracleFusionSubscriptionRecords: mocks.list,
  getOracleFusionSubscriptionRecord: mocks.get,
}))

import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { selectorManifest } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionSubscriptionSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-subscription-management'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const PREPARED = {
  instanceUrl: ORIGIN,
  oauthCredential: 'credential-1',
  accessToken: 'private-token',
}
type Key = keyof typeof oracleFusionSubscriptionSelectorAttachments
function args(
  selectorKey: Key,
  overrides: Partial<ExecuteServerSelectorArgs> = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: {},
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}
function execute(key: Key, overrides: Partial<ExecuteServerSelectorArgs> = {}) {
  return oracleFusionSubscriptionSelectorAttachments[key].execute(args(key, overrides), PREPARED)
}

describe('Subscription Management selectors', () => {
  it('searches coverage by its queryable PUID while retaining the display name as its label', async () => {
    mocks.list.mockResolvedValue({
      items: [{ CoveredLevelPuid: 'C-001', CoveredLevelName: 'Covered printer' }],
      hasMore: false,
    })
    expect(
      await execute('oracleFusionSubscriptionManagement.coveredLevels', {
        context: { subscriptionNumber: 'SUB-001', subscriptionProductPuid: 'P-001' },
        request: { kind: 'list', search: 'C-001' },
      })
    ).toMatchObject({ items: [{ id: 'C-001', label: 'Covered printer' }] })
    expect(mocks.list.mock.calls[0][1].q).toBe("(CoveredLevelPuid LIKE '%C-001%')")
  })

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.list.mockResolvedValue({ items: [], count: 0, limit: 50, offset: 0, hasMore: false })
    mocks.bundle.mockResolvedValue({ instanceUrl: ORIGIN, accessToken: 'private-token' })
  })

  it('binds nine selectors to the product service and credential-authoritative destination', () => {
    expect(Object.keys(oracleFusionSubscriptionSelectorAttachments)).toHaveLength(9)
    for (const [key, attachment] of Object.entries(oracleFusionSubscriptionSelectorAttachments)) {
      expect(attachment.credential).toEqual({
        kind: 'stored',
        field: 'oauthCredential',
        serviceIds: ['oracle_fusion_subscription_management'],
      })
      expect(attachment.integrationBlockTypes).toEqual(['oracle_fusion_subscription_management'])
      expect(attachment.destination).toMatchObject({
        kind: 'credential-bound',
        prepare: expect.any(Function),
      })
      const manifest = selectorManifest[key as Key]
      expect(manifest.context.allowed).not.toContain('instanceUrl')
      expect(manifest.context.allowed).not.toContain('accessToken')
      expect(manifest).toMatchObject({
        listMode: 'paginated',
        supportsSearch: true,
        supportsDetail: true,
        resolvesUnknownIds: true,
      })
    }
  })

  it('prepares trusted credentials and rejects absent authoritative connection material', async () => {
    const key = 'oracleFusionSubscriptionManagement.subscriptions'
    const attachment = oracleFusionSubscriptionSelectorAttachments[key]
    if (attachment.destination === 'fixed') throw new Error('Expected credential preparation')
    const input = args(key, {
      credential: {
        suppliedId: 'credential-1',
        access: {
          resolvedCredentialId: 'credential-1',
          credentialOwnerUserId: 'owner-1',
          credentialType: 'service_account',
        } as NonNullable<ExecuteServerSelectorArgs['credential']>['access'],
      },
      context: { oauthCredential: 'credential-1' },
    })
    expect(await attachment.destination.prepare(input)).toEqual(PREPARED)
    expect(mocks.bundle).toHaveBeenCalledWith({
      credential: input.credential,
      protectedValues: input.protectedValues,
    })
    mocks.bundle.mockResolvedValue({ accessToken: 'private-token' })
    await expect(attachment.destination.prepare(input)).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
  })

  it('requires only the relevant dependent context before provider execution', async () => {
    for (const key of [
      'oracleFusionSubscriptionManagement.products',
      'oracleFusionSubscriptionManagement.coveredLevels',
      'oracleFusionSubscriptionManagement.subscriptionItems',
      'oracleFusionSubscriptionManagement.billToSites',
    ] as const) {
      await expect(execute(key)).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    }
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    await execute('oracleFusionSubscriptionManagement.billToAccounts')
    expect(mocks.list.mock.calls[0][1].finder).toBeUndefined()
  })

  it('projects public IDs and safe labels with exact parent context and bounded pagination', async () => {
    mocks.list.mockResolvedValue({
      items: [
        {
          SubscriptionProductPuid: 'P-001',
          ProductName: 'Support',
          LineNumber: '10',
          Secret: 'hidden',
        },
      ],
      nextOffset: 51,
      hasMore: true,
    })
    const signal = new AbortController().signal
    const result = await execute('oracleFusionSubscriptionManagement.products', {
      context: { subscriptionNumber: 'SUB / 001' },
      request: { kind: 'list', cursor: '50', search: "Owner's %_support" },
      signal,
    })
    expect(result).toEqual({
      kind: 'list',
      items: [{ id: 'P-001', label: 'Support', meta: { detail: '10' } }],
      nextCursor: '51',
    })
    expect(mocks.list.mock.calls[0][1]).toMatchObject({
      ...PREPARED,
      subscriptionNumber: 'SUB / 001',
      offset: 50,
      limit: 50,
    })
    expect(mocks.list.mock.calls[0][1].q).toContain("Owner''s")
    expect(mocks.list.mock.calls[0][1].q).toContain('\\%\\_')
    expect(mocks.list.mock.calls[0][2]).toBe(signal)
  })

  it('uses public-number detail lookup without inventing a numeric resource key', async () => {
    mocks.get.mockResolvedValue({ SubscriptionNumber: '000123', Description: 'Annual support' })
    expect(
      await execute('oracleFusionSubscriptionManagement.subscriptions', {
        request: { kind: 'detail', id: '000123' },
      })
    ).toEqual({
      kind: 'detail',
      item: { id: '000123', label: '000123', meta: { detail: 'Annual support' } },
    })
    expect(mocks.get).toHaveBeenCalledWith('subscription', PREPARED, '000123', undefined)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('resolves item numeric IDs with the documented organization finder instead of fabricated hashes', async () => {
    const id = '9007199254740993'
    mocks.list.mockResolvedValue({
      items: [{ InventoryItemId: id, ItemNumber: 'SUPPORT', OrganizationId: '123' }],
      hasMore: false,
    })
    expect(
      await execute('oracleFusionSubscriptionManagement.subscriptionItems', {
        context: { orgId: '123' },
        request: { kind: 'detail', id },
      })
    ).toMatchObject({ kind: 'detail', item: { id, label: 'SUPPORT' } })
    expect(mocks.list.mock.calls[0][1]).toMatchObject({
      finder: 'SubscriptionItemsByOrganizationIdRowFinder;BindOrganizationId=123',
      q: '(InventoryItemId=9007199254740993)',
      limit: 2,
    })
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('binds bill-to sites to their account and allows documented related-party account results', async () => {
    mocks.list.mockResolvedValue({
      items: [{ CustAccountId: '123', AccountNumber: 'AC-001', PartyId: '999' }],
      hasMore: false,
    })
    await execute('oracleFusionSubscriptionManagement.billToAccounts', {
      context: { primaryPartyId: '456' },
    })
    expect(mocks.list.mock.calls[0][1].finder).toBe('PrimaryPartyIdFinder;primaryPartyId=456')
    mocks.list.mockResolvedValue({
      items: [{ SiteUseId: '789', CustAccountId: '999', PartySiteName: 'Wrong account' }],
      hasMore: false,
    })
    await expect(
      execute('oracleFusionSubscriptionManagement.billToSites', {
        context: { billToAccountId: '123' },
      })
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    expect(mocks.list.mock.calls[1][1].q).toBe('(CustAccountId=123)')
  })

  it('rejects ambiguous or mismatched numeric detail results and malformed cursors', async () => {
    for (const page of [
      { items: [{ AssetId: '999' }], hasMore: false },
      { items: [{ AssetId: '123' }, { AssetId: '123' }], hasMore: false },
      { items: [{ AssetId: '123' }], hasMore: true },
    ]) {
      mocks.list.mockResolvedValue(page)
      await expect(
        execute('oracleFusionSubscriptionManagement.subscriptionAssets', {
          request: { kind: 'detail', id: '123' },
        })
      ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    }
    for (const cursor of ['-1', '01', '1e3', '9007199254740992']) {
      await expect(
        execute('oracleFusionSubscriptionManagement.subscriptions', {
          request: { kind: 'list', cursor },
        })
      ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    }
  })

  it('returns missing details safely and propagates caller cancellation', async () => {
    mocks.get.mockRejectedValue(new OracleFusionProviderError('Not found', 404))
    expect(
      await execute('oracleFusionSubscriptionManagement.subscriptions', {
        request: { kind: 'detail', id: 'MISSING' },
      })
    ).toEqual({ kind: 'detail', item: null })
    const controller = new AbortController()
    controller.abort()
    await expect(
      execute('oracleFusionSubscriptionManagement.subscriptions', { signal: controller.signal })
    ).rejects.toThrow()
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
