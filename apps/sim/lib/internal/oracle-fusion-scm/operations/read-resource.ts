import { requestOracleFusionJson } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import {
  type OracleFusionScmDetailInput,
  type OracleFusionScmListInput,
  type OracleFusionScmResource,
  oracleFusionScmResourceFields,
  parseOracleFusionScmDetailInput,
  parseOracleFusionScmListInput,
  parseOracleFusionScmResource,
  projectOracleFusionScmFields,
} from '@/lib/internal/oracle-fusion-scm/schema'
import type { ToolResponse } from '@/tools/types'

interface ResourceDefinition {
  requestCollectionPath: string
  keyField: string
  detailWrapper: string
  parentKeys: readonly string[]
}

export const ORACLE_FUSION_SCM_RESOURCES = {
  inventoryOrganizations: {
    requestCollectionPath: 'inventoryOrganizations',
    keyField: 'organizationKey',
    detailWrapper: 'organization',
    parentKeys: [],
  },
  items: {
    requestCollectionPath: 'itemsV2',
    keyField: 'itemKey',
    detailWrapper: 'item',
    parentKeys: [],
  },
  onHandQuantities: {
    requestCollectionPath: 'onhandQuantityDetails',
    keyField: 'onHandQuantityKey',
    detailWrapper: 'onHandQuantity',
    parentKeys: [],
  },
  inventoryTransactions: {
    requestCollectionPath: 'inventoryCompletedTransactions',
    keyField: 'transactionKey',
    detailWrapper: 'transaction',
    parentKeys: [],
  },
  supplyRequests: {
    requestCollectionPath: 'supplyRequests',
    keyField: 'supplyRequestKey',
    detailWrapper: 'supplyRequest',
    parentKeys: [],
  },
  supplyOrderLines: {
    requestCollectionPath: 'supplyRequests/{supplyRequestKey}/child/supplyOrderLines',
    keyField: 'supplyOrderLineKey',
    detailWrapper: 'supplyOrderLine',
    parentKeys: ['supplyRequestKey'],
  },
  shipments: {
    requestCollectionPath: 'shipments',
    keyField: 'shipmentKey',
    detailWrapper: 'shipment',
    parentKeys: [],
  },
  shipmentLines: {
    requestCollectionPath: 'shipmentLines',
    keyField: 'shipmentLineKey',
    detailWrapper: 'shipmentLine',
    parentKeys: [],
  },
  manufacturingWorkOrders: {
    requestCollectionPath: 'workOrders',
    keyField: 'manufacturingWorkOrderKey',
    detailWrapper: 'manufacturingWorkOrder',
    parentKeys: [],
  },
  maintenanceWorkOrders: {
    requestCollectionPath: 'maintenanceWorkOrders',
    keyField: 'maintenanceWorkOrderKey',
    detailWrapper: 'maintenanceWorkOrder',
    parentKeys: [],
  },
  transferOrders: {
    requestCollectionPath: 'transferOrders',
    keyField: 'transferOrderKey',
    detailWrapper: 'transferOrder',
    parentKeys: [],
  },
  transferOrderLines: {
    requestCollectionPath: 'transferOrders/{transferOrderKey}/child/transferOrderLines',
    keyField: 'transferOrderLineKey',
    detailWrapper: 'transferOrderLine',
    parentKeys: ['transferOrderKey'],
  },
  salesOrders: {
    requestCollectionPath: 'salesOrdersForOrderHub',
    keyField: 'salesOrderKey',
    detailWrapper: 'salesOrder',
    parentKeys: [],
  },
  salesOrderLines: {
    requestCollectionPath: 'salesOrdersForOrderHub/{salesOrderKey}/child/lines',
    keyField: 'salesOrderLineKey',
    detailWrapper: 'salesOrderLine',
    parentKeys: ['salesOrderKey'],
  },
  fulfillmentLineDetails: {
    requestCollectionPath:
      'salesOrdersForOrderHub/{salesOrderKey}/child/lines/{salesOrderLineKey}/child/lineDetails',
    keyField: 'fulfillmentLineDetailKey',
    detailWrapper: 'fulfillmentLineDetail',
    parentKeys: ['salesOrderKey', 'salesOrderLineKey'],
  },
} as const satisfies Record<OracleFusionScmResource, ResourceDefinition>

export interface OracleFusionScmPage {
  items: Array<Record<string, unknown>>
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults?: number
  nextOffset?: number
}

