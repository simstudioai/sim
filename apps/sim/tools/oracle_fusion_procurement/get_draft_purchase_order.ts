import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetDraftPurchaseOrderTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_draft_purchase_order',
  name: 'Oracle Fusion Procurement Get Draft Purchase Order',
  description:
    'Get Draft Purchase Order in Oracle Fusion Procurement. Return selected documented fields and preserve exact Oracle identifiers.',
  params: {
    draftPurchaseOrderKey: procurementParamFields.draftPurchaseOrderKey,
  },
  outputs: {
    draftPurchaseOrder: {
      type: 'object',
      description: 'Draft Purchase Order fields',
      properties: DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES,
    },
  },
})
