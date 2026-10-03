import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_NEGOTIATION_RESPONSE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementGetSupplierNegotiationResponseTool = createProcurementTool({
  id: 'oracle_fusion_procurement_get_supplier_negotiation_response',
  name: 'Oracle Fusion Procurement Get Supplier Negotiation Response',
  description:
    'Get a supplier-visible negotiation response by its opaque key. Requires View Supplier Negotiation Response as Supplier; does not grant buyer-wide bid visibility.',
  params: {
    responseKey: procurementParamFields.responseKey,
  },
  outputs: {
    supplierNegotiationResponse: {
      type: 'object',
      description: 'Supplier Negotiation Response fields',
      properties: SUPPLIER_NEGOTIATION_RESPONSE_OUTPUT_PROPERTIES,
    },
  },
})
