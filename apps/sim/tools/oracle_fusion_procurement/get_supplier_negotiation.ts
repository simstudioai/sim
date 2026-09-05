import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_NEGOTIATION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetSupplierNegotiationTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_supplier_negotiation',
  name: 'Oracle Fusion Procurement Get Supplier Negotiation',
  description:
    'Get Supplier Negotiation in Oracle Fusion Procurement. Return selected documented fields and preserve exact Oracle identifiers.',
  params: {
    negotiationKey: procurementParamFields.negotiationKey,
  },
  outputs: {
    supplierNegotiation: {
      type: 'object',
      description: 'Supplier Negotiation fields',
      properties: SUPPLIER_NEGOTIATION_OUTPUT_PROPERTIES,
    },
  },
})
