import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'

const LIST_OPERATIONS = [
  'oracle_fusion_scm_list_inventory_organizations',
  'oracle_fusion_scm_list_items',
  'oracle_fusion_scm_list_on_hand_quantities',
  'oracle_fusion_scm_list_inventory_transactions',
  'oracle_fusion_scm_list_supply_requests',
  'oracle_fusion_scm_list_supply_order_lines',
  'oracle_fusion_scm_list_shipments',
  'oracle_fusion_scm_list_shipment_lines',
  'oracle_fusion_scm_list_manufacturing_work_orders',
  'oracle_fusion_scm_list_maintenance_work_orders',
  'oracle_fusion_scm_list_transfer_orders',
  'oracle_fusion_scm_list_transfer_order_lines',
  'oracle_fusion_scm_list_sales_orders',
  'oracle_fusion_scm_list_sales_order_lines',
  'oracle_fusion_scm_list_fulfillment_line_details',
]

const FINDER_OPERATIONS = LIST_OPERATIONS

const OPERATION_KEYS: Record<string, readonly string[]> = {
  oracle_fusion_scm_list_inventory_organizations: [],
  oracle_fusion_scm_get_inventory_organization: ['organizationKey'],
  oracle_fusion_scm_list_items: [],
  oracle_fusion_scm_get_item: ['itemKey'],
  oracle_fusion_scm_list_on_hand_quantities: [],
  oracle_fusion_scm_get_on_hand_quantity: ['onHandQuantityKey'],
  oracle_fusion_scm_list_inventory_transactions: [],
  oracle_fusion_scm_get_inventory_transaction: ['transactionKey'],
  oracle_fusion_scm_list_supply_requests: [],
  oracle_fusion_scm_get_supply_request: ['supplyRequestKey'],
  oracle_fusion_scm_list_supply_order_lines: ['supplyRequestKey'],
  oracle_fusion_scm_get_supply_order_line: ['supplyRequestKey', 'supplyOrderLineKey'],
  oracle_fusion_scm_list_shipments: [],
  oracle_fusion_scm_get_shipment: ['shipmentKey'],
  oracle_fusion_scm_list_shipment_lines: [],
  oracle_fusion_scm_get_shipment_line: ['shipmentLineKey'],
  oracle_fusion_scm_list_manufacturing_work_orders: [],
  oracle_fusion_scm_get_manufacturing_work_order: ['manufacturingWorkOrderKey'],
  oracle_fusion_scm_list_maintenance_work_orders: [],
  oracle_fusion_scm_get_maintenance_work_order: ['maintenanceWorkOrderKey'],
  oracle_fusion_scm_list_transfer_orders: [],
  oracle_fusion_scm_get_transfer_order: ['transferOrderKey'],
  oracle_fusion_scm_list_transfer_order_lines: ['transferOrderKey'],
  oracle_fusion_scm_get_transfer_order_line: ['transferOrderKey', 'transferOrderLineKey'],
  oracle_fusion_scm_list_sales_orders: [],
  oracle_fusion_scm_get_sales_order: ['salesOrderKey'],
  oracle_fusion_scm_list_sales_order_lines: ['salesOrderKey'],
  oracle_fusion_scm_get_sales_order_line: ['salesOrderKey', 'salesOrderLineKey'],
  oracle_fusion_scm_list_fulfillment_line_details: ['salesOrderKey', 'salesOrderLineKey'],
  oracle_fusion_scm_get_fulfillment_line_detail: [
    'salesOrderKey',
    'salesOrderLineKey',
    'fulfillmentLineDetailKey',
  ],
  oracle_fusion_scm_update_item: ['itemKey'],
  oracle_fusion_scm_create_supply_request: [],
  oracle_fusion_scm_update_supply_request: ['supplyRequestKey'],
  oracle_fusion_scm_update_transfer_order: ['transferOrderKey'],
  oracle_fusion_scm_update_transfer_order_line: ['transferOrderKey', 'transferOrderLineKey'],
  oracle_fusion_scm_create_manufacturing_work_order: [],
  oracle_fusion_scm_update_manufacturing_work_order: ['manufacturingWorkOrderKey'],
  oracle_fusion_scm_create_maintenance_work_order: [],
  oracle_fusion_scm_update_maintenance_work_order: ['maintenanceWorkOrderKey'],
  oracle_fusion_scm_create_sales_order: [],
  oracle_fusion_scm_update_sales_order: ['salesOrderKey'],
  oracle_fusion_scm_delete_sales_order: ['salesOrderKey'],
  oracle_fusion_scm_pick_release_shipment_lines: [],
  oracle_fusion_scm_confirm_quick_ship_lines: [],
}

/** Like SAP S/4HANA's operation-specific body editors, inactive bodies never become tool inputs. */
const OPERATION_BODY_FIELDS: Record<string, string> = {
  oracle_fusion_scm_update_item: 'updateItemBody',
  oracle_fusion_scm_create_supply_request: 'createSupplyRequestBody',
  oracle_fusion_scm_update_supply_request: 'updateSupplyRequestBody',
  oracle_fusion_scm_update_transfer_order: 'updateTransferOrderBody',
  oracle_fusion_scm_update_transfer_order_line: 'updateTransferOrderLineBody',
  oracle_fusion_scm_create_manufacturing_work_order: 'createManufacturingWorkOrderBody',
  oracle_fusion_scm_update_manufacturing_work_order: 'updateManufacturingWorkOrderBody',
  oracle_fusion_scm_create_maintenance_work_order: 'createMaintenanceWorkOrderBody',
  oracle_fusion_scm_update_maintenance_work_order: 'updateMaintenanceWorkOrderBody',
  oracle_fusion_scm_create_sales_order: 'createSalesOrderBody',
  oracle_fusion_scm_update_sales_order: 'updateSalesOrderBody',
  oracle_fusion_scm_pick_release_shipment_lines: 'pickReleaseShipmentLinesBody',
  oracle_fusion_scm_confirm_quick_ship_lines: 'confirmQuickShipLinesBody',
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value.trim() || undefined
}

