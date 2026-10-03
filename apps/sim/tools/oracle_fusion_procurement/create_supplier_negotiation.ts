import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_NEGOTIATION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementCreateSupplierNegotiationTool = createProcurementTool({
  id: 'oracle_fusion_procurement_create_supplier_negotiation',
  name: 'Oracle Fusion Procurement Create Supplier Negotiation',
  description:
    'Create Supplier Negotiation in Oracle Fusion Procurement. Create a draft without submitting or publishing it.',
  params: {
    procurementBUId: procurementParamFields.procurementBUId,
    negotiationTitle: procurementParamFields.negotiationTitle,
    buyerId: { ...procurementParamFields.buyerId, required: false },
    body: {
      type: 'json',
      required: false,
      description:
        'Additional fields as a JSON object: ProcurementBUId, BuyerId, NegotiationTitle, NegotiationType, NegotiationTypeId, NegotiationStyleId, CurrencyCode, Outcome, OpenDate, CloseDate, PreviewDate, OpenImmediatelyFlag, PreviewImmediatelyFlag, RestrictToInvitedSuppliersFlag, RequisitioningBUId, Synopsis. Supports inline lines and suppliers. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields. Each lines entry supports Line, LineTypeId, ItemId, Item, LineDescription, CategoryId, Quantity, UOMCode, StartPrice, TargetPrice, RequestedDeliveryDate, ShipToLocationId, RequisitioningBUId, NoteToSuppliers. Each suppliers entry requires SupplierId and supports SupplierSiteId, SupplierContactId, AdditionalContactEmail, NotifyAllSupplierContactsFlag. Each child collection is limited to 100 entries.',
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
