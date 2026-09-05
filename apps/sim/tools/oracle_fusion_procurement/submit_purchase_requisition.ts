import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PROCUREMENT_STRING_ACTION_OUTPUTS } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementSubmitPurchaseRequisitionTool = createProcurementTool({
  id: 'oracle_fusion_procurement_submit_purchase_requisition',
  name: 'Oracle Fusion Procurement Submit Purchase Requisition',
  description:
    'Explicitly submit a purchase requisition for approval and check the documented business result.',
  params: {
    requisitionKey: procurementParamFields.requisitionKey,
    requestFundsOverrideFlag: { ...procurementParamFields.requestFundsOverrideFlag, required: false },
  },
  outputs: PROCUREMENT_STRING_ACTION_OUTPUTS,
})
