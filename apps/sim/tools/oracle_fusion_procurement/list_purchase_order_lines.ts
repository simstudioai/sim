import {
  createProcurementTool,
  procurementListParams,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  PURCHASE_ORDER_LINE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListPurchaseOrderLinesTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_purchase_order_lines',
  name: 'Oracle Fusion Procurement List Purchase Order Lines',
  description:
    'List Purchase Order Lines in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
    purchaseOrderKey: procurementParamFields.purchaseOrderKey,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of purchase Order Lines',
      items: { type: 'object', properties: PURCHASE_ORDER_LINE_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
