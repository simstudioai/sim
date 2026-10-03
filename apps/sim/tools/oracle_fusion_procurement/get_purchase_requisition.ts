import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PURCHASE_REQUISITION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetPurchaseRequisitionTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_purchase_requisition',
  name: 'Oracle Fusion Procurement Get Purchase Requisition',
  description:
    'Get Purchase Requisition in Oracle Fusion Procurement. Return selected documented fields and preserve exact Oracle identifiers.',
  params: {
    requisitionKey: procurementParamFields.requisitionKey,
  },
  outputs: {
    purchaseRequisition: {
      type: 'object',
      description: 'Purchase Requisition fields',
      properties: PURCHASE_REQUISITION_OUTPUT_PROPERTIES,
    },
  },
})
