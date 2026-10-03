import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PURCHASE_ORDER_LIFECYCLE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetPurchaseOrderLifecycleDetailsTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_purchase_order_lifecycle_details',
  name: 'Oracle Fusion Procurement Get Purchase Order Lifecycle Details',
  description:
    'Read a purchase-order lifecycle summary, including receiving and payment visibility. Does not create receipts, invoices, or payments.',
  params: {
    poHeaderId: procurementParamFields.poHeaderId,
  },
  outputs: {
    lifecycleDetails: {
      type: 'object',
      description: 'Lifecycle Details fields',
      properties: PURCHASE_ORDER_LIFECYCLE_OUTPUT_PROPERTIES,
    },
  },
})
