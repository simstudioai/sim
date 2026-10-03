import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementCreateDraftPurchaseOrderTool = createProcurementTool({
  id: 'oracle_fusion_procurement_create_draft_purchase_order',
  name: 'Oracle Fusion Procurement Create Draft Purchase Order',
  description:
    'Create Draft Purchase Order in Oracle Fusion Procurement. Create a draft without submitting or publishing it.',
  params: {
    buyerId: procurementParamFields.buyerId,
    documentStyleId: procurementParamFields.documentStyleId,
    procurementBUId: procurementParamFields.procurementBUId,
    supplierId: procurementParamFields.supplierId,
    supplierSiteId: procurementParamFields.supplierSiteId,
    body: {
      type: 'json',
      required: false,
      description:
        'Additional fields as a JSON object: BuyerId, DocumentStyleId, ProcurementBUId, SupplierId, SupplierSiteId, RequisitioningBUId, CurrencyCode, Description, OrderNumber, NoteToSupplier, NoteToReceiver, DefaultShipToLocationId, BillToLocationId, BillToBUId. Supports inline lines. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields. Each lines entry supports LineNumber (required), LineTypeId, LineType, ItemId, Item, Description, CategoryId, Quantity, UOMCode, Price, Amount, SupplierItem, NoteToSupplier, schedules. Each schedules entry supports ScheduleNumber (required), ShipToLocationId, ShipToOrganizationId, ShipToOrganizationCode, Quantity, Price, Amount, RequestedDeliveryDate, PromisedDeliveryDate, RequestedShipDate, PromisedShipDate, DestinationTypeCode, ReceiptRequiredFlag, InspectionRequiredFlag, ReceiptRoutingId. Each child collection is limited to 100 entries.',
    },
  },
  outputs: {
    draftPurchaseOrder: {
      type: 'object',
      description: 'Draft Purchase Order fields',
      properties: DRAFT_PURCHASE_ORDER_OUTPUT_PROPERTIES,
    },
  },
})