export const OracleFusionScmBlock: BlockConfig = {
  type: 'oracle_fusion_scm',
  name: 'Oracle Fusion Cloud SCM',
  description:
    'Manage Oracle Fusion inventory, supply, transfer, work orders, shipping, and sales orders',
  longDescription:
    'Connect an Oracle Fusion service account for bounded resource discovery, detailed reads, and focused updates across inventory, supply requests, transfer orders, manufacturing and maintenance work orders, fulfillment, shipments, and order management. Lists return one page and Oracle-derived keys. Shipment actions return Oracle processing results that must be inspected for business errors; pick release schedules a Release Pick Wave process. Oracle permissions, enabled features, and lifecycle rules apply. No native triggers are included.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_scm',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Cloud SCM',
    sentences: {
      byOperation: {
        oracle_fusion_scm_list_inventory_organizations: [
          'List Inventory Organizations',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_inventory_organization: [
          {
            text: 'Get Inventory Organization',
            field: ['inventoryOrganizationSelector', 'organizationKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_items: [
          'List Items',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_item: [
          { text: 'Get Item', field: ['itemSelector', 'itemKeyManual'], core: true },
        ],
        oracle_fusion_scm_list_on_hand_quantities: [
          'List On Hand Quantities',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_on_hand_quantity: [
          { text: 'Get On Hand Quantity', field: 'onHandQuantityKey', core: true },
        ],
        oracle_fusion_scm_list_inventory_transactions: [
          'List Inventory Transactions',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_inventory_transaction: [
          { text: 'Get Inventory Transaction', field: 'transactionKey', core: true },
        ],
        oracle_fusion_scm_list_supply_requests: [
          'List Supply Requests',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_supply_request: [
          {
            text: 'Get Supply Request',
            field: ['supplyRequestSelector', 'supplyRequestKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_supply_order_lines: [
          'List Supply Order Lines',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_supply_order_line: [
          {
            text: 'Get Supply Order Line',
            field: ['supplyOrderLineSelector', 'supplyOrderLineKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_shipments: [
          'List Shipments',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_shipment: [
          { text: 'Get Shipment', field: ['shipmentSelector', 'shipmentKeyManual'], core: true },
        ],
        oracle_fusion_scm_list_shipment_lines: [
          'List Shipment Lines',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_shipment_line: [
          {
            text: 'Get Shipment Line',
            field: ['shipmentLineSelector', 'shipmentLineKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_manufacturing_work_orders: [
          'List Manufacturing Work Orders',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_manufacturing_work_order: [
          {
            text: 'Get Manufacturing Work Order',
            field: ['manufacturingWorkOrderSelector', 'manufacturingWorkOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_maintenance_work_orders: [
          'List Maintenance Work Orders',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_maintenance_work_order: [
          {
            text: 'Get Maintenance Work Order',
            field: ['maintenanceWorkOrderSelector', 'maintenanceWorkOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_transfer_orders: [
          'List Transfer Orders',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_transfer_order: [
          {
            text: 'Get Transfer Order',
            field: ['transferOrderSelector', 'transferOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_transfer_order_lines: [
          'List Transfer Order Lines',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_transfer_order_line: [
          {
            text: 'Get Transfer Order Line',
            field: ['transferOrderLineSelector', 'transferOrderLineKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_sales_orders: [
          'List Sales Orders',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_sales_order: [
          {
            text: 'Get Sales Order',
            field: ['salesOrderSelector', 'salesOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_sales_order_lines: [
          'List Sales Order Lines',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_sales_order_line: [
          {
            text: 'Get Sales Order Line',
            field: ['salesOrderLineSelector', 'salesOrderLineKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_list_fulfillment_line_details: [
          'List Fulfillment Line Details',
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_scm_get_fulfillment_line_detail: [
          { text: 'Get Fulfillment Line Detail', field: 'fulfillmentLineDetailKey', core: true },
        ],
        oracle_fusion_scm_update_item: [
          { text: 'Update Item', field: ['itemSelector', 'itemKeyManual'], core: true },
        ],
        oracle_fusion_scm_create_supply_request: ['Create Supply Request'],
        oracle_fusion_scm_update_supply_request: [
          {
            text: 'Update Supply Request',
            field: ['supplyRequestSelector', 'supplyRequestKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_update_transfer_order: [
          {
            text: 'Update Transfer Order',
            field: ['transferOrderSelector', 'transferOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_update_transfer_order_line: [
          {
            text: 'Update Transfer Order Line',
            field: ['transferOrderLineSelector', 'transferOrderLineKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_create_manufacturing_work_order: ['Create Manufacturing Work Order'],
        oracle_fusion_scm_update_manufacturing_work_order: [
          {
            text: 'Update Manufacturing Work Order',
            field: ['manufacturingWorkOrderSelector', 'manufacturingWorkOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_create_maintenance_work_order: ['Create Maintenance Work Order'],
        oracle_fusion_scm_update_maintenance_work_order: [
          {
            text: 'Update Maintenance Work Order',
            field: ['maintenanceWorkOrderSelector', 'maintenanceWorkOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_create_sales_order: ['Create Sales Order'],
        oracle_fusion_scm_update_sales_order: [
          {
            text: 'Update Sales Order',
            field: ['salesOrderSelector', 'salesOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_delete_sales_order: [
          {
            text: 'Delete Sales Order',
            field: ['salesOrderSelector', 'salesOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_scm_pick_release_shipment_lines: ['Pick Release Shipment Lines'],
        oracle_fusion_scm_confirm_quick_ship_lines: ['Confirm Quick Ship Lines'],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Oracle Fusion Account',
      type: 'oauth-input',
      serviceId: 'oracle_fusion_scm',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle Fusion credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle Fusion Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        {
          label: 'List Inventory Organizations',
          id: 'oracle_fusion_scm_list_inventory_organizations',
        },
        { label: 'Get Inventory Organization', id: 'oracle_fusion_scm_get_inventory_organization' },
        { label: 'List Items', id: 'oracle_fusion_scm_list_items' },
        { label: 'Get Item', id: 'oracle_fusion_scm_get_item' },
        { label: 'List On Hand Quantities', id: 'oracle_fusion_scm_list_on_hand_quantities' },
        { label: 'Get On Hand Quantity', id: 'oracle_fusion_scm_get_on_hand_quantity' },
        {
          label: 'List Inventory Transactions',
          id: 'oracle_fusion_scm_list_inventory_transactions',
        },
        { label: 'Get Inventory Transaction', id: 'oracle_fusion_scm_get_inventory_transaction' },
        { label: 'List Supply Requests', id: 'oracle_fusion_scm_list_supply_requests' },
        { label: 'Get Supply Request', id: 'oracle_fusion_scm_get_supply_request' },
        { label: 'List Supply Order Lines', id: 'oracle_fusion_scm_list_supply_order_lines' },
        { label: 'Get Supply Order Line', id: 'oracle_fusion_scm_get_supply_order_line' },
        { label: 'List Shipments', id: 'oracle_fusion_scm_list_shipments' },
        { label: 'Get Shipment', id: 'oracle_fusion_scm_get_shipment' },
        { label: 'List Shipment Lines', id: 'oracle_fusion_scm_list_shipment_lines' },
        { label: 'Get Shipment Line', id: 'oracle_fusion_scm_get_shipment_line' },
        {
          label: 'List Manufacturing Work Orders',
          id: 'oracle_fusion_scm_list_manufacturing_work_orders',
        },
        {
          label: 'Get Manufacturing Work Order',
          id: 'oracle_fusion_scm_get_manufacturing_work_order',
        },
        {
          label: 'List Maintenance Work Orders',
          id: 'oracle_fusion_scm_list_maintenance_work_orders',
        },
        { label: 'Get Maintenance Work Order', id: 'oracle_fusion_scm_get_maintenance_work_order' },
        { label: 'List Transfer Orders', id: 'oracle_fusion_scm_list_transfer_orders' },
        { label: 'Get Transfer Order', id: 'oracle_fusion_scm_get_transfer_order' },
        { label: 'List Transfer Order Lines', id: 'oracle_fusion_scm_list_transfer_order_lines' },
        { label: 'Get Transfer Order Line', id: 'oracle_fusion_scm_get_transfer_order_line' },
        { label: 'List Sales Orders', id: 'oracle_fusion_scm_list_sales_orders' },
        { label: 'Get Sales Order', id: 'oracle_fusion_scm_get_sales_order' },
        { label: 'List Sales Order Lines', id: 'oracle_fusion_scm_list_sales_order_lines' },
        { label: 'Get Sales Order Line', id: 'oracle_fusion_scm_get_sales_order_line' },
        {
          label: 'List Fulfillment Line Details',
          id: 'oracle_fusion_scm_list_fulfillment_line_details',
        },
        {
          label: 'Get Fulfillment Line Detail',
          id: 'oracle_fusion_scm_get_fulfillment_line_detail',
        },
        { label: 'Update Item', id: 'oracle_fusion_scm_update_item' },
        { label: 'Create Supply Request', id: 'oracle_fusion_scm_create_supply_request' },
        { label: 'Update Supply Request', id: 'oracle_fusion_scm_update_supply_request' },
        { label: 'Update Transfer Order', id: 'oracle_fusion_scm_update_transfer_order' },
        { label: 'Update Transfer Order Line', id: 'oracle_fusion_scm_update_transfer_order_line' },
        {
          label: 'Create Manufacturing Work Order',
          id: 'oracle_fusion_scm_create_manufacturing_work_order',
        },
        {
          label: 'Update Manufacturing Work Order',
          id: 'oracle_fusion_scm_update_manufacturing_work_order',
        },
        {
          label: 'Create Maintenance Work Order',
          id: 'oracle_fusion_scm_create_maintenance_work_order',
        },
        {
          label: 'Update Maintenance Work Order',
          id: 'oracle_fusion_scm_update_maintenance_work_order',
        },
        { label: 'Create Sales Order', id: 'oracle_fusion_scm_create_sales_order' },
        { label: 'Update Sales Order', id: 'oracle_fusion_scm_update_sales_order' },
        { label: 'Delete Sales Order', id: 'oracle_fusion_scm_delete_sales_order' },
        {
          label: 'Pick Release Shipment Lines',
          id: 'oracle_fusion_scm_pick_release_shipment_lines',
        },
        { label: 'Confirm Quick Ship Lines', id: 'oracle_fusion_scm_confirm_quick_ship_lines' },
      ],
      value: () => 'oracle_fusion_scm_list_inventory_organizations',
      required: true,
    },
    {
      id: 'inventoryOrganizationSelector',
      title: 'Inventory Organization',
      type: 'project-selector',
      canonicalParamId: 'organizationKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.inventoryOrganizations',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select inventory organization',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_inventory_organization'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_inventory_organization'] },
    },
    {
      id: 'organizationKeyManual',
      title: 'Inventory Organization Key',
      type: 'short-input',
      canonicalParamId: 'organizationKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_inventory_organization'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_inventory_organization'] },
    },
    {
      id: 'itemSelector',
      title: 'Item',
      type: 'project-selector',
      canonicalParamId: 'itemKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.items',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select item',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_scm_get_item', 'oracle_fusion_scm_update_item'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_scm_get_item', 'oracle_fusion_scm_update_item'],
      },
    },
    {
      id: 'itemKeyManual',
      title: 'Item Key',
      type: 'short-input',
      canonicalParamId: 'itemKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_scm_get_item', 'oracle_fusion_scm_update_item'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_scm_get_item', 'oracle_fusion_scm_update_item'],
      },
    },
    {
      id: 'onHandQuantityKey',
      title: 'On Hand Quantity Key',
      type: 'short-input',
      placeholder: 'Oracle-derived opaque key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_on_hand_quantity'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_on_hand_quantity'] },
    },
    {
      id: 'transactionKey',
      title: 'Inventory Transaction Key',
      type: 'short-input',
      placeholder: 'Oracle-derived opaque key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_inventory_transaction'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_inventory_transaction'] },
    },
    {
      id: 'supplyRequestSelector',
      title: 'Supply Request',
      type: 'project-selector',
      canonicalParamId: 'supplyRequestKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.supplyRequests',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select supply request',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_supply_request',
          'oracle_fusion_scm_list_supply_order_lines',
          'oracle_fusion_scm_get_supply_order_line',
          'oracle_fusion_scm_update_supply_request',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_supply_request',
          'oracle_fusion_scm_list_supply_order_lines',
          'oracle_fusion_scm_get_supply_order_line',
          'oracle_fusion_scm_update_supply_request',
        ],
      },
    },
    {
      id: 'supplyRequestKeyManual',
      title: 'Supply Request Key',
      type: 'short-input',
      canonicalParamId: 'supplyRequestKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_supply_request',
          'oracle_fusion_scm_list_supply_order_lines',
          'oracle_fusion_scm_get_supply_order_line',
          'oracle_fusion_scm_update_supply_request',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_supply_request',
          'oracle_fusion_scm_list_supply_order_lines',
          'oracle_fusion_scm_get_supply_order_line',
          'oracle_fusion_scm_update_supply_request',
        ],
      },
    },
    {
      id: 'supplyOrderLineSelector',
      title: 'Supply Order Line',
      type: 'project-selector',
      canonicalParamId: 'supplyOrderLineKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.supplyOrderLines',
      dependsOn: ['oauthCredential', 'supplyRequestKey'],
      mode: 'basic',
      placeholder: 'Select supply order line',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_supply_order_line'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_supply_order_line'] },
    },
    {
      id: 'supplyOrderLineKeyManual',
      title: 'Supply Order Line Key',
      type: 'short-input',
      canonicalParamId: 'supplyOrderLineKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_supply_order_line'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_supply_order_line'] },
    },
    {
      id: 'shipmentSelector',
      title: 'Shipment',
      type: 'project-selector',
      canonicalParamId: 'shipmentKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.shipments',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select shipment',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_shipment'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_shipment'] },
    },
    {
      id: 'shipmentKeyManual',
      title: 'Shipment Key',
      type: 'short-input',
      canonicalParamId: 'shipmentKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_shipment'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_shipment'] },
    },
    {
      id: 'shipmentLineSelector',
      title: 'Shipment Line',
      type: 'project-selector',
      canonicalParamId: 'shipmentLineKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.shipmentLines',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select shipment line',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_shipment_line'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_shipment_line'] },
    },
    {
      id: 'shipmentLineKeyManual',
      title: 'Shipment Line Key',
      type: 'short-input',
      canonicalParamId: 'shipmentLineKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_shipment_line'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_shipment_line'] },
    },
    {
      id: 'manufacturingWorkOrderSelector',
      title: 'Manufacturing Work Order',
      type: 'project-selector',
      canonicalParamId: 'manufacturingWorkOrderKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.manufacturingWorkOrders',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select manufacturing work order',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_manufacturing_work_order',
          'oracle_fusion_scm_update_manufacturing_work_order',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_manufacturing_work_order',
          'oracle_fusion_scm_update_manufacturing_work_order',
        ],
      },
    },
    {
      id: 'manufacturingWorkOrderKeyManual',
      title: 'Manufacturing Work Order Key',
      type: 'short-input',
      canonicalParamId: 'manufacturingWorkOrderKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_manufacturing_work_order',
          'oracle_fusion_scm_update_manufacturing_work_order',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_manufacturing_work_order',
          'oracle_fusion_scm_update_manufacturing_work_order',
        ],
      },
    },
    {
      id: 'maintenanceWorkOrderSelector',
      title: 'Maintenance Work Order',
      type: 'project-selector',
      canonicalParamId: 'maintenanceWorkOrderKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.maintenanceWorkOrders',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select maintenance work order',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_maintenance_work_order',
          'oracle_fusion_scm_update_maintenance_work_order',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_maintenance_work_order',
          'oracle_fusion_scm_update_maintenance_work_order',
        ],
      },
    },
    {
      id: 'maintenanceWorkOrderKeyManual',
      title: 'Maintenance Work Order Key',
      type: 'short-input',
      canonicalParamId: 'maintenanceWorkOrderKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_maintenance_work_order',
          'oracle_fusion_scm_update_maintenance_work_order',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_maintenance_work_order',
          'oracle_fusion_scm_update_maintenance_work_order',
        ],
      },
    },
    {
      id: 'transferOrderSelector',
      title: 'Transfer Order',
      type: 'project-selector',
      canonicalParamId: 'transferOrderKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.transferOrders',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select transfer order',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order',
          'oracle_fusion_scm_list_transfer_order_lines',
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order',
          'oracle_fusion_scm_list_transfer_order_lines',
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
    },
    {
      id: 'transferOrderKeyManual',
      title: 'Transfer Order Key',
      type: 'short-input',
      canonicalParamId: 'transferOrderKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order',
          'oracle_fusion_scm_list_transfer_order_lines',
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order',
          'oracle_fusion_scm_list_transfer_order_lines',
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
    },
    {
      id: 'transferOrderLineSelector',
      title: 'Transfer Order Line',
      type: 'project-selector',
      canonicalParamId: 'transferOrderLineKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.transferOrderLines',
      dependsOn: ['oauthCredential', 'transferOrderKey'],
      mode: 'basic',
      placeholder: 'Select transfer order line',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
    },
    {
      id: 'transferOrderLineKeyManual',
      title: 'Transfer Order Line Key',
      type: 'short-input',
      canonicalParamId: 'transferOrderLineKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
    },
    {
      id: 'salesOrderSelector',
      title: 'Sales Order',
      type: 'project-selector',
      canonicalParamId: 'salesOrderKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.salesOrders',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select sales order',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order',
          'oracle_fusion_scm_list_sales_order_lines',
          'oracle_fusion_scm_get_sales_order_line',
          'oracle_fusion_scm_list_fulfillment_line_details',
          'oracle_fusion_scm_get_fulfillment_line_detail',
          'oracle_fusion_scm_update_sales_order',
          'oracle_fusion_scm_delete_sales_order',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order',
          'oracle_fusion_scm_list_sales_order_lines',
          'oracle_fusion_scm_get_sales_order_line',
          'oracle_fusion_scm_list_fulfillment_line_details',
          'oracle_fusion_scm_get_fulfillment_line_detail',
          'oracle_fusion_scm_update_sales_order',
          'oracle_fusion_scm_delete_sales_order',
        ],
      },
    },
    {
      id: 'salesOrderKeyManual',
      title: 'Sales Order Key',
      type: 'short-input',
      canonicalParamId: 'salesOrderKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order',
          'oracle_fusion_scm_list_sales_order_lines',
          'oracle_fusion_scm_get_sales_order_line',
          'oracle_fusion_scm_list_fulfillment_line_details',
          'oracle_fusion_scm_get_fulfillment_line_detail',
          'oracle_fusion_scm_update_sales_order',
          'oracle_fusion_scm_delete_sales_order',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order',
          'oracle_fusion_scm_list_sales_order_lines',
          'oracle_fusion_scm_get_sales_order_line',
          'oracle_fusion_scm_list_fulfillment_line_details',
          'oracle_fusion_scm_get_fulfillment_line_detail',
          'oracle_fusion_scm_update_sales_order',
          'oracle_fusion_scm_delete_sales_order',
        ],
      },
    },
    {
      id: 'salesOrderLineSelector',
      title: 'Sales Order Line',
      type: 'project-selector',
      canonicalParamId: 'salesOrderLineKey',
      serviceId: 'oracle_fusion_scm',
      selectorKey: 'oracleFusionScm.salesOrderLines',
      dependsOn: ['oauthCredential', 'salesOrderKey'],
      mode: 'basic',
      placeholder: 'Select sales order line',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order_line',
          'oracle_fusion_scm_list_fulfillment_line_details',
          'oracle_fusion_scm_get_fulfillment_line_detail',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order_line',
          'oracle_fusion_scm_list_fulfillment_line_details',
          'oracle_fusion_scm_get_fulfillment_line_detail',
        ],
      },
    },
    {
      id: 'salesOrderLineKeyManual',
      title: 'Sales Order Line Key',
      type: 'short-input',
      canonicalParamId: 'salesOrderLineKey',
      mode: 'advanced',
      placeholder: 'Oracle-derived opaque key (preserved exactly)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order_line',
          'oracle_fusion_scm_list_fulfillment_line_details',
          'oracle_fusion_scm_get_fulfillment_line_detail',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order_line',
          'oracle_fusion_scm_list_fulfillment_line_details',
          'oracle_fusion_scm_get_fulfillment_line_detail',
        ],
      },
    },
    {
      id: 'fulfillmentLineDetailKey',
      title: 'Fulfillment Line Detail Key',
      type: 'short-input',
      placeholder: 'Oracle-derived opaque key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_fulfillment_line_detail'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_get_fulfillment_line_detail'] },
    },
    {
      id: 'q',
      title: 'Filter',
      type: 'long-input',
      placeholder: 'Oracle REST Framework q expression',
      wandConfig: {
        enabled: true,
        prompt: `Generate an Oracle Fusion Cloud SCM REST Framework q filter from the user's request.

Rules:
- Use only attributes documented by Oracle for the selected collection
- Preserve Oracle attribute capitalization
- Follow Oracle REST Framework expression syntax
- Do not include q=, URL encoding, fields, links, expand, or explanatory text

Return ONLY the q filter expression - no explanations or extra text.`,
        placeholder: 'Describe the SCM records to filter',
      },
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'finder',
      title: 'Finder',
      type: 'long-input',
      placeholder: 'FinderName;Variable=Value',
      mode: 'advanced',
      condition: { field: 'operation', value: FINDER_OPERATIONS },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'Attribute:desc',
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50 (maximum 100)',
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'totalResults',
      title: 'Include Total Results',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'updateItemBody',
      title: 'Update Item Body',
      type: 'code',
      language: 'json',
      placeholder: '{"ItemDescription":""}',
      description:
        'JSON object. Supported fields: ItemDescription, LongDescription, ItemStatusValue, LifecyclePhaseValue, PrimaryUOMValue, SecondaryUOMValue, InventoryItemFlag, StockEnabledFlag, ShippableFlag, BuildInWIPFlag, LotControlValue, SerialGenerationValue. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_update_item'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_update_item'] },
    },
    {
      id: 'createSupplyRequestBody',
      title: 'Create Supply Request Body',
      type: 'code',
      language: 'json',
      placeholder:
        '{"InterfaceBatchNumber":"BATCH-1","SupplyOrderSource":"YOUR_SOURCE","SupplyRequestDate":"2026-09-01T00:00:00Z","SupplyRequestStatus":"SUCCESS","TrustedSource":"0","ProcessRequestFlag":false,"supplyRequestLines":[{"InterfaceBatchNumber":"BATCH-1","ProcessStatus":"SUCCESS","Quantity":1,"SupplyType":"TRANSFER","UOMCode":"Ea","ItemId":"123","DestinationOrganizationCode":"M1"}]}',
      description:
        'JSON object. Supported fields: InterfaceBatchNumber, InterfaceSourceCode, SupplyOrderSource, SupplyRequestDate, SupplyRequestStatus, TrustedSource, SupplyOrderReferenceId, SupplyOrderReferenceNumber, ProcessRequestFlag, AllowPartialRequestFlag, supplyRequestLines. Required: InterfaceBatchNumber, SupplyOrderSource, SupplyRequestDate, SupplyRequestStatus, TrustedSource, and a non-empty supplyRequestLines array. supplyRequestLines: up to 100 objects with InterfaceBatchNumber, ProcessStatus, Quantity, SupplyType, UOMCode, ItemId, ItemNumber, SupplyOrderReferenceLineId, SupplyOrderReferenceLineNumber, NeedByDate, RequestedShipDate, SourceOrganizationId, SourceOrganizationCode, SourceSubinventoryCode, DestinationOrganizationId, DestinationOrganizationCode, DestinationSubinventoryCode, DestinationTypeCode, SupplyOperation, Comments. Each requires InterfaceBatchNumber, ProcessStatus, Quantity, SupplyType, UOMCode. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_create_supply_request'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_create_supply_request'] },
    },
    {
      id: 'updateSupplyRequestBody',
      title: 'Update Supply Request Body',
      type: 'code',
      language: 'json',
      placeholder: '{"SupplyOrderReferenceId":""}',
      description:
        'JSON object. SupplyOrderReferenceNumber can rename the request and returns its new key; clearing it with null is not supported. Supported fields: SupplyOrderReferenceId, SupplyOrderReferenceNumber, ProcessRequestFlag, AllowPartialRequestFlag, TrustedSource, TransferCostAmount, TransferCostCurrencyCode, TransferCostTypeName, supplyRequestLines. Provide at least one field. supplyRequestLines: up to 100 objects with InterfaceBatchNumber, ProcessStatus, Quantity, SupplyType, UOMCode, ItemId, ItemNumber, SupplyOrderReferenceLineId, SupplyOrderReferenceLineNumber, NeedByDate, RequestedShipDate, SourceOrganizationId, SourceOrganizationCode, SourceSubinventoryCode, DestinationOrganizationId, DestinationOrganizationCode, DestinationSubinventoryCode, DestinationTypeCode, SupplyOperation, Comments. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_update_supply_request'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_update_supply_request'] },
    },
    {
      id: 'updateTransferOrderBody',
      title: 'Update Transfer Order Body',
      type: 'code',
      language: 'json',
      placeholder: '{"MessageText":""}',
      description:
        'JSON object. Supported fields: MessageText. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_update_transfer_order'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_update_transfer_order'] },
    },
    {
      id: 'updateTransferOrderLineBody',
      title: 'Update Transfer Order Line Body',
      type: 'code',
      language: 'json',
      placeholder: '{"Action":""}',
      description:
        'JSON object. Supported fields: Action, RequestedQuantity, SecondaryRequestedQuantity, NeedByDate, ScheduledShipDate, Comments, SourceOrganizationId, SourceOrganizationCode, SourceSubinventoryCode, DestinationSubinventoryCode, SourceLocatorId, DestinationLocatorId, NoteToReceiver, NoteToSupplier, ShipmentPriority. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_update_transfer_order_line'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_update_transfer_order_line'] },
    },
    {
      id: 'createManufacturingWorkOrderBody',
      title: 'Create Manufacturing Work Order Body',
      type: 'code',
      language: 'json',
      placeholder: '{"InventoryItemId":"","PlannedStartQuantity":1,"WorkOrderType":""}',
      description:
        'JSON object. Supported fields: InventoryItemId, PlannedStartQuantity, WorkOrderType, OrganizationId, OrganizationCode, WorkOrderNumber, WorkOrderDescription, WorkOrderStatusCode, WorkOrderSubType, WorkOrderPriority, PlannedStartDate, PlannedCompletionDate, WorkDefinitionId, WorkDefinitionCode, SupplyType. Required: InventoryItemId, PlannedStartQuantity, WorkOrderType. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_scm_create_manufacturing_work_order'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_scm_create_manufacturing_work_order'],
      },
    },
    {
      id: 'updateManufacturingWorkOrderBody',
      title: 'Update Manufacturing Work Order Body',
      type: 'code',
      language: 'json',
      placeholder: '{"PlannedStartQuantity":""}',
      description:
        'JSON object. Supported fields: PlannedStartQuantity, WorkOrderDescription, WorkOrderStatusCode, WorkOrderSubType, WorkOrderPriority, PlannedStartDate, PlannedCompletionDate, WorkDefinitionId, WorkDefinitionCode, SupplyType. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_scm_update_manufacturing_work_order'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_scm_update_manufacturing_work_order'],
      },
    },
    {
      id: 'createMaintenanceWorkOrderBody',
      title: 'Create Maintenance Work Order Body',
      type: 'code',
      language: 'json',
      placeholder:
        '{"InventoryItemId":"","PlannedStartQuantity":1,"UOMCode":"","WorkOrderTypeCode":""}',
      description:
        'JSON object. Supported fields: InventoryItemId, PlannedStartQuantity, UOMCode, WorkOrderTypeCode, OrganizationId, OrganizationCode, WorkOrderNumber, WorkOrderDescription, WorkOrderStatusCode, WorkOrderSubTypeCode, WorkOrderPriority, PlannedStartDate, PlannedCompletionDate, WorkDefinitionId, AssetId, AssetNumber. Required: InventoryItemId, PlannedStartQuantity, UOMCode, WorkOrderTypeCode. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_create_maintenance_work_order'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_create_maintenance_work_order'] },
    },
    {
      id: 'updateMaintenanceWorkOrderBody',
      title: 'Update Maintenance Work Order Body',
      type: 'code',
      language: 'json',
      placeholder: '{"PlannedStartQuantity":""}',
      description:
        'JSON object. Supported fields: PlannedStartQuantity, UOMCode, WorkOrderDescription, WorkOrderStatusCode, WorkOrderSubTypeCode, WorkOrderPriority, PlannedStartDate, PlannedCompletionDate, WorkDefinitionId, AssetId, AssetNumber. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_update_maintenance_work_order'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_update_maintenance_work_order'] },
    },
    {
      id: 'createSalesOrderBody',
      title: 'Create Sales Order Body',
      type: 'code',
      language: 'json',
      placeholder:
        '{"BusinessUnitId":"123","SourceTransactionId":"EXT-1","SourceTransactionNumber":"EXT-1","SourceTransactionRevisionNumber":"1","SourceTransactionSystem":"YOUR_SOURCE","SubmittedFlag":false,"lines":[{"OrderedQuantity":1,"OrderedUOMCode":"Ea","ProductId":"456","SourceScheduleNumber":"1","SourceTransactionLineId":"1","SourceTransactionLineNumber":"1","SourceTransactionScheduleId":"1"}]}',
      description:
        'JSON object. Supported fields: BusinessUnitId, SourceTransactionId, SourceTransactionNumber, SourceTransactionRevisionNumber, SourceTransactionSystem, BuyingPartyId, BuyingPartyNumber, BuyingPartyName, CustomerPONumber, TransactionalCurrencyCode, TransactionOn, RequestedShipDate, RequestedArrivalDate, Comments, SubmittedFlag, lines. Required: BusinessUnitId, SourceTransactionId, SourceTransactionNumber, SourceTransactionRevisionNumber, SourceTransactionSystem, and a non-empty lines array. lines: up to 100 objects with OrderedQuantity, OrderedUOMCode, ProductId, ProductNumber, SourceScheduleNumber, SourceTransactionLineId, SourceTransactionLineNumber, SourceTransactionScheduleId, RequestedShipDate, RequestedArrivalDate, RequestedFulfillmentOrganizationId, RequestedFulfillmentOrganizationCode, UnitListPrice, UnitSellingPrice, Comments. Each requires OrderedQuantity, OrderedUOMCode, ProductId, SourceScheduleNumber, SourceTransactionLineId, SourceTransactionLineNumber, SourceTransactionScheduleId. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields. Set SubmittedFlag explicitly: false creates a draft; true requests validation and submission.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_create_sales_order'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_create_sales_order'] },
    },
    {
      id: 'updateSalesOrderBody',
      title: 'Update Sales Order Body',
      type: 'code',
      language: 'json',
      placeholder: '{"SourceTransactionRevisionNumber":""}',
      description:
        'JSON object. Supported fields: SourceTransactionRevisionNumber, BuyingPartyId, BuyingPartyNumber, BuyingPartyName, CustomerPONumber, TransactionalCurrencyCode, RequestedShipDate, RequestedArrivalDate, Comments, SubmittedFlag, CanceledFlag, CancelReasonCode. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_update_sales_order'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_update_sales_order'] },
    },
    {
      id: 'pickReleaseShipmentLinesBody',
      title: 'Pick Release Shipment Lines Body',
      type: 'code',
      language: 'json',
      placeholder: '{"details":[{"ShipmentLine":"123"}]}',
      description:
        'JSON object with details: a non-empty array (up to 100) of {"ShipmentLine":"123"}. ShipmentLine is a string, not a JSON number.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_pick_release_shipment_lines'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_pick_release_shipment_lines'] },
    },
    {
      id: 'confirmQuickShipLinesBody',
      title: 'Confirm Quick Ship Lines Body',
      type: 'code',
      language: 'json',
      placeholder: '{"details":[{"ShipmentLine":"123"}]}',
      description:
        'JSON object with details: a non-empty array (up to 100) of {"ShipmentLine":"123"}. ShipmentLine is a string, not a JSON number.',
      condition: { field: 'operation', value: ['oracle_fusion_scm_confirm_quick_ship_lines'] },
      required: { field: 'operation', value: ['oracle_fusion_scm_confirm_quick_ship_lines'] },
    },
  ],
  tools: {
    access: [
      'oracle_fusion_scm_list_inventory_organizations',
      'oracle_fusion_scm_get_inventory_organization',
      'oracle_fusion_scm_list_items',
      'oracle_fusion_scm_get_item',
      'oracle_fusion_scm_list_on_hand_quantities',
      'oracle_fusion_scm_get_on_hand_quantity',
      'oracle_fusion_scm_list_inventory_transactions',
      'oracle_fusion_scm_get_inventory_transaction',
      'oracle_fusion_scm_list_supply_requests',
      'oracle_fusion_scm_get_supply_request',
      'oracle_fusion_scm_list_supply_order_lines',
      'oracle_fusion_scm_get_supply_order_line',
      'oracle_fusion_scm_list_shipments',
      'oracle_fusion_scm_get_shipment',
      'oracle_fusion_scm_list_shipment_lines',
      'oracle_fusion_scm_get_shipment_line',
      'oracle_fusion_scm_list_manufacturing_work_orders',
      'oracle_fusion_scm_get_manufacturing_work_order',
      'oracle_fusion_scm_list_maintenance_work_orders',
      'oracle_fusion_scm_get_maintenance_work_order',
      'oracle_fusion_scm_list_transfer_orders',
      'oracle_fusion_scm_get_transfer_order',
      'oracle_fusion_scm_list_transfer_order_lines',
      'oracle_fusion_scm_get_transfer_order_line',
      'oracle_fusion_scm_list_sales_orders',
      'oracle_fusion_scm_get_sales_order',
      'oracle_fusion_scm_list_sales_order_lines',
      'oracle_fusion_scm_get_sales_order_line',
      'oracle_fusion_scm_list_fulfillment_line_details',
      'oracle_fusion_scm_get_fulfillment_line_detail',
      'oracle_fusion_scm_update_item',
      'oracle_fusion_scm_create_supply_request',
      'oracle_fusion_scm_update_supply_request',
      'oracle_fusion_scm_update_transfer_order',
      'oracle_fusion_scm_update_transfer_order_line',
      'oracle_fusion_scm_create_manufacturing_work_order',
      'oracle_fusion_scm_update_manufacturing_work_order',
      'oracle_fusion_scm_create_maintenance_work_order',
      'oracle_fusion_scm_update_maintenance_work_order',
      'oracle_fusion_scm_create_sales_order',
      'oracle_fusion_scm_update_sales_order',
      'oracle_fusion_scm_delete_sales_order',
      'oracle_fusion_scm_pick_release_shipment_lines',
      'oracle_fusion_scm_confirm_quick_ship_lines',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const operation = params.operation
        const keys = OPERATION_KEYS[operation] ?? []
        const result: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
          ...Object.fromEntries(keys.map((key) => [key, params[key]])),
        }
        if (LIST_OPERATIONS.includes(operation)) {
          result.q = optionalString(params.q, 'Filter')
          result.finder = optionalString(params.finder, 'Finder')
          result.orderBy = optionalString(params.orderBy, 'Order By')
          result.limit = parseOptionalNumberInput(params.limit, 'Limit', {
            integer: true,
            min: 1,
            max: 100,
          })
          result.offset = parseOptionalNumberInput(params.offset, 'Offset', {
            integer: true,
            min: 0,
          })
          result.totalResults = parseOptionalBooleanInput(params.totalResults)
        }
        const bodyField = OPERATION_BODY_FIELDS[operation]
        if (bodyField) result.body = params[bodyField]
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Oracle Fusion SCM operation' },
    oauthCredential: { type: 'string', description: 'Oracle Fusion service-account credential' },
    organizationKey: { type: 'string', description: 'Opaque inventory organization resource key' },
    itemKey: { type: 'string', description: 'Opaque item resource key' },
    onHandQuantityKey: { type: 'string', description: 'Opaque on hand quantity resource key' },
    transactionKey: { type: 'string', description: 'Opaque inventory transaction resource key' },
    supplyRequestKey: { type: 'string', description: 'Opaque supply request resource key' },
    supplyOrderLineKey: { type: 'string', description: 'Opaque supply order line resource key' },
    shipmentKey: { type: 'string', description: 'Opaque shipment resource key' },
    shipmentLineKey: { type: 'string', description: 'Opaque shipment line resource key' },
    manufacturingWorkOrderKey: {
      type: 'string',
      description: 'Opaque manufacturing work order resource key',
    },
    maintenanceWorkOrderKey: {
      type: 'string',
      description: 'Opaque maintenance work order resource key',
    },
    transferOrderKey: { type: 'string', description: 'Opaque transfer order resource key' },
    transferOrderLineKey: {
      type: 'string',
      description: 'Opaque transfer order line resource key',
    },
    salesOrderKey: { type: 'string', description: 'Opaque sales order resource key' },
    salesOrderLineKey: { type: 'string', description: 'Opaque sales order line resource key' },
    fulfillmentLineDetailKey: {
      type: 'string',
      description: 'Opaque fulfillment line detail resource key',
    },
    q: {
      type: 'string',
      description: 'Documented Oracle q filter; cannot be combined with finder',
    },
    finder: { type: 'string', description: 'Documented resource-specific predefined finder' },
    orderBy: { type: 'string', description: 'Documented Oracle attribute ordering' },
    limit: { type: 'number', description: 'Records per page, from 1 to 100' },
    offset: { type: 'number', description: 'Non-negative record offset' },
    totalResults: { type: 'boolean', description: 'Request estimated total-results metadata' },
    updateItemBody: { type: 'json', description: 'Documented update item request fields' },
    createSupplyRequestBody: {
      type: 'json',
      description: 'Documented create supply request request fields',
    },
    updateSupplyRequestBody: {
      type: 'json',
      description: 'Documented update supply request request fields',
    },
    updateTransferOrderBody: {
      type: 'json',
      description: 'Documented update transfer order request fields',
    },
    updateTransferOrderLineBody: {
      type: 'json',
      description: 'Documented update transfer order line request fields',
    },
    createManufacturingWorkOrderBody: {
      type: 'json',
      description: 'Documented create manufacturing work order request fields',
    },
    updateManufacturingWorkOrderBody: {
      type: 'json',
      description: 'Documented update manufacturing work order request fields',
    },
    createMaintenanceWorkOrderBody: {
      type: 'json',
      description: 'Documented create maintenance work order request fields',
    },
    updateMaintenanceWorkOrderBody: {
      type: 'json',
      description: 'Documented update maintenance work order request fields',
    },
    createSalesOrderBody: {
      type: 'json',
      description: 'Documented create sales order request fields',
    },
    updateSalesOrderBody: {
      type: 'json',
      description: 'Documented update sales order request fields',
    },
    pickReleaseShipmentLinesBody: {
      type: 'json',
      description: 'Documented pick release shipment lines request fields',
    },
    confirmQuickShipLinesBody: {
      type: 'json',
      description: 'Documented confirm quick ship lines request fields',
    },
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Projected resources in this bounded page',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    count: {
      type: 'number',
      description: 'Records in this page',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page exists',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    limit: {
      type: 'number',
      description: 'Returned page limit',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    offset: {
      type: 'number',
      description: 'Returned page offset',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    nextOffset: {
      type: 'number',
      description: 'Next offset, present only when another page exists',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    totalResults: {
      type: 'number',
      description: 'Estimated total, when provided by Oracle',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    organization: {
      type: 'json',
      description: 'Projected inventory organization with documented fields and Oracle-derived key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_inventory_organization'] },
    },
    item: {
      type: 'json',
      description: 'Projected item with documented fields and Oracle-derived key',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_scm_get_item', 'oracle_fusion_scm_update_item'],
      },
    },
    onHandQuantity: {
      type: 'json',
      description: 'Projected on hand quantity with documented fields and Oracle-derived key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_on_hand_quantity'] },
    },
    transaction: {
      type: 'json',
      description: 'Projected inventory transaction with documented fields and Oracle-derived key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_inventory_transaction'] },
    },
    supplyRequest: {
      type: 'json',
      description: 'Projected supply request with documented fields and Oracle-derived key',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_supply_request',
          'oracle_fusion_scm_create_supply_request',
          'oracle_fusion_scm_update_supply_request',
        ],
      },
    },
    supplyOrderLine: {
      type: 'json',
      description: 'Projected supply order line with documented fields and Oracle-derived key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_supply_order_line'] },
    },
    shipment: {
      type: 'json',
      description: 'Projected shipment with documented fields and Oracle-derived key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_shipment'] },
    },
    shipmentLine: {
      type: 'json',
      description: 'Projected shipment line with documented fields and Oracle-derived key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_shipment_line'] },
    },
    manufacturingWorkOrder: {
      type: 'json',
      description:
        'Projected manufacturing work order with documented fields and Oracle-derived key',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_manufacturing_work_order',
          'oracle_fusion_scm_create_manufacturing_work_order',
          'oracle_fusion_scm_update_manufacturing_work_order',
        ],
      },
    },
    maintenanceWorkOrder: {
      type: 'json',
      description: 'Projected maintenance work order with documented fields and Oracle-derived key',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_maintenance_work_order',
          'oracle_fusion_scm_create_maintenance_work_order',
          'oracle_fusion_scm_update_maintenance_work_order',
        ],
      },
    },
    transferOrder: {
      type: 'json',
      description: 'Projected transfer order with documented fields and Oracle-derived key',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_scm_get_transfer_order', 'oracle_fusion_scm_update_transfer_order'],
      },
    },
    transferOrderLine: {
      type: 'json',
      description: 'Projected transfer order line with documented fields and Oracle-derived key',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_transfer_order_line',
          'oracle_fusion_scm_update_transfer_order_line',
        ],
      },
    },
    salesOrder: {
      type: 'json',
      description: 'Projected sales order with documented fields and Oracle-derived key',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_get_sales_order',
          'oracle_fusion_scm_create_sales_order',
          'oracle_fusion_scm_update_sales_order',
        ],
      },
    },
    salesOrderLine: {
      type: 'json',
      description: 'Projected sales order line with documented fields and Oracle-derived key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_sales_order_line'] },
    },
    fulfillmentLineDetail: {
      type: 'json',
      description:
        'Projected fulfillment line detail with documented fields and Oracle-derived key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_get_fulfillment_line_detail'] },
    },
    result: {
      type: 'json',
      description: 'Oracle action result map; inspect every entry for business errors',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_scm_pick_release_shipment_lines',
          'oracle_fusion_scm_confirm_quick_ship_lines',
        ],
      },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether Oracle completed deletion',
      condition: { field: 'operation', value: ['oracle_fusion_scm_delete_sales_order'] },
    },
    salesOrderKey: {
      type: 'string',
      description: 'Deleted sales order key',
      condition: { field: 'operation', value: ['oracle_fusion_scm_delete_sales_order'] },
    },
  },
}

