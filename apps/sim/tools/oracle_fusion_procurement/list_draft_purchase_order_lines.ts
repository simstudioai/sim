import {
  createProcurementTool,
  procurementListParams,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  DRAFT_PURCHASE_ORDER_LINE_OUTPUT_PROPERTIES,
  PROCUREMENT_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListDraftPurchaseOrderLinesTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_draft_purchase_order_lines',
  name: 'Oracle Fusion Procurement List Draft Purchase Order Lines',
  description:
    'List Draft Purchase Order Lines in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
    draftPurchaseOrderKey: procurementParamFields.draftPurchaseOrderKey,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of draft Purchase Order Lines',
      items: { type: 'object', properties: DRAFT_PURCHASE_ORDER_LINE_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
