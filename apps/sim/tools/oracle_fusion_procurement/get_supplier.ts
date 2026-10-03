import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetSupplierTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_supplier',
  name: 'Oracle Fusion Procurement Get Supplier',
  description:
    'Get Supplier in Oracle Fusion Procurement. Return selected documented fields and preserve exact Oracle identifiers.',
  params: {
    supplierId: procurementParamFields.supplierId,
  },
  outputs: {
    supplier: {
      type: 'object',
      description: 'Supplier fields',
      properties: SUPPLIER_OUTPUT_PROPERTIES,
    },
  },
})
