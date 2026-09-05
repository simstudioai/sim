import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_SITE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetSupplierSiteTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_supplier_site',
  name: 'Oracle Fusion Procurement Get Supplier Site',
  description:
    'Get Supplier Site in Oracle Fusion Procurement. Return selected documented fields and preserve exact Oracle identifiers.',
  params: {
    supplierId: procurementParamFields.supplierId,
    supplierSiteId: procurementParamFields.supplierSiteId,
  },
  outputs: {
    supplierSite: {
      type: 'object',
      description: 'Supplier Site fields',
      properties: SUPPLIER_SITE_OUTPUT_PROPERTIES,
    },
  },
})
