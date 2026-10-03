/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn(), empty: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.request,
  requestOracleFusionEmpty: mocks.empty,
}))

import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'
import { executeOracleFusionScmTool } from '@/lib/internal/oracle-fusion-scm/execute-tool'
import {
  getOracleFusionScmResource,
  listOracleFusionScmResource,
} from '@/lib/internal/oracle-fusion-scm/operations/read-resource'
import type { OracleFusionScmResource } from '@/lib/internal/oracle-fusion-scm/schema'
import { OracleFusionScmBlock } from '@/blocks/blocks/oracle_fusion_scm'
import {
  oracleFusionScmGetItemTool,
  oracleFusionScmUpdateItemTool,
  oracleFusionScmUpdateSalesOrderTool,
} from '@/tools/oracle_fusion_scm'

const instanceUrl = 'https://example.fa.us6.oraclecloud.com'
const root = '/fscmRestApi/resources/11.13.18.05'
const auth = { accessToken: 'dXNlcjpwYXNz', instanceUrl }
const toolAuth = { ...auth, oauthCredential: 'credential-1' }

function resource(path: string, fields: Record<string, unknown> = {}) {
  return {
    ...fields,
    '@context': { links: [{ rel: 'self', href: `${instanceUrl}${root}/${path}` }] },
  }
}

function page(items: unknown[], more = false, offset = 0, limit = 50) {
  return { items, count: items.length, hasMore: more, offset, limit }
}

async function execute(toolId: string, input: Record<string, unknown>, signal?: AbortSignal) {
  return executeOracleFusionScmTool({
    toolId: `oracle_fusion_scm_${toolId}`,
    input: { ...toolAuth, ...input },
    headers: new Headers(),
    context: { workflowId: 'workflow-1' },
    requestId: 'request-1',
    signal,
  })
}

