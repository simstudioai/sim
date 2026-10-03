import {
  createProcurementTool,
  procurementParamFields,
} from '@/tools/oracle_fusion_procurement/shared'
import { SUPPLIER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_procurement/types'

export const oracleFusionProcurementCreateSupplierTool = createProcurementTool({
  id: 'oracle_fusion_procurement_create_supplier',
  name: 'Oracle Fusion Procurement Create Supplier',
  description:
    'Create a supplier procurement profile. Oracle may generate the supplier number and party ID; optional addresses can be created inline. Does not configure banking or tax registrations.',
  params: {
    supplierName: procurementParamFields.supplierName,
    body: {
      type: 'json',
      required: false,
      description:
        'Additional fields as a JSON object: Supplier, SupplierNumber, SupplierPartyId, AlternateName, Alias, CorporateWebsite, BusinessRelationshipCode, SupplierTypeCode, TaxOrganizationTypeCode, OneTimeSupplierFlag, ParentSupplierId, InactiveDate. Supports inline addresses. Use decimal strings for integer IDs; unsupported fields are rejected. Explicit inputs override matching body fields. Each addresses entry supports CountryCode (required), Email, AddressName, AddressLine1, AddressLine2, City, State, Province, PostalCode, AddressPurposeOrderingFlag, AddressPurposeRFQOrBiddingFlag. Each child collection is limited to 100 entries.',
    },
  },
  outputs: {
    supplier: {
      type: 'object',
      description: 'Supplier fields',
      properties: SUPPLIER_OUTPUT_PROPERTIES,
    },
  },
})