/** Builds only this resource's fixed path, preserving every parent key byte. */
export function oracleFusionScmCollectionPath(
  resource: OracleFusionScmResource,
  input: object
): string {
  const definition: ResourceDefinition = ORACLE_FUSION_SCM_RESOURCES[resource]
  const keys = input as Record<string, unknown>
  return definition.requestCollectionPath.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = keys[key]
    if (typeof value !== 'string') throw new Error('Oracle parent resource key is required')
    return encodeOracleFusionPathSegment(value)
  })
}

export function unexpectedOracleFusionScmResponse<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof OracleFusionProviderError) throw error
    throw new OracleFusionProviderError(
      'Oracle Fusion SCM returned an unexpected response shape',
      502
    )
  }
}

/** Projects a documented resource only after inspecting the original Framework v9 self link. */
export function projectOracleFusionScmResource(
  resource: OracleFusionScmResource,
  value: unknown,
  instanceUrl: string,
  requestCollectionPath: string
): Record<string, unknown> {
  const opaqueKey = extractOracleFusionOpaqueKey(value, instanceUrl, {
    family: 'fscm',
    relativePath: requestCollectionPath,
  })
  const parsed = parseOracleFusionScmResource(resource, value)
  return {
    [ORACLE_FUSION_SCM_RESOURCES[resource].keyField]: opaqueKey,
    ...projectOracleFusionScmFields(parsed, oracleFusionScmResourceFields[resource]),
  }
}

/** Lists exactly one bounded page; continuation is present only when Oracle reports more. */
export async function listOracleFusionScmResource(
  resource: OracleFusionScmResource,
  input: OracleFusionScmListInput,
  signal?: AbortSignal
): Promise<OracleFusionScmPage> {
  if (input.q && input.finder) throw new Error('q and finder cannot be used together')
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error('Oracle Fusion SCM limit must be an integer from 1 to 100')
  }
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
    throw new Error('Oracle Fusion SCM offset must be a non-negative safe integer')
  }
  const relativePath = oracleFusionScmCollectionPath(resource, input)
  const payload = await requestOracleFusionJson(
    input,
    {
      address: { family: 'fscm', relativePath },
      query: {
        fields: oracleFusionScmResourceFields[resource].join(','),
        links: 'self',
        q: input.q,
        finder: input.finder,
        orderBy: input.orderBy,
        limit: input.limit,
        offset: input.offset,
        totalResults: input.totalResults,
      },
    },
    signal
  )
  return unexpectedOracleFusionScmResponse(() => {
    const { nextOffset, ...page } = parseOracleFusionCollection(
      payload,
      (item) => projectOracleFusionScmResource(resource, item, input.instanceUrl, relativePath),
      { expectedOffset: input.offset, maxItems: input.limit }
    )
    if (page.limit > input.limit) throw new Error('Oracle collection exceeds the requested limit')
    return { ...page, ...(page.hasMore ? { nextOffset } : {}) }
  })
}

/** Gets one record using the same keys returned by lists and selectors. */
export async function getOracleFusionScmResource(
  resource: OracleFusionScmResource,
  input: OracleFusionScmDetailInput,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const collection = oracleFusionScmCollectionPath(resource, input)
  const relativePath = `${collection}/${encodeOracleFusionPathSegment(input.key)}`
  const payload = await requestOracleFusionJson(
    input,
    {
      address: { family: 'fscm', relativePath },
      query: { fields: oracleFusionScmResourceFields[resource].join(','), links: 'self' },
    },
    signal
  )
  return unexpectedOracleFusionScmResponse(() => {
    validateOracleFusionSelfLink(payload, input.instanceUrl, { family: 'fscm', relativePath })
    const projected = projectOracleFusionScmResource(
      resource,
      payload,
      input.instanceUrl,
      collection
    )
    if (projected[ORACLE_FUSION_SCM_RESOURCES[resource].keyField] !== input.key) {
      throw new Error('Oracle resource key does not match the requested key')
    }
    return projected
  })
}

interface ReadOperation {
  resource: OracleFusionScmResource
  kind: 'list' | 'detail'
}

