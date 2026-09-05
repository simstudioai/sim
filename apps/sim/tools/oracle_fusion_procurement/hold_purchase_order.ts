import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PROCUREMENT_STRING_ACTION_OUTPUTS } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementHoldPurchaseOrderTool = createProcurementTool({
  id: 'oracle_fusion_procurement_hold_purchase_order',
  name: 'Oracle Fusion Procurement Hold Purchase Order',
  description:
    'Explicitly place an approved purchase order on hold and check the Oracle action result.',
  params: {
    purchaseOrderKey: procurementParamFields.purchaseOrderKey,
    holdReason: { ...procurementParamFields.holdReason, required: false },
  },
  outputs: PROCUREMENT_STRING_ACTION_OUTPUTS,
})
