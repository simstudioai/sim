import {
  createProcurementTool,
  procurementListParams,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  SUPPLIER_NEGOTIATION_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListSupplierNegotiationsTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_supplier_negotiations',
  name: 'Oracle Fusion Procurement List Supplier Negotiations',
  description:
    'List Supplier Negotiations in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of supplier Negotiations',
      items: { type: 'object', properties: SUPPLIER_NEGOTIATION_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
