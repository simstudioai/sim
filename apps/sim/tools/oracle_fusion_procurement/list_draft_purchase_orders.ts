import {
  createProcurementTool,
  procurementListParams,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES,
  PROCUREMENT_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListDraftPurchaseOrdersTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_draft_purchase_orders',
  name: 'Oracle Fusion Procurement List Draft Purchase Orders',
  description:
    'List Draft Purchase Orders in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of draft Purchase Orders',
      items: { type: 'object', properties: DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
