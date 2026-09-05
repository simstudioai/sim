import {
  createProcurementTool,
  procurementListParams,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  PURCHASE_ORDER_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListPurchaseOrdersTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_purchase_orders',
  name: 'Oracle Fusion Procurement List Purchase Orders',
  description:
    'List Purchase Orders in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of purchase Orders',
      items: { type: 'object', properties: PURCHASE_ORDER_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
