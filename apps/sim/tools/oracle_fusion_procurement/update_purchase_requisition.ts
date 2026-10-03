import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PURCHASE_REQUISITION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementUpdatePurchaseRequisitionTool = createProcurementTool({
  id: 'oracle_fusion_procurement_update_purchase_requisition',
  name: 'Oracle Fusion Procurement Update Purchase Requisition',
  description:
    'Update Purchase Requisition in Oracle Fusion Procurement. Update only the supplied documented header fields. Unspecified fields are left unchanged.',
  params: {
    requisitionKey: procurementParamFields.requisitionKey,
    body: {
      type: 'json',
      required: true,
      description:
        'Header fields as a JSON object: PreparerId, RequisitioningBUId, Description, Justification, EmergencyRequisitionFlag. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields.',
    },
  },
  outputs: {
    purchaseRequisition: {
      type: 'object',
      description: 'Purchase Requisition fields',
      properties: PURCHASE_REQUISITION_OUTPUT_PROPERTIES,
    },
  },
})
