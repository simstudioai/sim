import {
  createProcurementTool,
  procurementListParams,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  PURCHASE_REQUISITION_LINE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListPurchaseRequisitionLinesTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_purchase_requisition_lines',
  name: 'Oracle Fusion Procurement List Purchase Requisition Lines',
  description:
    'List Purchase Requisition Lines in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
    requisitionKey: procurementParamFields.requisitionKey,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of purchase Requisition Lines',
      items: { type: 'object', properties: PURCHASE_REQUISITION_LINE_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
