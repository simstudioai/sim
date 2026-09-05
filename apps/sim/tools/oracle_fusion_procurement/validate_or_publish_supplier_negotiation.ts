import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PROCUREMENT_NEGOTIATION_ACTION_OUTPUTS } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementValidateOrPublishSupplierNegotiationTool =
  createProcurementTool({
    id: 'oracle_fusion_procurement_validate_or_publish_supplier_negotiation',
    name: 'Oracle Fusion Procurement Validate Or Publish Supplier Negotiation',
    description:
      'Explicitly validate OR publish a supplier negotiation using ActionIntent. Oracle business errors remain failures even when the HTTP request succeeds.',
    params: {
      negotiationKey: procurementParamFields.negotiationKey,
      actionIntent: procurementParamFields.actionIntent,
      buyerId: { ...procurementParamFields.buyerId, required: false },
      ignoreWarnings: { ...procurementParamFields.ignoreWarnings, required: false },
    },
    outputs: PROCUREMENT_NEGOTIATION_ACTION_OUTPUTS,
  })
