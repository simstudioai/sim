import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PURCHASE_ORDER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetPurchaseOrderTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_purchase_order',
  name: 'Oracle Fusion Procurement Get Purchase Order',
  description:
    'Get Purchase Order in Oracle Fusion Procurement. Return selected documented fields and preserve exact Oracle identifiers.',
  params: {
    purchaseOrderKey: procurementParamFields.purchaseOrderKey,
  },
  outputs: {
    purchaseOrder: {
      type: 'object',
      description: 'Purchase Order fields',
      properties: PURCHASE_ORDER_OUTPUT_PROPERTIES,
    },
  },
})