/** Independent routes from the Oracle 26C resource pages, including both fulfillment parents. */
const reads: Array<{
  resource: OracleFusionScmResource
  list: string
  get: string
  path: string
  key: string
  wrapper: string
  parents?: Record<string, string>
}> = [
  {
    resource: 'inventoryOrganizations',
    list: 'list_inventory_organizations',
    get: 'get_inventory_organization',
    path: 'inventoryOrganizations',
    key: 'organizationKey',
    wrapper: 'organization',
  },
  {
    resource: 'items',
    list: 'list_items',
    get: 'get_item',
    path: 'itemsV2',
    key: 'itemKey',
    wrapper: 'item',
  },
  {
    resource: 'onHandQuantities',
    list: 'list_on_hand_quantities',
    get: 'get_on_hand_quantity',
    path: 'onhandQuantityDetails',
    key: 'onHandQuantityKey',
    wrapper: 'onHandQuantity',
  },
  {
    resource: 'inventoryTransactions',
    list: 'list_inventory_transactions',
    get: 'get_inventory_transaction',
    path: 'inventoryCompletedTransactions',
    key: 'transactionKey',
    wrapper: 'transaction',
  },
  {
    resource: 'supplyRequests',
    list: 'list_supply_requests',
    get: 'get_supply_request',
    path: 'supplyRequests',
    key: 'supplyRequestKey',
    wrapper: 'supplyRequest',
  },
  {
    resource: 'supplyOrderLines',
    list: 'list_supply_order_lines',
    get: 'get_supply_order_line',
    path: 'supplyRequests/request%3A1/child/supplyOrderLines',
    key: 'supplyOrderLineKey',
    wrapper: 'supplyOrderLine',
    parents: { supplyRequestKey: 'request:1' },
  },
  {
    resource: 'shipments',
    list: 'list_shipments',
    get: 'get_shipment',
    path: 'shipments',
    key: 'shipmentKey',
    wrapper: 'shipment',
  },
  {
    resource: 'shipmentLines',
    list: 'list_shipment_lines',
    get: 'get_shipment_line',
    path: 'shipmentLines',
    key: 'shipmentLineKey',
    wrapper: 'shipmentLine',
  },
  {
    resource: 'manufacturingWorkOrders',
    list: 'list_manufacturing_work_orders',
    get: 'get_manufacturing_work_order',
    path: 'workOrders',
    key: 'manufacturingWorkOrderKey',
    wrapper: 'manufacturingWorkOrder',
  },
  {
    resource: 'maintenanceWorkOrders',
    list: 'list_maintenance_work_orders',
    get: 'get_maintenance_work_order',
    path: 'maintenanceWorkOrders',
    key: 'maintenanceWorkOrderKey',
    wrapper: 'maintenanceWorkOrder',
  },
  {
    resource: 'transferOrders',
    list: 'list_transfer_orders',
    get: 'get_transfer_order',
    path: 'transferOrders',
    key: 'transferOrderKey',
    wrapper: 'transferOrder',
  },
  {
    resource: 'transferOrderLines',
    list: 'list_transfer_order_lines',
    get: 'get_transfer_order_line',
    path: 'transferOrders/header%3A1/child/transferOrderLines',
    key: 'transferOrderLineKey',
    wrapper: 'transferOrderLine',
    parents: { transferOrderKey: 'header:1' },
  },
  {
    resource: 'salesOrders',
    list: 'list_sales_orders',
    get: 'get_sales_order',
    path: 'salesOrdersForOrderHub',
    key: 'salesOrderKey',
    wrapper: 'salesOrder',
  },
  {
    resource: 'salesOrderLines',
    list: 'list_sales_order_lines',
    get: 'get_sales_order_line',
    path: 'salesOrdersForOrderHub/order%3A1/child/lines',
    key: 'salesOrderLineKey',
    wrapper: 'salesOrderLine',
    parents: { salesOrderKey: 'order:1' },
  },
  {
    resource: 'fulfillmentLineDetails',
    list: 'list_fulfillment_line_details',
    get: 'get_fulfillment_line_detail',
    path: 'salesOrdersForOrderHub/order%3A1/child/lines/line%3A2/child/lineDetails',
    key: 'fulfillmentLineDetailKey',
    wrapper: 'fulfillmentLineDetail',
    parents: { salesOrderKey: 'order:1', salesOrderLineKey: 'line:2' },
  },
]

beforeEach(() => vi.resetAllMocks())

