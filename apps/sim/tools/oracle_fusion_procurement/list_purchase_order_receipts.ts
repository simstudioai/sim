import {
  createProcurementTool,
  procurementListParams,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  PURCHASE_ORDER_RECEIPT_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListPurchaseOrderReceiptsTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_purchase_order_receipts',
  name: 'Oracle Fusion Procurement List Purchase Order Receipts',
  description:
    'Read one page of procurement-facing purchase-order lifecycle receipts. These are receipt/schedule views, not SCM receiving transactions.',
  params: {
    ...procurementListParams,
    poHeaderId: procurementParamFields.poHeaderId,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of purchase Order Receipts',
      items: { type: 'object', properties: PURCHASE_ORDER_RECEIPT_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
