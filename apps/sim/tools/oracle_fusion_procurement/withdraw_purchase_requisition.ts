import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PROCUREMENT_WITHDRAW_ACTION_OUTPUTS } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementWithdrawPurchaseRequisitionTool = createProcurementTool({
  id: 'oracle_fusion_procurement_withdraw_purchase_requisition',
  name: 'Oracle Fusion Procurement Withdraw Purchase Requisition',
  description:
    'Explicitly withdraw a purchase requisition and check the nested STATUS/CODE business result.',
  params: {
    requisitionKey: procurementParamFields.requisitionKey,
  },
  outputs: PROCUREMENT_WITHDRAW_ACTION_OUTPUTS,
})
