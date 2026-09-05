import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_NEGOTIATION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementUpdateSupplierNegotiationTool = createProcurementTool({
  id: 'oracle_fusion_procurement_update_supplier_negotiation',
  name: 'Oracle Fusion Procurement Update Supplier Negotiation',
  description:
    'Update Supplier Negotiation in Oracle Fusion Procurement. Update only the supplied documented header fields. Unspecified fields are left unchanged.',
  params: {
    negotiationKey: procurementParamFields.negotiationKey,
    body: {
      type: 'json',
      required: true,
      description:
        'Header fields as a JSON object: NegotiationTitle, CurrencyCode, OpenDate, CloseDate, PreviewDate, OpenImmediatelyFlag, PreviewImmediatelyFlag, RestrictToInvitedSuppliersFlag, RequisitioningBUId, Synopsis. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields.',
    },
  },
  outputs: {
    supplierNegotiation: {
      type: 'object',
      description: 'Supplier Negotiation fields',
      properties: SUPPLIER_NEGOTIATION_OUTPUT_PROPERTIES,
    },
  },
})
