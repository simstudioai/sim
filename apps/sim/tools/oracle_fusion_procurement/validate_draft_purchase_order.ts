import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PROCUREMENT_VALIDATION_ACTION_OUTPUTS } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementValidateDraftPurchaseOrderTool = createProcurementTool({
  id: 'oracle_fusion_procurement_validate_draft_purchase_order',
  name: 'Oracle Fusion Procurement Validate Draft Purchase Order',
  description:
    'Retrieve draft purchase-order validation warnings and errors without submitting. An HTTP success does not mean the document is valid; inspect result and hasMessages.',
  params: {
    draftPurchaseOrderKey: procurementParamFields.draftPurchaseOrderKey,
  },
  outputs: PROCUREMENT_VALIDATION_ACTION_OUTPUTS,
})
