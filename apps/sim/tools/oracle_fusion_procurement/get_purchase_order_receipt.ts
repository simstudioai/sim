import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PURCHASE_ORDER_RECEIPT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetPurchaseOrderReceiptTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_purchase_order_receipt',
  name: 'Oracle Fusion Procurement Get Purchase Order Receipt',
  description:
    'Read one procurement-facing lifecycle receipt using its self-link key and numeric POHeaderId, not ReceiptId alone.',
  params: {
    poHeaderId: procurementParamFields.poHeaderId,
    receiptKey: procurementParamFields.receiptKey,
  },
  outputs: {
    purchaseOrderReceipt: {
      type: 'object',
      description: 'Purchase Order Receipt fields',
      properties: PURCHASE_ORDER_RECEIPT_OUTPUT_PROPERTIES,
    },
  },
})