const READ_OPERATIONS = {
  oracle_fusion_scm_list_inventory_organizations: {
    resource: 'inventoryOrganizations',
    kind: 'list',
  },
  oracle_fusion_scm_get_inventory_organization: {
    resource: 'inventoryOrganizations',
    kind: 'detail',
  },
  oracle_fusion_scm_list_items: { resource: 'items', kind: 'list' },
  oracle_fusion_scm_get_item: { resource: 'items', kind: 'detail' },
  oracle_fusion_scm_list_on_hand_quantities: { resource: 'onHandQuantities', kind: 'list' },
  oracle_fusion_scm_get_on_hand_quantity: { resource: 'onHandQuantities', kind: 'detail' },
  oracle_fusion_scm_list_inventory_transactions: {
    resource: 'inventoryTransactions',
    kind: 'list',
  },
  oracle_fusion_scm_get_inventory_transaction: {
    resource: 'inventoryTransactions',
    kind: 'detail',
  },
  oracle_fusion_scm_list_supply_requests: { resource: 'supplyRequests', kind: 'list' },
  oracle_fusion_scm_get_supply_request: { resource: 'supplyRequests', kind: 'detail' },
  oracle_fusion_scm_list_supply_order_lines: { resource: 'supplyOrderLines', kind: 'list' },
  oracle_fusion_scm_get_supply_order_line: { resource: 'supplyOrderLines', kind: 'detail' },
  oracle_fusion_scm_list_shipments: { resource: 'shipments', kind: 'list' },
  oracle_fusion_scm_get_shipment: { resource: 'shipments', kind: 'detail' },
  oracle_fusion_scm_list_shipment_lines: { resource: 'shipmentLines', kind: 'list' },
  oracle_fusion_scm_get_shipment_line: { resource: 'shipmentLines', kind: 'detail' },
  oracle_fusion_scm_list_manufacturing_work_orders: {
    resource: 'manufacturingWorkOrders',
    kind: 'list',
  },
  oracle_fusion_scm_get_manufacturing_work_order: {
    resource: 'manufacturingWorkOrders',
    kind: 'detail',
  },
  oracle_fusion_scm_list_maintenance_work_orders: {
    resource: 'maintenanceWorkOrders',
    kind: 'list',
  },
  oracle_fusion_scm_get_maintenance_work_order: {
    resource: 'maintenanceWorkOrders',
    kind: 'detail',
  },
  oracle_fusion_scm_list_transfer_orders: { resource: 'transferOrders', kind: 'list' },
  oracle_fusion_scm_get_transfer_order: { resource: 'transferOrders', kind: 'detail' },
  oracle_fusion_scm_list_transfer_order_lines: { resource: 'transferOrderLines', kind: 'list' },
  oracle_fusion_scm_get_transfer_order_line: { resource: 'transferOrderLines', kind: 'detail' },
  oracle_fusion_scm_list_sales_orders: { resource: 'salesOrders', kind: 'list' },
  oracle_fusion_scm_get_sales_order: { resource: 'salesOrders', kind: 'detail' },
  oracle_fusion_scm_list_sales_order_lines: { resource: 'salesOrderLines', kind: 'list' },
  oracle_fusion_scm_get_sales_order_line: { resource: 'salesOrderLines', kind: 'detail' },
  oracle_fusion_scm_list_fulfillment_line_details: {
    resource: 'fulfillmentLineDetails',
    kind: 'list',
  },
  oracle_fusion_scm_get_fulfillment_line_detail: {
    resource: 'fulfillmentLineDetails',
    kind: 'detail',
  },
} as const satisfies Record<string, ReadOperation>

export type OracleFusionScmReadToolId = keyof typeof READ_OPERATIONS

export function isOracleFusionScmReadToolId(value: string): value is OracleFusionScmReadToolId {
  return Object.hasOwn(READ_OPERATIONS, value)
}

export async function executeOracleFusionScmReadOperation(
  toolId: OracleFusionScmReadToolId,
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const operation = READ_OPERATIONS[toolId]
  const definition = ORACLE_FUSION_SCM_RESOURCES[operation.resource]
  if (operation.kind === 'list') {
    const input = parseOracleFusionScmListInput(rawInput, {
      finder: true,
      parentKeys: definition.parentKeys,
    })
    return {
      success: true,
      output: await listOracleFusionScmResource(operation.resource, input, signal),
    }
  }
  const input = parseOracleFusionScmDetailInput(
    rawInput,
    definition.keyField,
    definition.parentKeys
  )
  const item = await getOracleFusionScmResource(operation.resource, input, signal)
  return { success: true, output: { [definition.detailWrapper]: item } }
}
