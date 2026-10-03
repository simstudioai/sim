import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementUpdateDraftPurchaseOrderTool = createProcurementTool({
  id: 'oracle_fusion_procurement_update_draft_purchase_order',
  name: 'Oracle Fusion Procurement Update Draft Purchase Order',
  description:
    'Update Draft Purchase Order in Oracle Fusion Procurement. Update only the supplied documented header fields. Unspecified fields are left unchanged.',
  params: {
    draftPurchaseOrderKey: procurementParamFields.draftPurchaseOrderKey,
    body: {
      type: 'json',
      required: true,
      description:
        'Header fields as a JSON object: BuyerId, SupplierSiteId, Description, NoteToSupplier, NoteToReceiver, BillToLocationId. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields.',
    },
  },
  outputs: {
    draftPurchaseOrder: {
      type: 'object',
      description: 'Draft Purchase Order fields',
      properties: DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES,
    },
  },
})
