import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'

const LIST_OPERATIONS = [
  'oracle_fusion_procurement_list_draft_purchase_order_lines',
  'oracle_fusion_procurement_list_draft_purchase_orders',
  'oracle_fusion_procurement_list_procurement_agents',
  'oracle_fusion_procurement_list_purchase_order_lines',
  'oracle_fusion_procurement_list_purchase_order_receipts',
  'oracle_fusion_procurement_list_purchase_orders',
  'oracle_fusion_procurement_list_purchase_requisition_lines',
  'oracle_fusion_procurement_list_purchase_requisitions',
  'oracle_fusion_procurement_list_supplier_negotiation_responses',
  'oracle_fusion_procurement_list_supplier_negotiations',
  'oracle_fusion_procurement_list_supplier_sites',
  'oracle_fusion_procurement_list_suppliers',
]
const WRITE_OPERATIONS = [
  'oracle_fusion_procurement_create_draft_purchase_order',
  'oracle_fusion_procurement_create_purchase_requisition',
  'oracle_fusion_procurement_create_supplier',
  'oracle_fusion_procurement_create_supplier_negotiation',
  'oracle_fusion_procurement_create_supplier_site',
  'oracle_fusion_procurement_update_draft_purchase_order',
  'oracle_fusion_procurement_update_purchase_requisition',
  'oracle_fusion_procurement_update_supplier',
  'oracle_fusion_procurement_update_supplier_negotiation',
  'oracle_fusion_procurement_update_supplier_site',
]
const UPDATE_OPERATIONS = [
  'oracle_fusion_procurement_update_draft_purchase_order',
  'oracle_fusion_procurement_update_purchase_requisition',
  'oracle_fusion_procurement_update_supplier',
  'oracle_fusion_procurement_update_supplier_negotiation',
  'oracle_fusion_procurement_update_supplier_site',
]
const ACTION_OPERATIONS = [
  'oracle_fusion_procurement_hold_purchase_order',
  'oracle_fusion_procurement_remove_purchase_order_hold',
  'oracle_fusion_procurement_submit_draft_purchase_order',
  'oracle_fusion_procurement_submit_purchase_requisition',
  'oracle_fusion_procurement_validate_draft_purchase_order',
  'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
  'oracle_fusion_procurement_withdraw_purchase_requisition',
]
const BUSINESS_RESULT_OPERATIONS = [
  'oracle_fusion_procurement_hold_purchase_order',
  'oracle_fusion_procurement_remove_purchase_order_hold',
  'oracle_fusion_procurement_submit_draft_purchase_order',
  'oracle_fusion_procurement_submit_purchase_requisition',
  'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
  'oracle_fusion_procurement_withdraw_purchase_requisition',
]

const SUPPLIER_ID_OPERATIONS = [
  'oracle_fusion_procurement_create_draft_purchase_order',
  'oracle_fusion_procurement_create_supplier_site',
  'oracle_fusion_procurement_get_supplier',
  'oracle_fusion_procurement_get_supplier_site',
  'oracle_fusion_procurement_list_supplier_sites',
  'oracle_fusion_procurement_update_supplier',
  'oracle_fusion_procurement_update_supplier_site',
]
const SUPPLIER_SITE_ID_OPERATIONS = [
  'oracle_fusion_procurement_create_draft_purchase_order',
  'oracle_fusion_procurement_get_supplier_site',
  'oracle_fusion_procurement_update_supplier_site',
]
const REQUISITION_KEY_OPERATIONS = [
  'oracle_fusion_procurement_get_purchase_requisition',
  'oracle_fusion_procurement_list_purchase_requisition_lines',
  'oracle_fusion_procurement_submit_purchase_requisition',
  'oracle_fusion_procurement_update_purchase_requisition',
  'oracle_fusion_procurement_withdraw_purchase_requisition',
]
const DRAFT_PURCHASE_ORDER_KEY_OPERATIONS = [
  'oracle_fusion_procurement_get_draft_purchase_order',
  'oracle_fusion_procurement_list_draft_purchase_order_lines',
  'oracle_fusion_procurement_submit_draft_purchase_order',
  'oracle_fusion_procurement_update_draft_purchase_order',
  'oracle_fusion_procurement_validate_draft_purchase_order',
]
const PURCHASE_ORDER_KEY_OPERATIONS = [
  'oracle_fusion_procurement_get_purchase_order',
  'oracle_fusion_procurement_hold_purchase_order',
  'oracle_fusion_procurement_list_purchase_order_lines',
  'oracle_fusion_procurement_remove_purchase_order_hold',
]
const PO_HEADER_ID_OPERATIONS = [
  'oracle_fusion_procurement_get_purchase_order_lifecycle_details',
  'oracle_fusion_procurement_get_purchase_order_receipt',
  'oracle_fusion_procurement_list_purchase_order_receipts',
]
const RECEIPT_KEY_OPERATIONS = ['oracle_fusion_procurement_get_purchase_order_receipt']
const NEGOTIATION_KEY_OPERATIONS = [
  'oracle_fusion_procurement_get_supplier_negotiation',
  'oracle_fusion_procurement_update_supplier_negotiation',
  'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
]
const NEGOTIATION_ID_OPERATIONS = [
  'oracle_fusion_procurement_list_supplier_negotiation_responses',
]
const RESPONSE_KEY_OPERATIONS = ['oracle_fusion_procurement_get_supplier_negotiation_response']
const ASSIGNMENT_ID_OPERATIONS = ['oracle_fusion_procurement_get_procurement_agent']
const SUPPLIER_NAME_OPERATIONS = ['oracle_fusion_procurement_create_supplier']
const SUPPLIER_SITE_NAME_OPERATIONS = ['oracle_fusion_procurement_create_supplier_site']
const SUPPLIER_ADDRESS_ID_OPERATIONS = ['oracle_fusion_procurement_create_supplier_site']
const PROCUREMENT_BUID_OPERATIONS = [
  'oracle_fusion_procurement_create_draft_purchase_order',
  'oracle_fusion_procurement_create_supplier_negotiation',
  'oracle_fusion_procurement_create_supplier_site',
]
const PREPARER_ID_OPERATIONS = ['oracle_fusion_procurement_create_purchase_requisition']
const REQUISITIONING_BUID_OPERATIONS = [
  'oracle_fusion_procurement_create_purchase_requisition',
]
const BUYER_ID_OPERATIONS = [
  'oracle_fusion_procurement_create_draft_purchase_order',
  'oracle_fusion_procurement_create_supplier_negotiation',
  'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
]
const REQUIRED_BUYER_ID_OPERATIONS = ['oracle_fusion_procurement_create_draft_purchase_order']
const DOCUMENT_STYLE_ID_OPERATIONS = ['oracle_fusion_procurement_create_draft_purchase_order']
const NEGOTIATION_TITLE_OPERATIONS = ['oracle_fusion_procurement_create_supplier_negotiation']
const ACTION_INTENT_OPERATIONS = [
  'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
]
const HOLD_REASON_OPERATIONS = ['oracle_fusion_procurement_hold_purchase_order']
const REMOVE_HOLD_REASON_OPERATIONS = ['oracle_fusion_procurement_remove_purchase_order_hold']
const REQUEST_FUNDS_OVERRIDE_FLAG_OPERATIONS = [
  'oracle_fusion_procurement_submit_purchase_requisition',
]
const VALIDATE_BEFORE_SUBMIT_FLAG_OPERATIONS = ['oracle_fusion_procurement_submit_draft_purchase_order']
const IGNORE_WARNINGS_OPERATIONS = [
  'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
]

