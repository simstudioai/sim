import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { PURCHASE_REQUISITION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementCreatePurchaseRequisitionTool = createProcurementTool({
  id: 'oracle_fusion_procurement_create_purchase_requisition',
  name: 'Oracle Fusion Procurement Create Purchase Requisition',
  description:
    'Create Purchase Requisition in Oracle Fusion Procurement. Create a draft without submitting or publishing it.',
  params: {
    preparerId: procurementParamFields.preparerId,
    requisitioningBUId: procurementParamFields.requisitioningBUId,
    body: {
      type: 'json',
      required: false,
      description:
        'Additional fields as a JSON object: PreparerId, RequisitioningBUId, Description, Justification, EmergencyRequisitionFlag. Supports inline lines. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields. Each lines entry supports LineNumber (required), LineTypeId, ItemId, Item, ItemDescription, CategoryId, Quantity, UOMCode, UnitPrice, CurrencyCode, RequestedDeliveryDate, RequesterId, DeliverToLocationId, DestinationTypeCode, DestinationOrganizationId, SupplierId, SupplierSiteId, NoteToBuyer, NoteToSupplier, UrgentFlag. Each child collection is limited to 100 entries.',
    },
  },
  outputs: {
    purchaseRequisition: {
      type: 'object',
      description: 'Purchase Requisition fields',
      properties: PURCHASE_REQUISITION_OUTPUT_PROPERTIES,
    },
  },
})