describe('Oracle Fusion SCM reads', () => {
  it.each(reads)(
    'round-trips list/detail keys at the documented $resource route',
    async (entry) => {
      const key = ' opaque:9007199254740993 '
      const path = `${entry.path}/${encodeURIComponent(key)}`
      mocks.request.mockResolvedValueOnce(page([resource(path)]))
      const listed = await execute(entry.list, { ...entry.parents })
      expect(listed.status).toBe(200)
      expect((await listed.json()).output.items[0][entry.key]).toBe(key)
      expect(mocks.request).toHaveBeenLastCalledWith(
        expect.objectContaining(auth),
        expect.objectContaining({
          address: { family: 'fscm', relativePath: entry.path },
          query: expect.objectContaining({ limit: 50, offset: 0, links: 'self' }),
        }),
        undefined
      )

      mocks.request.mockResolvedValueOnce(resource(path))
      const detailed = await execute(entry.get, { ...entry.parents, [entry.key]: key })
      expect(detailed.status).toBe(200)
      expect((await detailed.json()).output[entry.wrapper][entry.key]).toBe(key)
      expect(mocks.request).toHaveBeenLastCalledWith(
        expect.objectContaining(auth),
        expect.objectContaining({
          address: { family: 'fscm', relativePath: path },
        }),
        undefined
      )
    }
  )

  it('projects precise IDs, nullable item state, and no protocol or unselected fields', async () => {
    mocks.request.mockResolvedValueOnce(
      resource('itemsV2/item%3A1', {
        ItemId: '9.007199254740993e15',
        OrganizationId: 204,
        ItemNumber: '000123',
        ItemDescription: null,
        StockEnabledFlag: false,
        SecretTenantExtension: 'not selected',
      })
    )
    const item = await getOracleFusionScmResource('items', { ...auth, key: 'item:1' })
    expect(item).toMatchObject({
      itemKey: 'item:1',
      ItemId: '9007199254740993',
      OrganizationId: '204',
      ItemNumber: '000123',
      ItemDescription: null,
      StockEnabledFlag: false,
      PrimaryUOMValue: null,
    })
    expect(item).not.toHaveProperty('@context')
    expect(item).not.toHaveProperty('SecretTenantExtension')
  })

  it('keeps distinct manufacturing, maintenance, transfer, and fulfillment projections', async () => {
    mocks.request.mockResolvedValueOnce(
      resource('workOrders/1', {
        WorkOrderType: 'STANDARD',
        CompletedQuantity: 0,
        ScrappedQuantity: 2,
      })
    )
    expect(
      await getOracleFusionScmResource('manufacturingWorkOrders', { ...auth, key: '1' })
    ).toMatchObject({ WorkOrderType: 'STANDARD', CompletedQuantity: 0, ScrappedQuantity: 2 })
    mocks.request.mockResolvedValueOnce(
      resource('maintenanceWorkOrders/2', {
        AssetId: '9007199254740993',
        WorkOrderTypeCode: 'CORRECTIVE',
        WarrantyRepairFlag: false,
      })
    )
    expect(
      await getOracleFusionScmResource('maintenanceWorkOrders', { ...auth, key: '2' })
    ).toMatchObject({
      AssetId: '9007199254740993',
      WorkOrderTypeCode: 'CORRECTIVE',
      WarrantyRepairFlag: false,
    })
    mocks.request.mockResolvedValueOnce(
      resource('transferOrders/3', {
        HeaderId: '9007199254740993',
        HeaderNumber: 'TO-3',
        Status: 'OPEN',
      })
    )
    expect(await getOracleFusionScmResource('transferOrders', { ...auth, key: '3' })).toMatchObject(
      { HeaderId: '9007199254740993', HeaderNumber: 'TO-3', Status: 'OPEN' }
    )
    mocks.request.mockResolvedValueOnce(
      resource('salesOrdersForOrderHub/order/child/lines/line/child/lineDetails/detail', {
        FulfillLineDetailId: '9007199254740993',
        TrackingNumber: '0000123',
        Quantity: 0,
        BillingTransactionAmount: 42.5,
      })
    )
    expect(
      await getOracleFusionScmResource('fulfillmentLineDetails', {
        ...auth,
        key: 'detail',
        salesOrderKey: 'order',
        salesOrderLineKey: 'line',
      })
    ).toMatchObject({ TrackingNumber: '0000123', Quantity: 0, BillingTransactionAmount: 42.5 })
  })

  it('returns exactly one requested page and omits continuation on the last and empty pages', async () => {
    const input = { ...auth, limit: 2, offset: 10, totalResults: true }
    mocks.request.mockResolvedValueOnce({
      ...page([resource('shipments/1')], true, 10, 2),
      totalResults: 20,
    })
    expect(await listOracleFusionScmResource('shipments', input)).toMatchObject({
      count: 1,
      nextOffset: 11,
      totalResults: 20,
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    mocks.request.mockResolvedValueOnce(page([resource('shipments/2')], false, 11, 2))
    expect(
      await listOracleFusionScmResource('shipments', { ...input, offset: 11 })
    ).not.toHaveProperty('nextOffset')
    mocks.request.mockResolvedValueOnce({ count: 0, hasMore: false, offset: 12, limit: 2 })
    expect(await listOracleFusionScmResource('shipments', { ...input, offset: 12 })).toEqual({
      items: [],
      count: 0,
      hasMore: false,
      offset: 12,
      limit: 2,
    })
  })

  it.each([
    page([resource('itemsV2/1'), resource('itemsV2/2')], false, 0, 1),
    page([resource('itemsV2/1')], false, 10, 1),
    page([resource('itemsV2/1')], false, 0, 50),
  ])('rejects responses outside the requested page boundary', async (payload) => {
    mocks.request.mockResolvedValueOnce(payload)
    await expect(
      listOracleFusionScmResource('items', {
        ...auth,
        limit: 1,
        offset: 0,
        totalResults: false,
      })
    ).rejects.toBeInstanceOf(OracleFusionProviderError)
  })

  it('passes documented finders unchanged and rejects simultaneous q and finder', async () => {
    mocks.request.mockResolvedValueOnce(page([]))
    const result = await execute('list_shipments', { finder: 'findByShipmentName;Shipment=S-1' })
    expect(result.status).toBe(200)
    expect(mocks.request.mock.calls[0][1].query.finder).toBe('findByShipmentName;Shipment=S-1')
    mocks.request.mockClear()
    expect(
      (
        await execute('list_items', {
          q: 'ItemNumber=ABC',
          finder: 'ItemNumberAltKey;ItemNumber=ABC',
        })
      ).status
    ).toBe(400)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('rejects missing fulfillment parents and wrong-parent self links', async () => {
    expect(
      (await execute('list_fulfillment_line_details', { salesOrderKey: 'order' })).status
    ).toBe(400)
    expect(mocks.request).not.toHaveBeenCalled()
    mocks.request.mockResolvedValueOnce(
      resource('salesOrdersForOrderHub/wrong/child/lines/line/child/lineDetails/1')
    )
    expect(
      (
        await execute('get_fulfillment_line_detail', {
          salesOrderKey: 'order',
          salesOrderLineKey: 'line',
          fulfillmentLineDetailKey: '1',
        })
      ).status
    ).toBe(502)
  })
})

describe('Oracle Fusion SCM writes', () => {
  it('returns the validated new supply-reference key after an explicit rename', async () => {
    const newKey = ' new:reference '
    mocks.request.mockResolvedValueOnce(
      resource(`supplyRequests/${encodeURIComponent(newKey)}`, {
        SupplyOrderReferenceNumber: newKey,
      })
    )
    const result = await execute('update_supply_request', {
      supplyRequestKey: 'old:reference',
      body: { SupplyOrderReferenceNumber: newKey },
    })
    expect(result.status).toBe(200)
    expect((await result.json()).output.supplyRequest.supplyRequestKey).toBe(newKey)
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      address: { family: 'fscm', relativePath: 'supplyRequests/old%3Areference' },
      body: { SupplyOrderReferenceNumber: newKey },
    })
  })

  it('still rejects an unrelated supply-reference key after updating a request', async () => {
    mocks.request.mockResolvedValueOnce(resource('supplyRequests/unrelated'))
    expect(
      (
        await execute('update_supply_request', {
          supplyRequestKey: 'old',
          body: { SupplyOrderReferenceNumber: 'new' },
        })
      ).status
    ).toBe(502)
  })

  it('rejects oversized UTF-8 editor JSON before parsing or calling Oracle', async () => {
    const parse = vi.spyOn(JSON, 'parse')
    const body = `{"ItemDescription":"${'€'.repeat(Math.ceil(MAX_INLINE_MATERIALIZATION_BYTES / 3))}"}`
    try {
      expect((await execute('update_item', { itemKey: 'item', body })).status).toBe(400)
      expect(parse).not.toHaveBeenCalledWith(body)
      expect(mocks.request).not.toHaveBeenCalled()
    } finally {
      parse.mockRestore()
    }
  })

  it.each([
    [
      'update_item',
      'itemsV2/item',
      { itemKey: 'item' },
      { ItemDescription: 'Widget', StockEnabledFlag: false },
      'item',
    ],
    [
      'update_supply_request',
      'supplyRequests/request',
      { supplyRequestKey: 'request' },
      { ProcessRequestFlag: false },
      'supplyRequest',
    ],
    [
      'update_transfer_order',
      'transferOrders/order',
      { transferOrderKey: 'order' },
      { MessageText: 'Reviewed' },
      'transferOrder',
    ],
    [
      'update_transfer_order_line',
      'transferOrders/order/child/transferOrderLines/line',
      { transferOrderKey: 'order', transferOrderLineKey: 'line' },
      { RequestedQuantity: 0, Comments: null },
      'transferOrderLine',
    ],
    [
      'update_manufacturing_work_order',
      'workOrders/work',
      { manufacturingWorkOrderKey: 'work' },
      { PlannedStartQuantity: 0, WorkOrderStatusCode: 'ON_HOLD' },
      'manufacturingWorkOrder',
    ],
    [
      'update_maintenance_work_order',
      'maintenanceWorkOrders/work',
      { maintenanceWorkOrderKey: 'work' },
      { WorkOrderDescription: 'Inspect pump', WorkOrderPriority: 0 },
      'maintenanceWorkOrder',
    ],
    [
      'update_sales_order',
      'salesOrdersForOrderHub/order',
      { salesOrderKey: 'order' },
      { SubmittedFlag: false, Comments: null },
      'salesOrder',
    ],
  ] as const)(
    'routes %s and preserves explicit false, zero, and nullable updates',
    async (tool, path, keys, body, wrapper) => {
      mocks.request.mockResolvedValueOnce(resource(path))
      const result = await execute(tool, { ...keys, body })
      expect(result.status).toBe(200)
      expect((await result.json()).output).toHaveProperty(wrapper)
      expect(mocks.request).toHaveBeenCalledTimes(1)
      expect(mocks.request.mock.calls[0][1]).toMatchObject({
        method: 'PATCH',
        address: { family: 'fscm', relativePath: path },
        mediaType: 'application/vnd.oracle.adf.resourceitem+json',
      })
      expect(
        JSON.parse(serializeOracleFusionJsonBody(mocks.request.mock.calls[0][1].body))
      ).toEqual(body)
    }
  )

  it.each([
    [
      'create_manufacturing_work_order',
      'workOrders',
      {
        InventoryItemId: '9007199254740993',
        PlannedStartQuantity: 2,
        WorkOrderType: 'STANDARD',
        OrganizationCode: 'M1',
      },
    ],
    [
      'create_maintenance_work_order',
      'maintenanceWorkOrders',
      {
        InventoryItemId: '9007199254740993',
        PlannedStartQuantity: 1,
        UOMCode: 'Ea',
        WorkOrderTypeCode: 'CORRECTIVE',
        AssetId: '9007199254740995',
        OrganizationCode: 'M1',
      },
    ],
  ] as const)(
    'creates %s with exact numeric Oracle IDs in the request body only',
    async (tool, collection, body) => {
      mocks.request.mockResolvedValueOnce(
        resource(`${collection}/new`, { WorkOrderId: '9007199254740997' })
      )
      const result = await execute(tool, { body: JSON.stringify(body) })
      expect(result.status).toBe(200)
      expect(mocks.request.mock.calls[0][1]).toMatchObject({
        method: 'POST',
        address: { family: 'fscm', relativePath: collection },
      })
      const wire = serializeOracleFusionJsonBody(mocks.request.mock.calls[0][1].body)
      expect(wire).toContain('"InventoryItemId":9007199254740993')
      expect(wire).toContain('"OrganizationCode":"M1"')
      expect(JSON.stringify(body)).toContain('"InventoryItemId":"9007199254740993"')
    }
  )

  it('creates a supply request with documented line fields and exact nested IDs', async () => {
    mocks.request.mockResolvedValueOnce(
      resource('supplyRequests/SR-1', { SupplyOrderReferenceNumber: 'SR-1' })
    )
    const result = await execute('create_supply_request', {
      body: {
        InterfaceBatchNumber: '000123',
        SupplyOrderSource: 'EXT',
        SupplyRequestDate: '2026-09-01T00:00:00Z',
        SupplyRequestStatus: 'SUCCESS',
        TrustedSource: '0',
        ProcessRequestFlag: false,
        supplyRequestLines: [
          {
            InterfaceBatchNumber: '000123',
            ProcessStatus: 'SUCCESS',
            Quantity: 5,
            SupplyType: 'TRANSFER',
            UOMCode: 'Ea',
            ItemId: '9007199254740993',
            DestinationOrganizationCode: 'M1',
          },
        ],
      },
    })
    expect(result.status).toBe(200)
    expect(mocks.request.mock.calls[0][1].address.relativePath).toBe('supplyRequests')
    const wire = serializeOracleFusionJsonBody(mocks.request.mock.calls[0][1].body)
    expect(wire).toContain('"TrustedSource":0')
    expect(wire).toContain('"ItemId":9007199254740993')
    expect(wire).toContain('"InterfaceBatchNumber":"000123"')
    expect(wire).toContain('"ProcessRequestFlag":false')
    expect(wire).not.toContain('SupplyOrderReferenceId')
  })

  it('creates a draft sales order with exact header/product IDs and string source identifiers', async () => {
    mocks.request.mockResolvedValueOnce(
      resource('salesOrdersForOrderHub/EXT%3A0001', { OrderNumber: 'SO-1', SubmittedFlag: false })
    )
    const result = await execute('create_sales_order', {
      body: {
        BusinessUnitId: '9007199254740993',
        SourceTransactionId: '0001',
        SourceTransactionNumber: '0001',
        SourceTransactionSystem: 'EXT',
        SourceTransactionRevisionNumber: '1',
        SubmittedFlag: false,
        lines: [
          {
            OrderedQuantity: 2,
            OrderedUOMCode: 'Ea',
            ProductId: '9007199254740995',
            SourceScheduleNumber: '001',
            SourceTransactionLineId: '0002',
            SourceTransactionLineNumber: '002',
            SourceTransactionScheduleId: '0003',
          },
        ],
      },
    })
    expect(result.status).toBe(200)
    expect((await result.json()).output.salesOrder).toMatchObject({
      salesOrderKey: 'EXT:0001',
      SubmittedFlag: false,
    })
    const wire = serializeOracleFusionJsonBody(mocks.request.mock.calls[0][1].body)
    expect(wire).toContain('"BusinessUnitId":9007199254740993')
    expect(wire).toContain('"ProductId":9007199254740995')
    expect(wire).toContain('"SourceTransactionId":"0001"')
    expect(wire).toContain('"SourceTransactionLineId":"0002"')
  })

  it('deletes without requesting JSON from a documented no-content success', async () => {
    mocks.empty.mockResolvedValueOnce(undefined)
    const result = await execute('delete_sales_order', { salesOrderKey: 'EXT:0001' })
    expect(await result.json()).toEqual({
      success: true,
      output: { deleted: true, salesOrderKey: 'EXT:0001' },
    })
    expect(mocks.empty).toHaveBeenCalledWith(
      expect.objectContaining(toolAuth),
      {
        method: 'DELETE',
        address: { family: 'fscm', relativePath: 'salesOrdersForOrderHub/EXT%3A0001' },
      },
      undefined
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each([
    [
      'pick_release_shipment_lines',
      'pickRelease',
      { processingStatus: 'SUCCESS', message: 'Request submitted' },
    ],
    [
      'confirm_quick_ship_lines',
      'confirm',
      { processingResults: [{ status: 'SUCCESS' }, { message: 'Not eligible' }] },
    ],
  ] as const)(
    'uses the documented %s action body and dynamic result structure',
    async (tool, action, resultMap) => {
      mocks.request.mockResolvedValueOnce({ result: resultMap })
      const body = { details: [{ ShipmentLine: '123' }, { ShipmentLine: '124' }] }
      const result = await execute(tool, { body })
      expect(await result.json()).toEqual({ success: true, output: { result: resultMap } })
      expect(mocks.request.mock.calls[0][1]).toEqual({
        method: 'POST',
        address: { family: 'fscm', relativePath: `shipmentLineChangeRequests/action/${action}` },
        mediaType: 'application/vnd.oracle.adf.action+json',
        body,
      })
    }
  )

  it.each([
    ['update_item', { itemKey: 'item', body: {} }],
    ['update_item', { itemKey: 'item', body: '{invalid json' }],
    ['update_item', { itemKey: 'item', body: { InventedField: true } }],
    [
      'update_supply_request',
      { supplyRequestKey: 'old', body: { SupplyOrderReferenceNumber: null } },
    ],
    [
      'update_transfer_order',
      { transferOrderKey: 'order', body: { Description: 'Not writable here' } },
    ],
    [
      'create_manufacturing_work_order',
      {
        body: {
          InventoryItemId: 9007199254740992,
          PlannedStartQuantity: 1,
          WorkOrderType: 'STANDARD',
        },
      },
    ],
    [
      'create_manufacturing_work_order',
      {
        body: {
          InventoryItemId: '9223372036854775808',
          PlannedStartQuantity: 1,
          WorkOrderType: 'STANDARD',
        },
      },
    ],
    [
      'create_manufacturing_work_order',
      { body: { InventoryItemId: '1', PlannedStartQuantity: 1, WorkOrderTypeCode: 'STANDARD' } },
    ],
    [
      'create_maintenance_work_order',
      { body: { InventoryItemId: '1', PlannedStartQuantity: 1, WorkOrderType: 'STANDARD' } },
    ],
    ['pick_release_shipment_lines', { body: { details: [{ ShipmentLine: 123 }] } }],
    ['confirm_quick_ship_lines', { body: { details: [] } }],
  ] as const)(
    'rejects invalid operation-specific input before calling Oracle: %s',
    async (tool, input) => {
      expect((await execute(tool, input)).status).toBe(400)
      expect(mocks.request).not.toHaveBeenCalled()
      expect(mocks.empty).not.toHaveBeenCalled()
    }
  )

  it('keeps safe provider errors and forwards cancellation without an SCM retry', async () => {
    const controller = new AbortController()
    mocks.request.mockRejectedValueOnce(
      new OracleFusionProviderError('Oracle Fusion service is unavailable', 503)
    )
    expect(
      (
        await execute(
          'update_item',
          { itemKey: 'item', body: { ItemDescription: 'Widget' } },
          controller.signal
        )
      ).status
    ).toBe(503)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][2]).toBe(controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(execute('list_items', {}, controller.signal)).rejects.toThrow('cancelled')
  })
})

describe('SCM operation switching', () => {
  it('maps only the active mutation editor and drops stale keys, query controls, and other bodies', () => {
    const map = OracleFusionScmBlock.tools?.config?.params
    if (!map) throw new Error('Missing SCM block mapper')
    const saved = {
      operation: 'oracle_fusion_scm_update_sales_order',
      oauthCredential: 'credential-1',
      salesOrderKey: 'EXT:0001',
      itemKey: 'stale:item',
      q: 'ItemNumber=OLD',
      limit: 'bad stale value',
      updateItemBody: '{"ItemDescription":"stale"}',
      updateSalesOrderBody: '{"SubmittedFlag":false}',
    }
    const mapped = map(saved)
    const input = oracleFusionScmUpdateSalesOrderTool.operation.input?.({ ...saved, ...mapped })
    expect(input).toEqual({
      oauthCredential: 'credential-1',
      salesOrderKey: 'EXT:0001',
      body: '{"SubmittedFlag":false}',
    })
    const detail = map({
      ...saved,
      operation: 'oracle_fusion_scm_get_item',
      itemKey: ' exact:key ',
    })
    expect(oracleFusionScmGetItemTool.operation.input?.({ ...saved, ...detail })).toEqual({
      oauthCredential: 'credential-1',
      itemKey: ' exact:key ',
    })
    expect(
      oracleFusionScmUpdateItemTool.operation.input?.({
        ...toolAuth,
        itemKey: 'item',
        body: { ItemDescription: 'Widget' },
      })
    ).toEqual({ ...toolAuth, itemKey: 'item', body: { ItemDescription: 'Widget' } })
  })
})
