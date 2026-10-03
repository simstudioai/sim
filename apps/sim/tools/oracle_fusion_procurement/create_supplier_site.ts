import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_SITE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementCreateSupplierSiteTool = createProcurementTool({
  id: 'oracle_fusion_procurement_create_supplier_site',
  name: 'Oracle Fusion Procurement Create Supplier Site',
  description:
    'Create a procurement site for an existing supplier address, optionally assigning client business units. Does not configure supplier payments.',
  params: {
    supplierId: procurementParamFields.supplierId,
    procurementBUId: procurementParamFields.procurementBUId,
    supplierSiteName: procurementParamFields.supplierSiteName,
    supplierAddressId: procurementParamFields.supplierAddressId,
    body: {
      type: 'json',
      required: false,
      description:
        'Additional fields as a JSON object: ProcurementBUId, SupplierSite, SupplierAddressId, SupplierAddressName, SitePurposePurchasingFlag, SitePurposeSourcingOnlyFlag, Email, CommunicationMethodCode, HoldAllNewPurchasingDocumentsFlag, PurchasingHoldReason, InactiveDate. Supports inline assignments. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields. Each assignments entry supports ClientBUId, BillToBUId, ShipToLocationId, BillToLocationId, InactiveDate. Each child collection is limited to 100 entries.',
    },
  },
  outputs: {
    supplierSite: {
      type: 'object',
      description: 'Supplier Site fields',
      properties: SUPPLIER_SITE_OUTPUT_PROPERTIES,
    },
  },
})
