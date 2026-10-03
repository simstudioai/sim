import {
  createProcurementTool,
  procurementListParams,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  SUPPLIER_SITE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListSupplierSitesTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_supplier_sites',
  name: 'Oracle Fusion Procurement List Supplier Sites',
  description:
    'List Supplier Sites in Oracle Fusion Procurement. Fetch one bounded page; use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
    supplierId: procurementParamFields.supplierId,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of supplier Sites',
      items: { type: 'object', properties: SUPPLIER_SITE_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