const INPUT_OPERATIONS: Record<string, readonly string[]> = {
  supplierId: SUPPLIER_ID_OPERATIONS,
  supplierSiteId: SUPPLIER_SITE_ID_OPERATIONS,
  requisitionKey: REQUISITION_KEY_OPERATIONS,
  draftPurchaseOrderKey: DRAFT_PURCHASE_ORDER_KEY_OPERATIONS,
  purchaseOrderKey: PURCHASE_ORDER_KEY_OPERATIONS,
  poHeaderId: PO_HEADER_ID_OPERATIONS,
  receiptKey: RECEIPT_KEY_OPERATIONS,
  negotiationKey: NEGOTIATION_KEY_OPERATIONS,
  negotiationId: NEGOTIATION_ID_OPERATIONS,
  responseKey: RESPONSE_KEY_OPERATIONS,
  assignmentId: ASSIGNMENT_ID_OPERATIONS,
  supplierName: SUPPLIER_NAME_OPERATIONS,
  supplierSiteName: SUPPLIER_SITE_NAME_OPERATIONS,
  supplierAddressId: SUPPLIER_ADDRESS_ID_OPERATIONS,
  procurementBUId: PROCUREMENT_BUID_OPERATIONS,
  preparerId: PREPARER_ID_OPERATIONS,
  requisitioningBUId: REQUISITIONING_BUID_OPERATIONS,
  buyerId: BUYER_ID_OPERATIONS,
  documentStyleId: DOCUMENT_STYLE_ID_OPERATIONS,
  negotiationTitle: NEGOTIATION_TITLE_OPERATIONS,
  actionIntent: ACTION_INTENT_OPERATIONS,
  holdReason: HOLD_REASON_OPERATIONS,
  removeHoldReason: REMOVE_HOLD_REASON_OPERATIONS,
  requestFundsOverrideFlag: REQUEST_FUNDS_OVERRIDE_FLAG_OPERATIONS,
  validateBeforeSubmitFlag: VALIDATE_BEFORE_SUBMIT_FLAG_OPERATIONS,
  ignoreWarnings: IGNORE_WARNINGS_OPERATIONS,
  q: LIST_OPERATIONS,
  orderBy: LIST_OPERATIONS,
  limit: LIST_OPERATIONS,
  offset: LIST_OPERATIONS,
  totalResults: LIST_OPERATIONS,
  body: WRITE_OPERATIONS,
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value.trim() || undefined
}

