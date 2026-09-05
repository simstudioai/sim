import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementUpdateSupplierTool = createProcurementTool({
  id: 'oracle_fusion_procurement_update_supplier',
  name: 'Oracle Fusion Procurement Update Supplier',
  description:
    'Update Supplier in Oracle Fusion Procurement. Update only the supplied documented header fields. Unspecified fields are left unchanged.',
  params: {
    supplierId: procurementParamFields.supplierId,
    body: {
      type: 'json',
      required: true,
      description:
        'Header fields as a JSON object: Supplier, AlternateName, Alias, CorporateWebsite, SupplierTypeCode, OneTimeSupplierFlag, ParentSupplierId, InactiveDate. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields.',
    },
  },
  outputs: {
    supplier: {
      type: 'object',
      description: 'Supplier fields',
      properties: SUPPLIER_OUTPUT_PROPERTIES,
    },
  },
})