export const OracleFusionScmBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/scm/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Snapshot on-hand inventory',
      prompt:
        'Build a scheduled workflow that lists one bounded page of Oracle Fusion on-hand quantities, records item, organization, subinventory, locator, lot, serial, on-hand quantity, reserved quantity, inbound quantity, and units, and stores the snapshot in a table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['inventory', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Audit completed inventory transactions',
      prompt:
        'Create a scheduled workflow that lists completed Oracle Fusion inventory transactions for a documented filter, highlights unusual quantities or transfer destinations, and writes a bounded audit report with transaction, item, organization, source, date, quantity, unit, and reason.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['inventory', 'audit'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Send a shipment status digest',
      prompt:
        'Build a scheduled workflow that lists Oracle Fusion shipments, groups the current page by shipment status and exception severity, and sends a digest containing shipment, organization, carrier, ship and delivery dates, customer, and location.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['shipping', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor shipment-line exceptions',
      prompt:
        'Create a scheduled workflow that lists Oracle Fusion shipment lines, compares requested, pending, picked, staged, shipped, delivered, backordered, and cancelled quantities, and reports fulfillment or integration exceptions with order, item, organization, and scheduled ship date.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['shipping', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Report supply-request exceptions',
      prompt:
        'Build a scheduled workflow that lists Oracle Fusion supply requests, isolates exceptional request or order statuses, and reports source, reference, request date, order number, partial-request flag, processing flag, and trusted source.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['supply', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Drill into supply order lines',
      prompt:
        'Create a workflow that selects an Oracle Fusion supply request, lists one bounded page of its supply order lines, and reports item, requested quantity, unit, need-by date, destination organization, and line status.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['supply', 'fulfillment'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Report manufacturing progress',
      prompt:
        'Build a scheduled workflow that lists Oracle Fusion manufacturing work orders and reports planned, completed, scrapped, and rejected quantities with status, organization, item, planned and actual dates, work definition, serial tracking, and supply type.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['manufacturing', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Report maintenance work due',
      prompt:
        'Create a scheduled workflow that lists Oracle Fusion maintenance work orders, identifies work due or overdue from planned completion dates and status, and reports priority, organization, asset, item, work definition, maintenance program, release date, and warranty state.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['maintenance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Look up items and organizations',
      prompt:
        'Create a lookup workflow that lets a user select an Oracle Fusion inventory organization or item, reads the selected record, and returns organization, item, lifecycle, unit-of-measure, stocking, shipping, manufacturing, and maintenance context.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['inventory', 'lookup'],
    },
  ],
  skills: [
    {
      name: 'snapshot-oracle-fusion-inventory',
      description: 'Capture a bounded snapshot of Oracle Fusion on-hand inventory.',
      content:
        '# Snapshot Oracle Fusion Inventory\n\n## Steps\n\n1. Use List On-Hand Quantities with the narrowest documented q filter.\n2. Keep limit at 100 or less and process only the returned page.\n3. Preserve item, organization, subinventory, locator, lot, serial, quantity, and unit fields.\n\n## Output\n\nReturn the snapshot rows, page boundary, and nextOffset when Oracle reports another page.',
    },
    {
      name: 'audit-oracle-fusion-inventory-transactions',
      description: 'Audit completed inventory movement with its source and destination context.',
      content:
        '# Audit Oracle Fusion Inventory Transactions\n\n## Steps\n\n1. Use List Inventory Transactions with a documented q or finder expression, never both.\n2. Review transaction identity, date, type, source, organization, item, locator, quantity, unit, reason, and transfer destination.\n3. Use Get Inventory Transaction with an Oracle-derived transactionKey when detail is needed.\n\n## Output\n\nReport material movements and exceptions, including the page boundary.',
    },
    {
      name: 'monitor-oracle-fusion-shipments',
      description: 'Monitor shipment status, timing, transport, and open exceptions.',
      content:
        '# Monitor Oracle Fusion Shipments\n\n## Steps\n\n1. Use List Shipments with a narrow documented q filter and bounded limit.\n2. Review status, organization, pickup, ship and delivery dates, carrier, method, transport, customer, location, weight, volume, and exception severity.\n3. Use Get Shipment with the returned shipmentKey for one selected record.\n\n## Output\n\nReturn a status digest and identify whether another page exists.',
    },
    {
      name: 'inspect-oracle-fusion-supply-exceptions',
      description:
        'Inspect supply-request and order-line exception state without modifying supply.',
      content:
        '# Inspect Oracle Fusion Supply Exceptions\n\n## Steps\n\n1. List Supply Requests with a documented q or finder expression.\n2. Select a request and use List Supply Order Lines with its supplyRequestKey.\n3. Compare requested quantity, need-by date, destination, and line status.\n\n## Output\n\nReturn a read-only exception report with both Oracle-derived keys and page boundaries.',
    },
    {
      name: 'report-oracle-fusion-production-progress',
      description: 'Report manufacturing work-order progress and yield exceptions.',
      content:
        '# Report Oracle Fusion Production Progress\n\n## Steps\n\n1. Use List Manufacturing Work Orders with a documented q filter and bounded limit.\n2. Compare planned, completed, scrapped, and rejected quantities.\n3. Include status, organization, item, unit, planned and actual dates, work definition, serial tracking, and supply type.\n\n## Output\n\nReturn progress and yield exceptions plus nextOffset when present.',
    },
    {
      name: 'track-oracle-fusion-maintenance-due-work',
      description: 'Track due and overdue maintenance work by asset and priority.',
      content:
        '# Track Oracle Fusion Maintenance Due Work\n\n## Steps\n\n1. Use List Maintenance Work Orders with a documented q filter and one bounded page.\n2. Compare status and priority with planned start and completion dates.\n3. Include organization, asset, item, work definition, maintenance program, release date, and warranty flag.\n\n## Output\n\nReturn a prioritized due-work report with the page boundary.',
    },
    {
      name: 'reconcile-oracle-fusion-shipment-lines',
      description: 'Reconcile shipment-line fulfillment quantities and integration status.',
      content:
        '# Reconcile Oracle Fusion Shipment Lines\n\n## Steps\n\n1. Use List Shipment Lines with a narrow documented q filter.\n2. Compare requested, pending, picked, staged, shipped, delivered, backordered, and cancelled quantities.\n3. Review order, fulfillment, item, organization, source and destination subinventories, line status, scheduled ship date, and integration status.\n\n## Output\n\nReturn quantity mismatches and status exceptions for the bounded page.',
    },
  ],
} as const satisfies BlockMeta
