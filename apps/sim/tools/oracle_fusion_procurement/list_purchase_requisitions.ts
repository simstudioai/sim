import {
  createProcurementTool,
  procurementListParams,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  PURCHASE_REQUISITION_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListPurchaseRequisitionsTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_purchase_requisitions',
  name: 'Oracle Fusion Procurement List Purchase Requisitions',
  description:
    'List Purchase Requisitions in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of purchase Requisitions',
      items: { type: 'object', properties: PURCHASE_REQUISITION_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
