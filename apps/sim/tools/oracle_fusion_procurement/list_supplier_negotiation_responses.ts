import {
  createProcurementTool,
  procurementListParams,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import {
  PROCUREMENT_PAGINATION_OUTPUTS,
  SUPPLIER_NEGOTIATION_RESPONSE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementListSupplierNegotiationResponsesTool = createProcurementTool({
  id: 'oracle_fusion_procurement_list_supplier_negotiation_responses',
  name: 'Oracle Fusion Procurement List Supplier Negotiation Responses',
  description:
    'List one page of supplier-visible negotiation responses. Requires View Supplier Negotiation Response as Supplier; does not grant buyer-wide bid visibility. Use nextOffset explicitly for another page.',
  params: {
    ...procurementListParams,
    negotiationId: { ...procurementParamFields.negotiationId, required: false },
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of supplier Negotiation Responses',
      items: { type: 'object', properties: SUPPLIER_NEGOTIATION_RESPONSE_OUTPUT_PROPERTIES },
    },
    ...PROCUREMENT_PAGINATION_OUTPUTS,
  },
})
