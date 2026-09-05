/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionProcurementSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-procurement'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { OracleFusionProcurementBlock } from '@/blocks/blocks/oracle_fusion_procurement'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  resolveAccount: vi.fn(),
  bundle: vi.fn(),
}))

vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.request,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: mocks.resolveAccount,
}))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const ROOT = '/fscmRestApi/resources/11.13.18.05/'
const ID = '9007199254740993'
const KEY = '00020000ABCD'
const PREPARED = { instanceUrl: ORIGIN, accessToken: 'server-injected-token' }
type ProcurementSelectorKey = keyof typeof oracleFusionProcurementSelectorAttachments

function args(name: string): ExecuteServerSelectorArgs {
  return {
    selectorKey: `oracle_fusion_procurement.${name}` as ServerSelectorKey,
    context: { oauthCredential: 'fusion-credential' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    credential: {
      suppliedId: 'fusion-credential',
      access: {
        ok: true,
        resolvedCredentialId: 'fusion-credential',
        credentialOwnerUserId: 'user-1',
        credentialType: 'service_account',
      },
    },
  }
}

function attachment(input: ExecuteServerSelectorArgs) {
  return oracleFusionProcurementSelectorAttachments[input.selectorKey as ProcurementSelectorKey]
}

function resource(path: string, fields: Record<string, unknown>) {
  return {
    ...fields,
    '@context': { key: 'do-not-use', links: [{ rel: 'self', href: ORIGIN + ROOT + path }] },
    secret: 'provider-secret-canary',
    accessToken: 'provider-secret-canary',
  }
}

function page(items: unknown[], offset = 0, hasMore = false) {
  return { items, count: items.length, limit: 100, offset, hasMore }
}

interface SelectorContract {
  name: string
  path: string
  itemKey: string
  fields: Record<string, unknown>
  option: { id: string; label: string; meta?: { detail: string } }
  filter?: string
  context?: { supplierId?: string; poHeaderId?: string }
}

/** Independent Oracle endpoint and option contracts, including numeric-ID query lookups. */
const SELECTOR_CONTRACTS: SelectorContract[] = [
  {
    name: 'suppliers',
    path: 'suppliers',
    itemKey: ID,
    fields: { SupplierId: ID, Supplier: 'Acme', SupplierNumber: 'S100' },
    option: { id: ID, label: 'Acme', meta: { detail: 'S100' } },
  },
  {
    name: 'supplierSites',
    path: `suppliers/${ID}/child/sites`,
    itemKey: '123',
    fields: { SupplierSiteId: '123', SupplierSite: 'Headquarters' },
    option: { id: '123', label: 'Headquarters' },
    context: { supplierId: ID },
  },
  {
    name: 'purchaseRequisitions',
    path: 'purchaseRequisitions',
    itemKey: KEY,
    fields: { RequisitionHeaderId: ID, Requisition: 'REQ100' },
    option: { id: KEY, label: 'REQ100' },
  },
  {
    name: 'draftPurchaseOrders',
    path: 'draftPurchaseOrders',
    itemKey: KEY,
    fields: { POHeaderId: ID, OrderNumber: 'DRAFT100' },
    option: { id: KEY, label: 'DRAFT100' },
  },
  {
    name: 'purchaseOrders',
    path: 'purchaseOrders',
    itemKey: KEY,
    fields: { POHeaderId: ID, OrderNumber: 'PO100' },
    option: { id: KEY, label: 'PO100' },
  },
  {
    name: 'purchaseOrderHeaders',
    path: 'purchaseOrders',
    itemKey: KEY,
    fields: { POHeaderId: ID, OrderNumber: 'PO100' },
    option: { id: ID, label: 'PO100' },
    filter: `POHeaderId=${ID}`,
  },
  {
    name: 'purchaseOrderReceipts',
    path: `purchaseOrderLifeCycleDetails/${ID}/child/receipts`,
    itemKey: KEY,
    fields: { ReceiptId: '123', POHeaderId: ID, Receipt: 'RCV100' },
    option: { id: KEY, label: 'RCV100' },
    context: { poHeaderId: ID },
  },
  {
    name: 'supplierNegotiations',
    path: 'supplierNegotiations',
    itemKey: KEY,
    fields: { AuctionHeaderId: ID, Negotiation: 'N100', NegotiationTitle: 'Equipment' },
    option: { id: KEY, label: 'N100', meta: { detail: 'Equipment' } },
  },
  {
    name: 'supplierNegotiationIds',
    path: 'supplierNegotiations',
    itemKey: KEY,
    fields: { AuctionHeaderId: ID, Negotiation: 'N100' },
    option: { id: ID, label: 'N100' },
    filter: `AuctionHeaderId=${ID}`,
  },
  {
    name: 'supplierNegotiationResponses',
    path: 'supplierNegotiationResponses',
    itemKey: KEY,
    fields: { ResponseNumber: ID, AuctionHeaderId: '123', Supplier: 'Acme' },
    option: { id: KEY, label: ID, meta: { detail: 'Acme' } },
  },
  {
    name: 'procurementAgents',
    path: 'procurementAgents',
    itemKey: ID,
    fields: { AssignmentId: ID, AgentId: '555', Agent: 'Buyer' },
    option: { id: ID, label: 'Buyer' },
  },
  {
    name: 'buyers',
    path: 'procurementAgents',
    itemKey: ID,
    fields: { AssignmentId: ID, AgentId: '555', Agent: 'Buyer' },
    option: { id: '555', label: 'Buyer' },
    filter: 'AgentId=555',
  },
  {
    name: 'procurementBusinessUnits',
    path: 'procurementBusinessUnitsLOV',
    itemKey: ID,
    fields: { ProcurementBUId: ID, ProcurementBU: 'West', AgentAction: 'MANAGE_PURCHASE_ORDERS' },
    option: { id: ID, label: 'West', meta: { detail: 'MANAGE_PURCHASE_ORDERS' } },
    filter: `ProcurementBUId=${ID}`,
  },
  {
    name: 'procurementPersons',
    path: 'procurementPersonsLOV',
    itemKey: ID,
    fields: { PersonId: ID, DisplayName: 'Preparer', PersonNumber: 'P100' },
    option: { id: ID, label: 'Preparer', meta: { detail: 'P100' } },
  },
  {
    name: 'purchasingDocumentStyles',
    path: 'purchasingDocumentStylesLOV',
    itemKey: ID,
    fields: { StyleId: ID, DisplayName: 'Purchase order', StyleName: 'Standard' },
    option: { id: ID, label: 'Purchase order', meta: { detail: 'Standard' } },
  },
  {
    name: 'supplierAddresses',
    path: `suppliers/${ID}/child/addresses`,
    itemKey: '123',
    fields: { SupplierAddressId: '123', AddressName: 'Ordering' },
    option: { id: '123', label: 'Ordering' },
    context: { supplierId: ID },
  },
]

describe('Oracle Fusion Procurement selectors', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolveAccount.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'oracle-fusion-service-account',
    })
    mocks.bundle.mockResolvedValue(PREPARED)
  })

  it.each(SELECTOR_CONTRACTS)('$name lists and resolves the correct workflow value', async (entry) => {
    const input = args(entry.name)
    Object.assign(input.context, entry.context)
    const item = resource(`${entry.path}/${entry.itemKey}`, entry.fields)
    mocks.request.mockResolvedValue(page([item]))
    expect(await attachment(input).execute(input, PREPARED)).toEqual({
      kind: 'list',
      items: [entry.option],
    })
    expect(mocks.request.mock.lastCall![1]).toMatchObject({
      method: 'GET',
      address: { family: 'fscm', relativePath: entry.path },
      query: { limit: 100, offset: 0 },
    })
    mocks.request.mockClear()
    mocks.request.mockResolvedValue(entry.filter ? page([item]) : item)
    input.request = { kind: 'detail', id: entry.option.id }
    expect(await attachment(input).execute(input, PREPARED)).toEqual({
      kind: 'detail',
      item: entry.option,
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.lastCall![1].address.relativePath).toBe(
      entry.filter ? entry.path : `${entry.path}/${entry.itemKey}`
    )
    if (entry.filter) {
      expect(mocks.request.mock.lastCall![1].query).toMatchObject({
        q: entry.filter,
        limit: 1,
        offset: 0,
      })
    }
  })

  it('prepares the destination exclusively from the authorized Fusion credential', async () => {
    const input = args('suppliers')
    mocks.request.mockResolvedValue(page([]))
    await attachment(input).execute(input)
    expect(mocks.resolveAccount).toHaveBeenCalledWith('fusion-credential')
    expect(mocks.bundle).toHaveBeenCalledWith({
      credential: input.credential,
      protectedValues: input.protectedValues,
    })
    expect(mocks.request.mock.calls[0][0]).toEqual(PREPARED)
  })

  it.each([
    { credentialType: 'oauth', providerId: 'oracle-fusion-service-account' },
    { credentialType: 'service_account', providerId: 'netsuite-service-account' },
    null,
  ])('rejects a mismatched stored credential before destination preparation', async (account) => {
    mocks.resolveAccount.mockResolvedValue(account)
    await expect(attachment(args('suppliers')).execute(args('suppliers'))).rejects.toMatchObject({
      name: 'SelectorConnectionUnavailableError',
    })
    expect(mocks.bundle).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each([undefined, 'https://example.com', 'https://vision.fa.us2.oraclecloud.com/path'])(
    'rejects an absent or noncanonical credential destination %s',
    async (instanceUrl) => {
      mocks.bundle.mockResolvedValue({ ...PREPARED, instanceUrl })
      await expect(attachment(args('suppliers')).execute(args('suppliers'))).rejects.toMatchObject({
        name: 'SelectorConnectionUnavailableError',
      })
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['purchaseOrders', 'key', KEY],
    ['purchaseOrderHeaders', 'POHeaderId', ID],
  ])(
    'projects %s identifiers without substituting opaque and numeric keys',
    async (name, field, expected) => {
      mocks.request.mockResolvedValue(
        page([
          resource(`purchaseOrders/${KEY}`, {
            POHeaderId: ID,
            OrderNumber: 'PO100',
            Supplier: 'Acme',
          }),
        ])
      )
      const input = args(name)
      const result = await attachment(input).execute(input, PREPARED)
      expect(result).toEqual({
        kind: 'list',
        items: [{ id: expected, label: 'PO100', meta: { detail: 'Acme' } }],
      })
      expect(JSON.stringify(result)).not.toContain('provider-secret-canary')
      expect(mocks.request.mock.calls[0][1].query.fields).toContain(
        field === 'key' ? 'POHeaderId' : field
      )
    }
  )

  it('uses numeric ID filters for opaque-resource detail lookups', async () => {
    mocks.request.mockResolvedValue(
      page([resource(`purchaseOrders/${KEY}`, { POHeaderId: ID, OrderNumber: 'PO100' })])
    )
    const input = args('purchaseOrderHeaders')
    input.request = { kind: 'detail', id: ID }
    expect(await attachment(input).execute(input, PREPARED)).toEqual({
      kind: 'detail',
      item: { id: ID, label: 'PO100' },
    })
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      address: { family: 'fscm', relativePath: 'purchaseOrders' },
      query: { q: `POHeaderId=${ID}`, limit: 1, offset: 0 },
    })
  })

  it('uses the opaque key when resolving a purchase-order selection by key', async () => {
    mocks.request.mockResolvedValue(
      resource(`purchaseOrders/${KEY}`, { POHeaderId: ID, OrderNumber: 'PO100' })
    )
    const input = args('purchaseOrders')
    input.request = { kind: 'detail', id: KEY }
    expect(await attachment(input).execute(input, PREPARED)).toMatchObject({
      kind: 'detail',
      item: { id: KEY, label: 'PO100' },
    })
    expect(mocks.request.mock.calls[0][1].address.relativePath).toBe(`purchaseOrders/${KEY}`)
  })

  it('cascades supplier sites and addresses using the canonical numeric SupplierId', async () => {
    for (const [selector, child, idField, labelField] of [
      ['supplierSites', 'sites', 'SupplierSiteId', 'SupplierSite'],
      ['supplierAddresses', 'addresses', 'SupplierAddressId', 'AddressName'],
    ]) {
      mocks.request.mockResolvedValue(
        page([
          resource(`suppliers/${ID}/child/${child}/123`, {
            [idField]: '123',
            [labelField]: 'Headquarters',
          }),
        ])
      )
      const input = args(selector)
      input.context.supplierId = ID
      const result = await attachment(input).execute(input, PREPARED)
      expect(result).toMatchObject({ kind: 'list', items: [{ id: '123', label: 'Headquarters' }] })
      expect(mocks.request.mock.lastCall![1].address.relativePath).toBe(
        `suppliers/${ID}/child/${child}`
      )
    }
  })

  it('requires the correct purchase-order context for receipt keys', async () => {
    const input = args('purchaseOrderReceipts')
    await expect(attachment(input).execute(input, PREPARED)).rejects.toMatchObject({
      name: 'SelectorContextUnavailableError',
    })
    expect(mocks.request).not.toHaveBeenCalled()
    input.context.poHeaderId = ID
    mocks.request.mockResolvedValue(
      page([
        resource(`purchaseOrderLifeCycleDetails/${ID}/child/receipts/${KEY}`, {
          ReceiptId: '123',
          Receipt: 'RCV100',
          POHeaderId: ID,
        }),
      ])
    )
    expect(await attachment(input).execute(input, PREPARED)).toMatchObject({
      kind: 'list',
      items: [{ id: KEY, label: 'RCV100' }],
    })
    expect(mocks.request.mock.calls[0][1].address.relativePath).toBe(
      `purchaseOrderLifeCycleDetails/${ID}/child/receipts`
    )
  })

  it('preserves pagination and cancellation without collecting additional pages', async () => {
    const controller = new AbortController()
    const input = args('suppliers')
    input.signal = controller.signal
    input.request = { kind: 'list', cursor: '100' }
    mocks.request.mockResolvedValue(
      page([resource(`suppliers/${ID}`, { SupplierId: ID, Supplier: 'Acme' })], 100, true)
    )
    expect(await attachment(input).execute(input, PREPARED)).toMatchObject({
      kind: 'list',
      nextCursor: '101',
      items: [{ id: ID, label: 'Acme' }],
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][2]).toBe(controller.signal)
    controller.abort(new Error('Stopped'))
    await expect(attachment(input).execute(input, PREPARED)).rejects.toThrow('Stopped')
  })

  it.each(['-1', '1e3', '1000001', 'https://example.com', '01'])(
    'rejects unsafe cursor %s',
    async (cursor) => {
      const input = args('suppliers')
      input.request = { kind: 'list', cursor }
      await expect(attachment(input).execute(input, PREPARED)).rejects.toMatchObject({
        name: 'SelectorContextUnavailableError',
      })
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it('rejects an oversized provider page instead of silently truncating it', async () => {
    mocks.request.mockResolvedValue(
      page(
        Array.from({ length: 101 }, () =>
          resource(`suppliers/${ID}`, { SupplierId: ID, Supplier: 'Acme' })
        )
      )
    )
    const input = args('suppliers')
    await expect(attachment(input).execute(input, PREPARED)).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
    })
  })

  it('deduplicates buyer person IDs across assignments, without returning assignment IDs as buyers', async () => {
    mocks.request.mockResolvedValue(
      page([
        resource('procurementAgents/1', {
          AssignmentId: '1',
          AgentId: ID,
          Agent: 'Buyer',
          ProcurementBU: 'West',
        }),
        resource('procurementAgents/2', {
          AssignmentId: '2',
          AgentId: ID,
          Agent: 'Buyer',
          ProcurementBU: 'East',
        }),
      ])
    )
    const input = args('buyers')
    expect(await attachment(input).execute(input, PREPARED)).toEqual({
      kind: 'list',
      items: [{ id: ID, label: 'Buyer', meta: { detail: 'West' } }],
    })
  })

  it('does not turn nullable person identifiers into selectable values', async () => {
    mocks.request.mockResolvedValue(
      page([
        resource('procurementPersonsLOV/1', { PersonId: null, DisplayName: 'Not selectable' }),
        resource(`procurementPersonsLOV/${ID}`, { PersonId: ID, DisplayName: 'Preparer' }),
      ])
    )
    const input = args('procurementPersons')
    expect(await attachment(input).execute(input, PREPARED)).toEqual({
      kind: 'list',
      items: [{ id: ID, label: 'Preparer' }],
    })
  })

  it('maps provider failures safely and resolves documented missing detail to null', async () => {
    const input = args('suppliers')
    mocks.request.mockRejectedValue(new OracleFusionProviderError('upstream secret', 403))
    await expect(attachment(input).execute(input, PREPARED)).rejects.toEqual(
      expect.objectContaining({
        name: 'SelectorConnectionUnavailableError',
        message: 'Connection unavailable',
      })
    )
    mocks.request.mockRejectedValue(new OracleFusionProviderError('upstream secret', 404))
    input.request = { kind: 'detail', id: ID }
    expect(await attachment(input).execute(input, PREPARED)).toEqual({ kind: 'detail', item: null })
  })

  it('projects only active canonical supplier dependencies and ignores stale purchase-order context', () => {
    const values = {
      operation: 'oracle_fusion_procurement_get_supplier_site',
      credential: 'active-credential',
      manualCredential: 'stale-credential',
      supplierIdSelector: 'stale-supplier',
      supplierIdManual: ID,
      poHeaderIdSelector: 'stale-purchase-order',
    }
    const field = OracleFusionProcurementBlock.subBlocks.find(
      (item) => item.id === 'supplierSiteIdSelector'
    )!
    const context = buildSelectorContextFromValues({
      selectorKey: field.selectorKey!,
      contextConfigs: getSelectorContextSubBlocks(OracleFusionProcurementBlock.subBlocks, values),
      values,
      dependsOn: field.dependsOn,
      canonicalModes: { supplierId: 'advanced', oauthCredential: 'basic' },
    })
    expect(context).toEqual({ oauthCredential: 'active-credential', supplierId: ID })
  })

  it('attaches all 16 selectors through the same prepared credential-bound architecture', () => {
    expect(Object.keys(oracleFusionProcurementSelectorAttachments)).toHaveLength(16)
    for (const value of Object.values(oracleFusionProcurementSelectorAttachments)) {
      expect(value.credential).toMatchObject({
        kind: 'stored',
        field: 'oauthCredential',
        serviceIds: ['oracle_fusion_procurement'],
      })
      expect(value.integrationBlockTypes).toEqual(['oracle_fusion_procurement'])
      expect(value.destination).toMatchObject({
        kind: 'credential-bound',
        prepare: expect.any(Function),
      })
    }
  })
})