export const OracleFusionProcurementBlock: BlockConfig = {
  type: 'oracle_fusion_procurement',
  name: 'Oracle Fusion Procurement',
  description: 'Manage suppliers, requisitions, purchasing documents, and sourcing',
  longDescription:
    'Connect a reusable Oracle Fusion service account for supplier and site maintenance, requisition intake, draft purchase orders, approved purchase-order actions, sourcing negotiations, supplier-visible responses, procurement agents, and procurement-facing receipt visibility. Every list returns one bounded page. Mutations are explicit: creating a draft does not submit or publish it. Receipt visibility does not perform SCM receiving transactions; invoices, payments, accounting, and banking workflows remain outside this integration. Integer identifiers must be supplied as decimal strings. Resource numeric values are returned as decimal strings to preserve framework-v9 precision; pagination values remain numbers. Updates change documented header fields only; creates also support bounded inline child records. Oracle privileges and business-unit data access are required. The business-unit picker shows purchase-order-enabled units; enter an authorized ID manually for sourcing or supplier roles. Supplier negotiation responses require the View Supplier Negotiation Response as Supplier privilege and do not provide buyer-wide bid visibility.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_procurement',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Procurement',
    sentences: {
      byOperation: {
        oracle_fusion_procurement_create_draft_purchase_order: [
          'Create draft purchase order',
          {
            text: 'with buyer',
            field: ['buyerIdSelector', 'buyerIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_create_purchase_requisition: [
          'Create purchase requisition',
          {
            text: 'with requisition preparer',
            field: ['preparerIdSelector', 'preparerIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_create_supplier: [
          'Create supplier',
          {
            text: 'with supplier name',
            field: 'supplierName',
            core: true,
          },
        ],
        oracle_fusion_procurement_create_supplier_negotiation: [
          'Create supplier negotiation',
          {
            text: 'with procurement business unit',
            field: ['procurementBUIdSelector', 'procurementBUIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_create_supplier_site: [
          'Create supplier site',
          {
            text: 'with supplier',
            field: ['supplierIdSelector', 'supplierIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_draft_purchase_order: [
          'Get draft purchase order',
          {
            text: 'using',
            field: ['draftPurchaseOrderKeySelector', 'draftPurchaseOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_procurement_agent: [
          'Get procurement agent',
          {
            text: 'using',
            field: ['assignmentIdSelector', 'assignmentIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_purchase_order: [
          'Get purchase order',
          {
            text: 'using',
            field: ['purchaseOrderKeySelector', 'purchaseOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_purchase_order_lifecycle_details: [
          'Get purchase order lifecycle details',
          {
            text: 'using',
            field: ['poHeaderIdSelector', 'poHeaderIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_purchase_order_receipt: [
          'Get purchase order receipt',
          {
            text: 'using',
            field: ['poHeaderIdSelector', 'poHeaderIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_purchase_requisition: [
          'Get purchase requisition',
          {
            text: 'using',
            field: ['requisitionKeySelector', 'requisitionKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_supplier: [
          'Get supplier',
          {
            text: 'using',
            field: ['supplierIdSelector', 'supplierIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_supplier_negotiation: [
          'Get supplier negotiation',
          {
            text: 'using',
            field: ['negotiationKeySelector', 'negotiationKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_supplier_negotiation_response: [
          'Get supplier negotiation response',
          {
            text: 'using',
            field: ['responseKeySelector', 'responseKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_get_supplier_site: [
          'Get supplier site',
          {
            text: 'using',
            field: ['supplierIdSelector', 'supplierIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_hold_purchase_order: [
          'Hold purchase order',
          {
            text: 'using',
            field: ['purchaseOrderKeySelector', 'purchaseOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_list_draft_purchase_order_lines: [
          'List draft purchase order lines',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_draft_purchase_orders: [
          'List draft purchase orders',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_procurement_agents: [
          'List procurement agents',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_purchase_order_lines: [
          'List purchase order lines',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_purchase_order_receipts: [
          'List purchase order receipts',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_purchase_orders: [
          'List purchase orders',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_purchase_requisition_lines: [
          'List purchase requisition lines',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_purchase_requisitions: [
          'List purchase requisitions',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_supplier_negotiation_responses: [
          'List supplier negotiation responses',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_supplier_negotiations: [
          'List supplier negotiations',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_supplier_sites: [
          'List supplier sites',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_list_suppliers: [
          'List suppliers',
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_procurement_remove_purchase_order_hold: [
          'Remove purchase order hold',
          {
            text: 'using',
            field: ['purchaseOrderKeySelector', 'purchaseOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_submit_draft_purchase_order: [
          'Submit draft purchase order',
          {
            text: 'using',
            field: ['draftPurchaseOrderKeySelector', 'draftPurchaseOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_submit_purchase_requisition: [
          'Submit purchase requisition',
          {
            text: 'using',
            field: ['requisitionKeySelector', 'requisitionKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_update_draft_purchase_order: [
          'Update draft purchase order',
          {
            text: 'using',
            field: ['draftPurchaseOrderKeySelector', 'draftPurchaseOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_update_purchase_requisition: [
          'Update purchase requisition',
          {
            text: 'using',
            field: ['requisitionKeySelector', 'requisitionKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_update_supplier: [
          'Update supplier',
          {
            text: 'using',
            field: ['supplierIdSelector', 'supplierIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_update_supplier_negotiation: [
          'Update supplier negotiation',
          {
            text: 'using',
            field: ['negotiationKeySelector', 'negotiationKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_update_supplier_site: [
          'Update supplier site',
          {
            text: 'using',
            field: ['supplierIdSelector', 'supplierIdManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_validate_draft_purchase_order: [
          'Validate draft purchase order',
          {
            text: 'using',
            field: ['draftPurchaseOrderKeySelector', 'draftPurchaseOrderKeyManual'],
            core: true,
          },
        ],
        oracle_fusion_procurement_validate_or_publish_supplier_negotiation: [
          'Validate or publish supplier negotiation',
          {
            text: 'using',
            field: ['negotiationKeySelector', 'negotiationKeyManual'],
            core: true,
          },
          { text: ', intent', field: 'actionIntent', core: true },
        ],
        oracle_fusion_procurement_withdraw_purchase_requisition: [
          'Withdraw purchase requisition',
          {
            text: 'using',
            field: ['requisitionKeySelector', 'requisitionKeyManual'],
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Oracle Fusion Account',
      type: 'oauth-input',
      serviceId: 'oracle_fusion_procurement',
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
          label: 'Create Draft Purchase Order',
          id: 'oracle_fusion_procurement_create_draft_purchase_order',
        },
        {
          label: 'Create Purchase Requisition',
          id: 'oracle_fusion_procurement_create_purchase_requisition',
        },
        { label: 'Create Supplier', id: 'oracle_fusion_procurement_create_supplier' },
        {
          label: 'Create Supplier Negotiation',
          id: 'oracle_fusion_procurement_create_supplier_negotiation',
        },
        { label: 'Create Supplier Site', id: 'oracle_fusion_procurement_create_supplier_site' },
        {
          label: 'Get Draft Purchase Order',
          id: 'oracle_fusion_procurement_get_draft_purchase_order',
        },
        { label: 'Get Procurement Agent', id: 'oracle_fusion_procurement_get_procurement_agent' },
        { label: 'Get Purchase Order', id: 'oracle_fusion_procurement_get_purchase_order' },
        {
          label: 'Get Purchase Order Lifecycle Details',
          id: 'oracle_fusion_procurement_get_purchase_order_lifecycle_details',
        },
        {
          label: 'Get Purchase Order Receipt',
          id: 'oracle_fusion_procurement_get_purchase_order_receipt',
        },
        {
          label: 'Get Purchase Requisition',
          id: 'oracle_fusion_procurement_get_purchase_requisition',
        },
        { label: 'Get Supplier', id: 'oracle_fusion_procurement_get_supplier' },
        {
          label: 'Get Supplier Negotiation',
          id: 'oracle_fusion_procurement_get_supplier_negotiation',
        },
        {
          label: 'Get Supplier Negotiation Response',
          id: 'oracle_fusion_procurement_get_supplier_negotiation_response',
        },
        { label: 'Get Supplier Site', id: 'oracle_fusion_procurement_get_supplier_site' },
        { label: 'Hold Purchase Order', id: 'oracle_fusion_procurement_hold_purchase_order' },
        {
          label: 'List Draft Purchase Order Lines',
          id: 'oracle_fusion_procurement_list_draft_purchase_order_lines',
        },
        {
          label: 'List Draft Purchase Orders',
          id: 'oracle_fusion_procurement_list_draft_purchase_orders',
        },
        {
          label: 'List Procurement Agents',
          id: 'oracle_fusion_procurement_list_procurement_agents',
        },
        {
          label: 'List Purchase Order Lines',
          id: 'oracle_fusion_procurement_list_purchase_order_lines',
        },
        {
          label: 'List Purchase Order Receipts',
          id: 'oracle_fusion_procurement_list_purchase_order_receipts',
        },
        { label: 'List Purchase Orders', id: 'oracle_fusion_procurement_list_purchase_orders' },
        {
          label: 'List Purchase Requisition Lines',
          id: 'oracle_fusion_procurement_list_purchase_requisition_lines',
        },
        {
          label: 'List Purchase Requisitions',
          id: 'oracle_fusion_procurement_list_purchase_requisitions',
        },
        {
          label: 'List Supplier Negotiation Responses',
          id: 'oracle_fusion_procurement_list_supplier_negotiation_responses',
        },
        {
          label: 'List Supplier Negotiations',
          id: 'oracle_fusion_procurement_list_supplier_negotiations',
        },
        { label: 'List Supplier Sites', id: 'oracle_fusion_procurement_list_supplier_sites' },
        { label: 'List Suppliers', id: 'oracle_fusion_procurement_list_suppliers' },
        {
          label: 'Remove Purchase Order Hold',
          id: 'oracle_fusion_procurement_remove_purchase_order_hold',
        },
        {
          label: 'Submit Draft Purchase Order',
          id: 'oracle_fusion_procurement_submit_draft_purchase_order',
        },
        {
          label: 'Submit Purchase Requisition',
          id: 'oracle_fusion_procurement_submit_purchase_requisition',
        },
        {
          label: 'Update Draft Purchase Order',
          id: 'oracle_fusion_procurement_update_draft_purchase_order',
        },
        {
          label: 'Update Purchase Requisition',
          id: 'oracle_fusion_procurement_update_purchase_requisition',
        },
        { label: 'Update Supplier', id: 'oracle_fusion_procurement_update_supplier' },
        {
          label: 'Update Supplier Negotiation',
          id: 'oracle_fusion_procurement_update_supplier_negotiation',
        },
        { label: 'Update Supplier Site', id: 'oracle_fusion_procurement_update_supplier_site' },
        {
          label: 'Validate Draft Purchase Order',
          id: 'oracle_fusion_procurement_validate_draft_purchase_order',
        },
        {
          label: 'Validate Or Publish Supplier Negotiation',
          id: 'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
        },
        {
          label: 'Withdraw Purchase Requisition',
          id: 'oracle_fusion_procurement_withdraw_purchase_requisition',
        },
      ],
      value: () => 'oracle_fusion_procurement_list_suppliers',
      required: true,
    },
    {
      id: 'supplierIdSelector',
      title: 'Supplier',
      type: 'project-selector',
      canonicalParamId: 'supplierId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.suppliers',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select supplier',
      condition: { field: 'operation', value: SUPPLIER_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'supplierIdManual',
      title: 'Supplier',
      type: 'short-input',
      canonicalParamId: 'supplierId',
      mode: 'advanced',
      placeholder: 'Numeric SupplierId, preserved as a decimal string',
      condition: { field: 'operation', value: SUPPLIER_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'supplierSiteIdSelector',
      title: 'Supplier Site',
      type: 'project-selector',
      canonicalParamId: 'supplierSiteId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.supplierSites',
      dependsOn: ['oauthCredential', 'supplierId'],
      mode: 'basic',
      placeholder: 'Select supplier site',
      condition: { field: 'operation', value: SUPPLIER_SITE_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'supplierSiteIdManual',
      title: 'Supplier Site',
      type: 'short-input',
      canonicalParamId: 'supplierSiteId',
      mode: 'advanced',
      placeholder: 'Numeric SupplierSiteId belonging to the selected supplier, as a decimal string',
      condition: { field: 'operation', value: SUPPLIER_SITE_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'requisitionKeySelector',
      title: 'Purchase Requisition',
      type: 'project-selector',
      canonicalParamId: 'requisitionKey',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.purchaseRequisitions',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select purchase requisition',
      condition: { field: 'operation', value: REQUISITION_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'requisitionKeyManual',
      title: 'Purchase Requisition',
      type: 'short-input',
      canonicalParamId: 'requisitionKey',
      mode: 'advanced',
      placeholder: 'Opaque purchase-requisition key from the key output; do not substitute RequisitionHeaderId',
      condition: { field: 'operation', value: REQUISITION_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'draftPurchaseOrderKeySelector',
      title: 'Draft Purchase Order',
      type: 'project-selector',
      canonicalParamId: 'draftPurchaseOrderKey',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.draftPurchaseOrders',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select draft purchase order',
      condition: { field: 'operation', value: DRAFT_PURCHASE_ORDER_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'draftPurchaseOrderKeyManual',
      title: 'Draft Purchase Order',
      type: 'short-input',
      canonicalParamId: 'draftPurchaseOrderKey',
      mode: 'advanced',
      placeholder: 'Opaque draft purchase-order key from the key output; do not substitute POHeaderId',
      condition: { field: 'operation', value: DRAFT_PURCHASE_ORDER_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'purchaseOrderKeySelector',
      title: 'Purchase Order',
      type: 'project-selector',
      canonicalParamId: 'purchaseOrderKey',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.purchaseOrders',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select purchase order',
      condition: { field: 'operation', value: PURCHASE_ORDER_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'purchaseOrderKeyManual',
      title: 'Purchase Order',
      type: 'short-input',
      canonicalParamId: 'purchaseOrderKey',
      mode: 'advanced',
      placeholder: 'Opaque approved purchase-order key from the key output; do not substitute POHeaderId',
      condition: { field: 'operation', value: PURCHASE_ORDER_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'poHeaderIdSelector',
      title: 'Purchase Order Header ID',
      type: 'project-selector',
      canonicalParamId: 'poHeaderId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.purchaseOrderHeaders',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select purchase order header id',
      condition: { field: 'operation', value: PO_HEADER_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'poHeaderIdManual',
      title: 'Purchase Order Header ID',
      type: 'short-input',
      canonicalParamId: 'poHeaderId',
      mode: 'advanced',
      placeholder: 'Numeric POHeaderId from a purchase order, as a decimal string (not its opaque key)',
      condition: { field: 'operation', value: PO_HEADER_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'receiptKeySelector',
      title: 'Purchase Order Receipt',
      type: 'project-selector',
      canonicalParamId: 'receiptKey',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.purchaseOrderReceipts',
      dependsOn: ['oauthCredential', 'poHeaderId'],
      mode: 'basic',
      placeholder: 'Select purchase order receipt',
      condition: { field: 'operation', value: RECEIPT_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'receiptKeyManual',
      title: 'Purchase Order Receipt',
      type: 'short-input',
      canonicalParamId: 'receiptKey',
      mode: 'advanced',
      placeholder: 'Opaque receipt key from List Purchase Order Receipts for this POHeaderId; not ReceiptId',
      condition: { field: 'operation', value: RECEIPT_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'negotiationKeySelector',
      title: 'Supplier Negotiation',
      type: 'project-selector',
      canonicalParamId: 'negotiationKey',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.supplierNegotiations',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select supplier negotiation',
      condition: { field: 'operation', value: NEGOTIATION_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'negotiationKeyManual',
      title: 'Supplier Negotiation',
      type: 'short-input',
      canonicalParamId: 'negotiationKey',
      mode: 'advanced',
      placeholder: 'Opaque supplier-negotiation key from the key output; not AuctionHeaderId',
      condition: { field: 'operation', value: NEGOTIATION_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'negotiationIdSelector',
      title: 'Negotiation ID Filter',
      type: 'project-selector',
      canonicalParamId: 'negotiationId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.supplierNegotiationIds',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select negotiation id filter',
      condition: { field: 'operation', value: NEGOTIATION_ID_OPERATIONS },
      required: false,
    },
    {
      id: 'negotiationIdManual',
      title: 'Negotiation ID Filter',
      type: 'short-input',
      canonicalParamId: 'negotiationId',
      mode: 'advanced',
      placeholder: 'Numeric AuctionHeaderId to filter negotiation responses, as a decimal string',
      condition: { field: 'operation', value: NEGOTIATION_ID_OPERATIONS },
      required: false,
    },
    {
      id: 'responseKeySelector',
      title: 'Supplier Negotiation Response',
      type: 'project-selector',
      canonicalParamId: 'responseKey',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.supplierNegotiationResponses',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select supplier negotiation response',
      condition: { field: 'operation', value: RESPONSE_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'responseKeyManual',
      title: 'Supplier Negotiation Response',
      type: 'short-input',
      canonicalParamId: 'responseKey',
      mode: 'advanced',
      placeholder: 'Opaque supplier-negotiation-response key from the key output; not ResponseNumber',
      condition: { field: 'operation', value: RESPONSE_KEY_OPERATIONS },
      required: true,
    },
    {
      id: 'assignmentIdSelector',
      title: 'Procurement Agent Assignment',
      type: 'project-selector',
      canonicalParamId: 'assignmentId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.procurementAgents',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select procurement agent assignment',
      condition: { field: 'operation', value: ASSIGNMENT_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'assignmentIdManual',
      title: 'Procurement Agent Assignment',
      type: 'short-input',
      canonicalParamId: 'assignmentId',
      mode: 'advanced',
      placeholder: 'Numeric procurement-agent AssignmentId, as a decimal string (not AgentId)',
      condition: { field: 'operation', value: ASSIGNMENT_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'supplierName',
      title: 'Supplier Name',
      type: 'short-input',
      placeholder: 'Supplier name (maximum 360 characters)',
      condition: { field: 'operation', value: SUPPLIER_NAME_OPERATIONS },
      required: true,
    },
    {
      id: 'supplierSiteName',
      title: 'Supplier Site Name',
      type: 'short-input',
      placeholder: 'Supplier site name (maximum 240 characters)',
      condition: { field: 'operation', value: SUPPLIER_SITE_NAME_OPERATIONS },
      required: true,
    },
    {
      id: 'supplierAddressIdSelector',
      title: 'Supplier Address',
      type: 'project-selector',
      canonicalParamId: 'supplierAddressId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.supplierAddresses',
      dependsOn: ['oauthCredential', 'supplierId'],
      mode: 'basic',
      placeholder: 'Select supplier address',
      condition: { field: 'operation', value: SUPPLIER_ADDRESS_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'supplierAddressIdManual',
      title: 'Supplier Address',
      type: 'short-input',
      canonicalParamId: 'supplierAddressId',
      mode: 'advanced',
      placeholder: 'Existing SupplierAddressId belonging to this supplier, as a decimal string',
      condition: { field: 'operation', value: SUPPLIER_ADDRESS_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'procurementBUIdSelector',
      title: 'Procurement Business Unit (PO Access)',
      type: 'project-selector',
      canonicalParamId: 'procurementBUId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.procurementBusinessUnits',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'PO-enabled units; enter a manual ID for other procurement roles',
      condition: { field: 'operation', value: PROCUREMENT_BUID_OPERATIONS },
      required: true,
    },
    {
      id: 'procurementBUIdManual',
      title: 'Procurement Business Unit',
      type: 'short-input',
      canonicalParamId: 'procurementBUId',
      mode: 'advanced',
      placeholder: 'Numeric procurement business-unit ID, as a decimal string',
      condition: { field: 'operation', value: PROCUREMENT_BUID_OPERATIONS },
      required: true,
    },
    {
      id: 'preparerIdSelector',
      title: 'Requisition Preparer',
      type: 'project-selector',
      canonicalParamId: 'preparerId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.procurementPersons',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select requisition preparer',
      condition: { field: 'operation', value: PREPARER_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'preparerIdManual',
      title: 'Requisition Preparer',
      type: 'short-input',
      canonicalParamId: 'preparerId',
      mode: 'advanced',
      placeholder: 'Numeric person ID of the requisition preparer, as a decimal string',
      condition: { field: 'operation', value: PREPARER_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'requisitioningBUId',
      title: 'Requisitioning Business Unit ID',
      type: 'short-input',
      placeholder: 'Numeric requisitioning business-unit ID, as a decimal string',
      condition: { field: 'operation', value: REQUISITIONING_BUID_OPERATIONS },
      required: true,
    },
    {
      id: 'buyerIdSelector',
      title: 'Buyer',
      type: 'project-selector',
      canonicalParamId: 'buyerId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.buyers',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select buyer',
      condition: { field: 'operation', value: BUYER_ID_OPERATIONS },
      required: { field: 'operation', value: REQUIRED_BUYER_ID_OPERATIONS },
    },
    {
      id: 'buyerIdManual',
      title: 'Buyer',
      type: 'short-input',
      canonicalParamId: 'buyerId',
      mode: 'advanced',
      placeholder: 'Numeric buyer person ID, as a decimal string (not the agent assignment ID)',
      condition: { field: 'operation', value: BUYER_ID_OPERATIONS },
      required: { field: 'operation', value: REQUIRED_BUYER_ID_OPERATIONS },
    },
    {
      id: 'documentStyleIdSelector',
      title: 'Document Style',
      type: 'project-selector',
      canonicalParamId: 'documentStyleId',
      serviceId: 'oracle_fusion_procurement',
      selectorKey: 'oracle_fusion_procurement.purchasingDocumentStyles',
      dependsOn: ['oauthCredential'],
      mode: 'basic',
      placeholder: 'Select document style',
      condition: { field: 'operation', value: DOCUMENT_STYLE_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'documentStyleIdManual',
      title: 'Document Style',
      type: 'short-input',
      canonicalParamId: 'documentStyleId',
      mode: 'advanced',
      placeholder: 'Numeric purchasing document StyleId, as a decimal string',
      condition: { field: 'operation', value: DOCUMENT_STYLE_ID_OPERATIONS },
      required: true,
    },
    {
      id: 'negotiationTitle',
      title: 'Negotiation Title',
      type: 'short-input',
      placeholder: 'Negotiation title (maximum 80 characters)',
      condition: { field: 'operation', value: NEGOTIATION_TITLE_OPERATIONS },
      required: true,
    },
    {
      id: 'actionIntent',
      title: 'Validate or Publish',
      type: 'dropdown',
      options: [
        { label: 'Validate only', id: 'Validate' },
        { label: 'Publish negotiation', id: 'Publish' },
      ],
      value: () => 'Validate',
      condition: { field: 'operation', value: ACTION_INTENT_OPERATIONS },
      required: true,
    },
    {
      id: 'holdReason',
      title: 'Hold Reason',
      type: 'short-input',
      placeholder: 'Reason for placing the purchase order on hold',
      condition: { field: 'operation', value: HOLD_REASON_OPERATIONS },
      required: false,
    },
    {
      id: 'removeHoldReason',
      title: 'Remove Hold Reason',
      type: 'short-input',
      placeholder: 'Reason for removing the purchase-order hold',
      condition: { field: 'operation', value: REMOVE_HOLD_REASON_OPERATIONS },
      required: false,
    },
    {
      id: 'requestFundsOverrideFlag',
      title: 'Request Funds Override',
      type: 'dropdown',
      options: [
        { label: 'Use Oracle default', id: '' },
        { label: 'True', id: 'true' },
        { label: 'False', id: 'false' },
      ],
      condition: { field: 'operation', value: REQUEST_FUNDS_OVERRIDE_FLAG_OPERATIONS },
    },
    {
      id: 'validateBeforeSubmitFlag',
      title: 'Validate Before Submission',
      type: 'dropdown',
      options: [
        { label: 'Use Oracle default', id: '' },
        { label: 'True', id: 'true' },
        { label: 'False', id: 'false' },
      ],
      condition: { field: 'operation', value: VALIDATE_BEFORE_SUBMIT_FLAG_OPERATIONS },
    },
    {
      id: 'ignoreWarnings',
      title: 'Ignore Publishing Warnings',
      type: 'dropdown',
      options: [
        { label: 'Use Oracle default', id: '' },
        { label: 'True', id: 'true' },
        { label: 'False', id: 'false' },
      ],
      condition: { field: 'operation', value: IGNORE_WARNINGS_OPERATIONS },
    },
    {
      id: 'body',
      title: 'Document Fields',
      type: 'code',
      language: 'json',
      placeholder: '{"Description":"Requested change"}',
      condition: { field: 'operation', value: WRITE_OPERATIONS },
      required: { field: 'operation', value: UPDATE_OPERATIONS },
    },
    {
      id: 'q',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'Oracle q expression for this resource',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Write an Oracle Fusion REST q filter for the selected Procurement resource using only its documented queryable attributes. Examples: suppliers uses SupplierNumber=1001; purchase orders uses POHeaderId=300100123456789. Combine conditions with semicolons. Do not invent field names or include a URL. Return ONLY the q expression.',
        placeholder: 'Describe the records to find and their documented attributes',
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Attribute:asc',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '100 (maximum 100)',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '0',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    {
      id: 'totalResults',
      title: 'Include Estimated Total',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Use Oracle default', id: '' },
        { label: 'True', id: 'true' },
        { label: 'False', id: 'false' },
      ],
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
  ],
  tools: {
    access: [
      'oracle_fusion_procurement_create_draft_purchase_order',
      'oracle_fusion_procurement_create_purchase_requisition',
      'oracle_fusion_procurement_create_supplier',
      'oracle_fusion_procurement_create_supplier_negotiation',
      'oracle_fusion_procurement_create_supplier_site',
      'oracle_fusion_procurement_get_draft_purchase_order',
      'oracle_fusion_procurement_get_procurement_agent',
      'oracle_fusion_procurement_get_purchase_order',
      'oracle_fusion_procurement_get_purchase_order_lifecycle_details',
      'oracle_fusion_procurement_get_purchase_order_receipt',
      'oracle_fusion_procurement_get_purchase_requisition',
      'oracle_fusion_procurement_get_supplier',
      'oracle_fusion_procurement_get_supplier_negotiation',
      'oracle_fusion_procurement_get_supplier_negotiation_response',
      'oracle_fusion_procurement_get_supplier_site',
      'oracle_fusion_procurement_hold_purchase_order',
      'oracle_fusion_procurement_list_draft_purchase_order_lines',
      'oracle_fusion_procurement_list_draft_purchase_orders',
      'oracle_fusion_procurement_list_procurement_agents',
      'oracle_fusion_procurement_list_purchase_order_lines',
      'oracle_fusion_procurement_list_purchase_order_receipts',
      'oracle_fusion_procurement_list_purchase_orders',
      'oracle_fusion_procurement_list_purchase_requisition_lines',
      'oracle_fusion_procurement_list_purchase_requisitions',
      'oracle_fusion_procurement_list_supplier_negotiation_responses',
      'oracle_fusion_procurement_list_supplier_negotiations',
      'oracle_fusion_procurement_list_supplier_sites',
      'oracle_fusion_procurement_list_suppliers',
      'oracle_fusion_procurement_remove_purchase_order_hold',
      'oracle_fusion_procurement_submit_draft_purchase_order',
      'oracle_fusion_procurement_submit_purchase_requisition',
      'oracle_fusion_procurement_update_draft_purchase_order',
      'oracle_fusion_procurement_update_purchase_requisition',
      'oracle_fusion_procurement_update_supplier',
      'oracle_fusion_procurement_update_supplier_negotiation',
      'oracle_fusion_procurement_update_supplier_site',
      'oracle_fusion_procurement_validate_draft_purchase_order',
      'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
      'oracle_fusion_procurement_withdraw_purchase_requisition',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const operation = params.operation
        if (typeof operation !== 'string') return {}
        const result: Record<string, unknown> = {}
        for (const [field, operations] of Object.entries(INPUT_OPERATIONS)) {
          const active = typeof operation === 'string' && operations.includes(operation)
          if (!active) {
            result[field] = undefined
          } else if (field === 'body') {
            // Keep JSON strings intact; the server rejects already-imprecise numeric IDs.
            result[field] = params[field] === '' ? undefined : params[field]
          } else if (field === 'limit' || field === 'offset') {
            result[field] = parseOptionalNumberInput(params[field], field, {
              integer: true,
              min: field === 'limit' ? 1 : 0,
              max: field === 'limit' ? 100 : 1_000_000,
            })
          } else if ([
            'totalResults', 'requestFundsOverrideFlag', 'validateBeforeSubmitFlag', 'ignoreWarnings',
          ].includes(field)) {
            result[field] = parseOptionalBooleanInput(params[field], field)
          } else {
            result[field] = optionalString(params[field], field)
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Procurement operation to perform' },
    oauthCredential: { type: 'string', description: 'Oracle Fusion service-account credential' },
    supplierId: {
      type: 'string',
      description: 'Numeric SupplierId, preserved as a decimal string',
    },
    supplierSiteId: {
      type: 'string',
      description: 'Numeric SupplierSiteId belonging to the selected supplier, as a decimal string',
    },
    requisitionKey: {
      type: 'string',
      description: 'Opaque purchase-requisition key from the key output; do not substitute RequisitionHeaderId',
    },
    draftPurchaseOrderKey: {
      type: 'string',
      description: 'Opaque draft purchase-order key from the key output; do not substitute POHeaderId',
    },
    purchaseOrderKey: {
      type: 'string',
      description: 'Opaque approved purchase-order key from the key output; do not substitute POHeaderId',
    },
    poHeaderId: {
      type: 'string',
      description: 'Numeric POHeaderId from a purchase order, as a decimal string (not its opaque key)',
    },
    receiptKey: {
      type: 'string',
      description: 'Opaque receipt key from List Purchase Order Receipts for this POHeaderId; not ReceiptId',
    },
    negotiationKey: {
      type: 'string',
      description: 'Opaque supplier-negotiation key from the key output; not AuctionHeaderId',
    },
    negotiationId: {
      type: 'string',
      description: 'Numeric AuctionHeaderId to filter negotiation responses, as a decimal string',
    },
    responseKey: {
      type: 'string',
      description: 'Opaque supplier-negotiation-response key from the key output; not ResponseNumber',
    },
    assignmentId: {
      type: 'string',
      description: 'Numeric procurement-agent AssignmentId, as a decimal string (not AgentId)',
    },
    supplierName: {
      type: 'string',
      description: 'Supplier name (maximum 360 characters)',
    },
    supplierSiteName: {
      type: 'string',
      description: 'Supplier site name (maximum 240 characters)',
    },
    supplierAddressId: {
      type: 'string',
      description: 'Existing SupplierAddressId belonging to this supplier, as a decimal string',
    },
    procurementBUId: {
      type: 'string',
      description: 'Numeric procurement business-unit ID, as a decimal string',
    },
    preparerId: {
      type: 'string',
      description: 'Numeric person ID of the requisition preparer, as a decimal string',
    },
    requisitioningBUId: {
      type: 'string',
      description: 'Numeric requisitioning business-unit ID, as a decimal string',
    },
    buyerId: {
      type: 'string',
      description: 'Numeric buyer person ID, as a decimal string (not the agent assignment ID)',
    },
    documentStyleId: {
      type: 'string',
      description: 'Numeric purchasing document StyleId, as a decimal string',
    },
    negotiationTitle: {
      type: 'string',
      description: 'Negotiation title (maximum 80 characters)',
    },
    actionIntent: {
      type: 'string',
      description: 'Explicit action intent: Validate or Publish. Validation does not publish the negotiation',
    },
    holdReason: {
      type: 'string',
      description: 'Reason for placing the purchase order on hold',
    },
    removeHoldReason: {
      type: 'string',
      description: 'Reason for removing the purchase-order hold',
    },
    requestFundsOverrideFlag: {
      type: 'boolean',
      description: 'Explicitly request a funds override when submitting the requisition',
    },
    validateBeforeSubmitFlag: {
      type: 'boolean',
      description: 'Validate the draft purchase order before submission; Oracle defaults to false when omitted',
    },
    ignoreWarnings: {
      type: 'boolean',
      description: 'Explicitly ignore negotiation publishing warnings (true maps to Y, false to N)',
    },
    body: { type: 'json', description: 'Documented fields for the selected create or header update' },
    q: { type: 'string', description: 'Oracle resource filter expression' },
    orderBy: { type: 'string', description: 'Comma-separated ordering attributes' },
    limit: { type: 'number', description: 'Page size from 1 through 100' },
    offset: { type: 'number', description: 'Zero-based page offset, at most 1000000' },
    totalResults: { type: 'boolean', description: 'Request an estimated total' },
  },
  outputs: {
    items: {
      type: 'array',
      description:
        'One page of selected resource fields, including exact numeric IDs, document numbers, statuses, and opaque key where required by the resource',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    count: {
      type: 'number',
      description: 'Number of records in this page',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page exists',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    limit: {
      type: 'number',
      description: 'Page size returned by Oracle',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    offset: {
      type: 'number',
      description: 'Offset returned by Oracle',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    totalResults: {
      type: 'number',
      description: 'Estimated total when requested and returned',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    nextOffset: {
      type: 'number',
      description: 'Next page offset when hasMore is true',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    draftPurchaseOrder: {
      type: 'json',
      description:
        'Draft purchase order (opaque key, numeric POHeaderId, OrderNumber, Status, BuyerId, SupplierId, SupplierSiteId, CurrencyCode)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_create_draft_purchase_order',
          'oracle_fusion_procurement_get_draft_purchase_order',
          'oracle_fusion_procurement_update_draft_purchase_order',
        ],
      },
    },
    purchaseRequisition: {
      type: 'json',
      description:
        'Requisition (opaque key, numeric RequisitionHeaderId, Requisition, DocumentStatus, PreparerId, RequisitioningBUId)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_create_purchase_requisition',
          'oracle_fusion_procurement_get_purchase_requisition',
          'oracle_fusion_procurement_update_purchase_requisition',
        ],
      },
    },
    supplier: {
      type: 'json',
      description:
        'Supplier procurement profile (SupplierId, Supplier, SupplierNumber, BusinessRelationship, Status); no child address IDs',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_create_supplier',
          'oracle_fusion_procurement_get_supplier',
          'oracle_fusion_procurement_update_supplier',
        ],
      },
    },
    supplierNegotiation: {
      type: 'json',
      description:
        'Negotiation (opaque key, numeric AuctionHeaderId, Negotiation, NegotiationTitle, NegotiationStatus, BuyerId, OpenDate, CloseDate)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_create_supplier_negotiation',
          'oracle_fusion_procurement_get_supplier_negotiation',
          'oracle_fusion_procurement_update_supplier_negotiation',
        ],
      },
    },
    supplierSite: {
      type: 'json',
      description:
        'Purchasing site (SupplierSiteId, SupplierSite, ProcurementBUId, SupplierAddressId, purchasing/sourcing flags, Status)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_create_supplier_site',
          'oracle_fusion_procurement_get_supplier_site',
          'oracle_fusion_procurement_update_supplier_site',
        ],
      },
    },
    procurementAgent: {
      type: 'json',
      description:
        'Agent assignment (AssignmentId, person AgentId, Agent, ProcurementBUId, Status, procurement permissions)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_get_procurement_agent',
        ],
      },
    },
    purchaseOrder: {
      type: 'json',
      description:
        'Purchase order (opaque key, numeric POHeaderId, OrderNumber, Status, SupplierId, SupplierSiteId, Ordered, Total, CurrencyCode)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_get_purchase_order',
        ],
      },
    },
    lifecycleDetails: {
      type: 'json',
      description:
        'Purchase-order lifecycle summary (POHeaderId, OrderNumber, CurrencyCode, ordered, delivered, receiving, transit, and payment amounts)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_get_purchase_order_lifecycle_details',
        ],
      },
    },
    purchaseOrderReceipt: {
      type: 'json',
      description:
        'Receipt visibility (opaque key, numeric ReceiptId and POHeaderId, Receipt, ReceiptDate, received/delivered/returned quantities)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_get_purchase_order_receipt',
        ],
      },
    },
    supplierNegotiationResponse: {
      type: 'json',
      description:
        'Supplier-visible response (opaque key, numeric ResponseNumber and AuctionHeaderId, Supplier, ResponseStatus, string ResponseAmount, ResponseCurrencyCode)',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_procurement_get_supplier_negotiation_response',
        ],
      },
    },
    result: {
      type: 'json',
      description:
        'Action result: submit/hold returns a status string; withdraw returns STATUS records with CODE; draft validation returns message records; negotiation returns Status, Message, Negotiation, ErrorsListId',
      condition: { field: 'operation', value: ACTION_OPERATIONS },
    },
    businessSuccess: {
      type: 'boolean',
      description: 'Whether Oracle explicitly reported business success',
      condition: { field: 'operation', value: BUSINESS_RESULT_OPERATIONS },
    },
    hasMessages: {
      type: 'boolean',
      description: 'Draft validation returned warnings or errors; inspect result before submitting',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_procurement_validate_draft_purchase_order',
      },
    },
  },
}

// Workflow precedents: Oracle 26C supplier/requisition/draft-order create examples,
// purchasing hold and lifecycle APIs, and ValidateAndPublishNegotiation examples.
export const OracleFusionProcurementBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/erp/procurement/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Prepare a supplier onboarding draft',
      prompt:
        'Create a workflow that accepts approved supplier details and creates a prospective supplier with an ordering address. Oracle spend authorization must be completed outside this integration before creating a purchasing site. After confirming that prerequisite, have the operator select an existing address for the returned SupplierId and explicitly create the site. Do not assume address IDs are returned by Create Supplier, and do not configure bank accounts or tax registrations.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Prepare purchase requisitions',
      prompt:
        'Build a workflow that gathers a requester and business unit, creates a requisition with noncatalog lines, and shows the draft for review. Submit the requisition only after explicit user approval and report the Oracle business result.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Validate draft purchase orders',
      prompt:
        'Create a workflow that prepares a draft purchase order, retrieves its lines, and runs Validate Draft Purchase Order. Present every warning and error for review and submit only after explicit approval.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor supplier profile changes',
      prompt:
        'Build a scheduled workflow that reads one filtered page of supplier profiles changed since the last checkpoint, compares the selected procurement fields with a table, and reports changes. Persist pagination state explicitly and do not fetch every page in one invocation.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review purchase-order receipt exceptions',
      prompt:
        'Build a scheduled workflow that compares purchase-order lines with procurement-facing receipt quantities and lifecycle delivery summaries. Flag delivery or return exceptions for buyers without posting SCM receiving or inventory transactions.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Control purchase-order holds',
      prompt:
        'Create a workflow that retrieves a purchase order and procurement-agent context, requests a hold reason and explicit approval, and executes Hold Purchase Order. Require a separate approved action and reason to remove the hold.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Brief sourcing negotiation responses',
      prompt:
        'Build a workflow that reads one page of supplier negotiation responses visible to the authenticated supplier user, optionally filtered by AuctionHeaderId, and summarizes response amount, currency, and status. Require the Oracle View Supplier Negotiation Response as Supplier privilege; do not imply buyer-wide bid visibility or award or publish automatically.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'maintain-procurement-suppliers',
      description: 'Maintain supplier and purchasing-site profiles',
      content:
        '# Maintain supplier and purchasing-site profiles\n\n## Steps\n\n1. List or get the supplier and preserve SupplierId as a string.\n2. For new suppliers, create only approved procurement fields and optional ordering addresses.\n3. Require completed Oracle spend authorization outside this integration, then select an existing supplier address before creating a purchasing site.\n4. Update only intended header fields; leave banking, invoice, and tax-registration workflows to Financials.\n\n## Output\n\nReturn supplier/site identifiers and selected procurement fields.',
    },
    {
      name: 'prepare-purchase-requisitions',
      description: 'Prepare and explicitly submit purchase requisitions',
      content:
        '# Prepare and explicitly submit purchase requisitions\n\n## Steps\n\n1. Select a preparer and enter an authorized requisitioning business unit.\n2. Create a requisition draft with documented line fields; quote integer IDs in JSON.\n3. Retrieve the requisition and lines for review.\n4. Submit only after explicit approval, and use Withdraw only when requested.\n\n## Output\n\nReport the requisition key, numeric header ID, and business result.',
    },
    {
      name: 'validate-procurement-drafts',
      description: 'Validate draft purchase orders before approved submission',
      content:
        '# Validate draft purchase orders before approved submission\n\n## Steps\n\n1. Select buyer, document style, supplier, site, and procurement business unit.\n2. Create a draft and retrieve its lines.\n3. Validate the draft and inspect every returned message; HTTP success is not a validation pass.\n4. Submit only after the user approves the intended document.\n\n## Output\n\nReturn the draft key, POHeaderId, validation messages, and submission result.',
    },
    {
      name: 'control-procurement-order-holds',
      description: 'Apply or remove purchase-order holds with explicit intent',
      content:
        '# Apply or remove purchase-order holds with explicit intent\n\n## Steps\n\n1. Retrieve the approved purchase order using its opaque key.\n2. Confirm the requested hold or release and record the reason.\n3. Execute only the selected action.\n4. Check the returned businessSuccess flag and retrieve the order if confirmation is needed.\n\n## Output\n\nState the requested action and its reported business outcome.',
    },
    {
      name: 'review-procurement-receipts',
      description: 'Inspect procurement-facing receipt and delivery information',
      content:
        '# Inspect procurement-facing receipt and delivery information\n\n## Steps\n\n1. Find the purchase order and preserve its numeric POHeaderId.\n2. Read lifecycle details and one page of purchase-order receipts.\n3. Use each receipt self-link key with the same POHeaderId for detail requests.\n4. Report delivery and return exceptions without posting SCM transactions.\n\n## Output\n\nReturn receipt references, quantities, and lifecycle status evidence.',
    },
    {
      name: 'manage-sourcing-negotiation-drafts',
      description: 'Prepare sourcing negotiations and explicitly validate or publish',
      content:
        '# Prepare sourcing negotiations and explicitly validate or publish\n\n## Steps\n\n1. Select the procurement business unit and prepare a negotiation draft with documented lines and invited suppliers.\n2. Choose Validate explicitly before publishing.\n3. Treat result.Status ERROR as a business failure even after HTTP success.\n4. Publish only with explicit approval; do not ignore warnings unless the user requests it.\n\n## Output\n\nReturn the negotiation key and the projected validation or publication result.',
    },
    {
      name: 'review-sourcing-responses-and-agents',
      description: 'Discover supplier responses and procurement-agent context',
      content:
        '# Discover supplier responses and procurement-agent context\n\n## Steps\n\n1. Require View Supplier Negotiation Response as Supplier for response reads; optionally filter the supplier-visible results with a known numeric AuctionHeaderId. Do not imply buyer-wide bid access.\n2. Read one page and preserve response keys separately from ResponseNumber.\n3. Review response amounts in their documented currencies.\n4. With a separately authorized procurement-agent identity when necessary, inspect business-unit assignments without modifying permissions.\n\n## Output\n\nReturn a bounded response summary and any separately authorized agent assignments.',
    },
  ],
} as const satisfies BlockMeta
