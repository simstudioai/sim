import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PROCUREMENT_STRING_ACTION_OUTPUTS } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementSubmitDraftPurchaseOrderTool = createProcurementTool({
  id: 'oracle_fusion_procurement_submit_draft_purchase_order',
  name: 'Oracle Fusion Procurement Submit Draft Purchase Order',
  description:
    'Explicitly submit a draft purchase order for approval. Does not bypass approvals or retry the mutation automatically.',
  params: {
    draftPurchaseOrderKey: procurementParamFields.draftPurchaseOrderKey,
    validateBeforeSubmitFlag: {
      ...procurementParamFields.validateBeforeSubmitFlag,
      required: false,
    },
  },
  outputs: PROCUREMENT_STRING_ACTION_OUTPUTS,
})
