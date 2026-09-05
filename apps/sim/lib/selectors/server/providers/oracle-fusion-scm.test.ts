/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getResource: vi.fn(),
  listResource: vi.fn(),
  resolveBundle: vi.fn(),
}))

vi.mock('@/lib/internal/oracle-fusion-scm/operations', () => ({
  getOracleFusionScmResource: mocks.getResource,
  listOracleFusionScmResource: mocks.listResource,
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.resolveBundle,
}))

import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import { isSelectorReady } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionScmSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-scm'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { OracleFusionScmBlock } from '@/blocks/blocks/oracle_fusion_scm'

const auth = {
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://example.fa.us6.oraclecloud.com',
}

function args(
  selectorKey: ExecuteServerSelectorArgs['selectorKey'] = 'oracleFusionScm.items',
  request: ExecuteServerSelectorArgs['request'] = { kind: 'list' }
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: { oauthCredential: 'credential-1' },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Oracle Fusion SCM selector adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('binds preparation to an authorized Oracle Fusion service-account credential', async () => {
    mocks.resolveBundle.mockResolvedValue(auth)
    const attachment = oracleFusionScmSelectorAttachments['oracleFusionScm.items']
    if (attachment.destination === 'fixed') throw new Error('Expected a prepared destination')
    const input = args()
    input.credential = {
      suppliedId: 'credential-1',
      providerId: 'oracle-fusion-service-account',
      access: {
        resolvedCredentialId: 'resolved-1',
        credentialOwnerUserId: 'user-1',
        credentialType: 'service_account',
      },
    }
    await expect(attachment.destination.prepare(input)).resolves.toEqual(auth)
    expect(mocks.resolveBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: input.credential,
        providerId: 'oracle-fusion-service-account',
      })
    )

    input.credential.providerId = 'another-provider'
    await expect(attachment.destination.prepare(input)).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
  })

  it.each([
    [
      'oracleFusionScm.inventoryOrganizations',
      'inventoryOrganizations',
      'organizationKey',
      {
        organizationKey: 'org:1',
        OrganizationName: 'Seattle',
        OrganizationCode: 'SEA',
        Status: 'Active',
      },
      'Seattle — SEA',
      { code: 'SEA', status: 'Active' },
    ],
    [
      'oracleFusionScm.items',
      'items',
      'itemKey',
      {
        itemKey: 'item:1',
        ItemNumber: 'A-100',
        ItemDescription: 'Widget',
        OrganizationCode: 'SEA',
        ItemStatusValue: 'Active',
      },
      'A-100 — Widget',
      { organizationCode: 'SEA', status: 'Active' },
    ],
    [
      'oracleFusionScm.supplyRequests',
      'supplyRequests',
      'supplyRequestKey',
      {
        supplyRequestKey: 'request:1',
        SupplyOrderNumber: 'SO-1',
        SupplyRequestStatus: 'Open',
        SupplyRequestDate: '2026-09-01',
      },
      'SO-1',
      { status: 'Open', requestDate: '2026-09-01' },
    ],
    [
      'oracleFusionScm.shipments',
      'shipments',
      'shipmentKey',
      {
        shipmentKey: 'shipment:1',
        Shipment: 'S-1',
        ShipmentStatus: 'Shipped',
        OrganizationCode: 'SEA',
        ActualShipDate: null,
      },
      'S-1',
      { status: 'Shipped', organizationCode: 'SEA', actualShipDate: null },
    ],
    [
      'oracleFusionScm.manufacturingWorkOrders',
      'manufacturingWorkOrders',
      'manufacturingWorkOrderKey',
      {
        manufacturingWorkOrderKey: 'mwo:1',
        WorkOrderNumber: 'WO-1',
        WorkOrderStatusName: 'Released',
        OrganizationCode: 'SEA',
        ItemNumber: 'A-100',
      },
      'WO-1',
      { status: 'Released', organizationCode: 'SEA', itemNumber: 'A-100' },
    ],
    [
      'oracleFusionScm.maintenanceWorkOrders',
      'maintenanceWorkOrders',
      'maintenanceWorkOrderKey',
      {
        maintenanceWorkOrderKey: 'maint:1',
        WorkOrderNumber: 'MWO-1',
        WorkOrderStatus: 'Open',
        OrganizationCode: 'SEA',
        AssetNumber: 'ASSET-1',
      },
      'MWO-1',
      { status: 'Open', organizationCode: 'SEA', assetNumber: 'ASSET-1' },
    ],
  ] as const)(
    'projects safe paginated options for %s',
    async (selectorKey, resource, keyField, item, label, meta) => {
      mocks.listResource.mockResolvedValueOnce({
        items: [item],
        count: 1,
        hasMore: true,
        limit: 50,
        offset: 25,
        nextOffset: 26,
      })
      const attachment = oracleFusionScmSelectorAttachments[selectorKey]
      const result = await attachment.execute(
        args(selectorKey, { kind: 'list', cursor: '25' }),
        auth
      )
      expect(result).toEqual({
        kind: 'list',
        items: [{ id: item[keyField], label, meta }],
        nextCursor: '26',
      })
      expect(mocks.listResource).toHaveBeenLastCalledWith(
        resource,
        { ...auth, limit: 50, offset: 25, totalResults: false },
        undefined
      )
      expect(JSON.stringify(result)).not.toContain('accessToken')
      expect(JSON.stringify(result)).not.toContain('instanceUrl')
      expect(JSON.stringify(result)).not.toContain('links')
    }
  )

  it('hydrates a detail and validates the requested opaque key', async () => {
    mocks.getResource.mockResolvedValueOnce({
      shipmentKey: 'shipment:1',
      Shipment: 'S-1',
      ShipmentDescription: 'Outbound',
    })
    const result = await oracleFusionScmSelectorAttachments['oracleFusionScm.shipments'].execute(
      args('oracleFusionScm.shipments', { kind: 'detail', id: 'shipment:1' }),
      auth
    )
    expect(result).toEqual({
      kind: 'detail',
      item: { id: 'shipment:1', label: 'S-1 — Outbound' },
    })
    expect(mocks.getResource).toHaveBeenCalledWith(
      'shipments',
      { ...auth, key: 'shipment:1' },
      undefined
    )

    mocks.getResource.mockResolvedValueOnce({ shipmentKey: 'different', Shipment: 'S-2' })
    await expect(
      oracleFusionScmSelectorAttachments['oracleFusionScm.shipments'].execute(
        args('oracleFusionScm.shipments', { kind: 'detail', id: 'shipment:1' }),
        auth
      )
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
  })

  it.each([
    [
      'oracleFusionScm.supplyOrderLines',
      'supplyOrderLines',
      'supplyRequestKey',
      'supplyOrderLineKey',
    ],
    [
      'oracleFusionScm.transferOrderLines',
      'transferOrderLines',
      'transferOrderKey',
      'transferOrderLineKey',
    ],
    ['oracleFusionScm.salesOrderLines', 'salesOrderLines', 'salesOrderKey', 'salesOrderLineKey'],
  ] as const)(
    'requires the exact parent for %s list and detail requests',
    async (selectorKey, resource, parentField, keyField) => {
      const attachment = oracleFusionScmSelectorAttachments[selectorKey]
      const input = args(selectorKey)
      await expect(attachment.execute(input, auth)).rejects.toBeInstanceOf(
        SelectorContextUnavailableError
      )
      expect(mocks.listResource).not.toHaveBeenCalled()
      input.context.collectionId = ' parent:9007199254740993 '
      mocks.listResource.mockResolvedValueOnce({
        items: [
          { [keyField]: ' child:key ', LineNumber: '1', ItemNumber: 'A1', ProductNumber: 'A1' },
        ],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      })
      const listed = await attachment.execute(input, auth)
      expect(listed).toMatchObject({ kind: 'list', items: [{ id: ' child:key ' }] })
      expect(listed).not.toHaveProperty('nextCursor')
      expect(mocks.listResource).toHaveBeenCalledWith(
        resource,
        {
          ...auth,
          [parentField]: ' parent:9007199254740993 ',
          limit: 50,
          offset: 0,
          totalResults: false,
        },
        undefined
      )
      mocks.getResource.mockResolvedValueOnce({ [keyField]: ' child:key ' })
      input.request = { kind: 'detail', id: ' child:key ' }
      expect(await attachment.execute(input, auth)).toEqual({
        kind: 'detail',
        item: { id: ' child:key ', label: ' child:key ' },
      })
      expect(mocks.getResource).toHaveBeenCalledWith(
        resource,
        {
          ...auth,
          [parentField]: ' parent:9007199254740993 ',
          key: ' child:key ',
        },
        undefined
      )
    }
  )

  it.each([
    [
      'oracleFusionScm.shipmentLines',
      { shipmentLineKey: '123', ShipmentLine: '123', Item: 'A1', Shipment: 'S1' },
      '123 — A1 — S1',
    ],
    [
      'oracleFusionScm.transferOrders',
      { transferOrderKey: '123', HeaderNumber: 'TO1', Description: 'Restock' },
      'TO1 — Restock',
    ],
    [
      'oracleFusionScm.salesOrders',
      { salesOrderKey: 'EXT:1', OrderNumber: 'SO1', BuyingPartyName: 'Example buyer' },
      'SO1 — Example buyer',
    ],
  ] as const)('labels %s using documented product fields', async (key, item, label) => {
    mocks.listResource.mockResolvedValueOnce({
      items: [item],
      count: 1,
      hasMore: false,
      limit: 50,
      offset: 0,
    })
    expect(await oracleFusionScmSelectorAttachments[key].execute(args(key), auth)).toMatchObject({
      kind: 'list',
      items: [{ label }],
    })
  })

  it('uses the active manual sales-order parent and credential for its child selector', () => {
    const values = {
      operation: 'oracle_fusion_scm_get_sales_order_line',
      credential: 'stale-credential',
      manualCredential: 'credential-2',
      salesOrderSelector: 'stale-order',
      salesOrderKeyManual: ' EXT:0001 ',
    }
    const context = buildSelectorContextFromValues({
      selectorKey: 'oracleFusionScm.salesOrderLines',
      contextConfigs: getSelectorContextSubBlocks(OracleFusionScmBlock.subBlocks, values),
      values,
      dependsOn: ['oauthCredential', 'salesOrderKey'],
      canonicalModes: { oauthCredential: 'advanced', salesOrderKey: 'advanced' },
    })
    expect(context).toEqual({ oauthCredential: 'credential-2', collectionId: ' EXT:0001 ' })
    expect(isSelectorReady('oracleFusionScm.salesOrderLines', context)).toBe(true)
    expect(
      isSelectorReady('oracleFusionScm.salesOrderLines', {
        oauthCredential: 'credential-2',
      })
    ).toBe(false)
  })

  it('converts a genuine provider detail 404 to null', async () => {
    mocks.getResource.mockRejectedValueOnce(
      new OracleFusionProviderError('Oracle Fusion resource was not found', 404)
    )
    await expect(
      oracleFusionScmSelectorAttachments['oracleFusionScm.items'].execute(
        args('oracleFusionScm.items', { kind: 'detail', id: 'item:1' }),
        auth
      )
    ).resolves.toEqual({ kind: 'detail', item: null })
  })

  it('rejects arbitrary search translation and malformed cursors or detail keys', async () => {
    const attachment = oracleFusionScmSelectorAttachments['oracleFusionScm.items']
    await expect(
      attachment.execute(args('oracleFusionScm.items', { kind: 'list', search: 'widget' }), auth)
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    await expect(
      attachment.execute(args('oracleFusionScm.items', { kind: 'list', cursor: '-1' }), auth)
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    await expect(
      attachment.execute(args('oracleFusionScm.items', { kind: 'detail', id: '../item' }), auth)
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    expect(mocks.listResource).not.toHaveBeenCalled()
    expect(mocks.getResource).not.toHaveBeenCalled()
  })

  it('maps provider authorization and throttling errors without leaking provider bodies', async () => {
    mocks.listResource.mockRejectedValueOnce(
      new OracleFusionProviderError('provider-secret-canary', 403)
    )
    await expect(
      oracleFusionScmSelectorAttachments['oracleFusionScm.items'].execute(args(), auth)
    ).rejects.toEqual(new SelectorConnectionUnavailableError(403))

    mocks.listResource.mockRejectedValueOnce(
      new OracleFusionProviderError('provider-secret-canary', 429)
    )
    await expect(
      oracleFusionScmSelectorAttachments['oracleFusionScm.items'].execute(args(), auth)
    ).rejects.toEqual(new SelectorOptionsUnavailableError(429))
  })
})
