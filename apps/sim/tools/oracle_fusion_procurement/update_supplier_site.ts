import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_SITE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementUpdateSupplierSiteTool = createProcurementTool({
  id: 'oracle_fusion_procurement_update_supplier_site',
  name: 'Oracle Fusion Procurement Update Supplier Site',
  description:
    'Update Supplier Site in Oracle Fusion Procurement. Update only the supplied documented header fields. Unspecified fields are left unchanged.',
  params: {
    supplierId: procurementParamFields.supplierId,
    supplierSiteId: procurementParamFields.supplierSiteId,
    body: {
      type: 'json',
      required: true,
      description:
        'Header fields as a JSON object: SupplierSite, SitePurposePurchasingFlag, SitePurposeSourcingOnlyFlag, Email, CommunicationMethodCode, HoldAllNewPurchasingDocumentsFlag, PurchasingHoldReason, InactiveDate. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields.',
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
