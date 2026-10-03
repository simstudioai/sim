import {
  createProcurementTool,
  procurementListParams,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  SUPPLIER_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListSuppliersTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_suppliers',
  name: 'Oracle Fusion Procurement List Suppliers',
  description:
    'List Suppliers in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of suppliers',
      items: { type: 'object', properties: SUPPLIER_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
