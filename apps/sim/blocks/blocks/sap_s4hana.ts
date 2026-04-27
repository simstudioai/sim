import { SapS4HanaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SapProxyResponse } from '@/tools/sap_s4hana/types'

export const SapS4HanaBlock: BlockConfig<SapProxyResponse> = {
  type: 'sap_s4hana',
  name: 'SAP S/4HANA',
  description: 'Read and write SAP S/4HANA Cloud business data via OData',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Connect SAP S/4HANA Cloud Public Edition with per-tenant OAuth 2.0 client credentials configured in your Communication Arrangements. Read and create business partners, customers, suppliers, sales orders, deliveries (inbound/outbound), billing documents, products, stock and material documents, purchase requisitions, purchase orders, and supplier invoices, or run arbitrary OData v2 queries against any whitelisted Communication Scenario.',
  docsLink: 'https://docs.sim.ai/tools/sap_s4hana',
  category: 'tools',
  integrationType: IntegrationType.Other,
  tags: ['automation'],
  bgColor: '#0A6ED1',
  icon: SapS4HanaIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Business Partners', id: 'sap_s4hana_list_business_partners' },
        { label: 'Get Business Partner', id: 'sap_s4hana_get_business_partner' },
        { label: 'Create Business Partner', id: 'sap_s4hana_create_business_partner' },
        { label: 'Update Business Partner', id: 'sap_s4hana_update_business_partner' },
        { label: 'List Customers', id: 'sap_s4hana_list_customers' },
        { label: 'Get Customer', id: 'sap_s4hana_get_customer' },
        { label: 'Update Customer', id: 'sap_s4hana_update_customer' },
        { label: 'List Suppliers', id: 'sap_s4hana_list_suppliers' },
        { label: 'Get Supplier', id: 'sap_s4hana_get_supplier' },
        { label: 'Update Supplier', id: 'sap_s4hana_update_supplier' },
        { label: 'List Sales Orders', id: 'sap_s4hana_list_sales_orders' },
        { label: 'Get Sales Order', id: 'sap_s4hana_get_sales_order' },
        { label: 'Create Sales Order', id: 'sap_s4hana_create_sales_order' },
        { label: 'Update Sales Order', id: 'sap_s4hana_update_sales_order' },
        { label: 'Delete Sales Order', id: 'sap_s4hana_delete_sales_order' },
        { label: 'List Outbound Deliveries', id: 'sap_s4hana_list_outbound_deliveries' },
        { label: 'Get Outbound Delivery', id: 'sap_s4hana_get_outbound_delivery' },
        { label: 'List Inbound Deliveries', id: 'sap_s4hana_list_inbound_deliveries' },
        { label: 'Get Inbound Delivery', id: 'sap_s4hana_get_inbound_delivery' },
        { label: 'List Billing Documents', id: 'sap_s4hana_list_billing_documents' },
        { label: 'Get Billing Document', id: 'sap_s4hana_get_billing_document' },
        { label: 'List Products', id: 'sap_s4hana_list_products' },
        { label: 'Get Product', id: 'sap_s4hana_get_product' },
        { label: 'Update Product', id: 'sap_s4hana_update_product' },
        { label: 'List Material Stock', id: 'sap_s4hana_list_material_stock' },
        { label: 'List Material Documents', id: 'sap_s4hana_list_material_documents' },
        { label: 'List Purchase Requisitions', id: 'sap_s4hana_list_purchase_requisitions' },
        { label: 'Get Purchase Requisition', id: 'sap_s4hana_get_purchase_requisition' },
        { label: 'Create Purchase Requisition', id: 'sap_s4hana_create_purchase_requisition' },
        { label: 'Update Purchase Requisition', id: 'sap_s4hana_update_purchase_requisition' },
        { label: 'List Purchase Orders', id: 'sap_s4hana_list_purchase_orders' },
        { label: 'Get Purchase Order', id: 'sap_s4hana_get_purchase_order' },
        { label: 'Create Purchase Order', id: 'sap_s4hana_create_purchase_order' },
        { label: 'Update Purchase Order', id: 'sap_s4hana_update_purchase_order' },
        { label: 'List Supplier Invoices', id: 'sap_s4hana_list_supplier_invoices' },
        { label: 'Get Supplier Invoice', id: 'sap_s4hana_get_supplier_invoice' },
        { label: 'OData Query (advanced)', id: 'sap_s4hana_odata_query' },
      ],
      value: () => 'sap_s4hana_list_business_partners',
      required: true,
    },

    // List filters (shared across list operations)
    {
      id: 'filter',
      title: '$filter',
      type: 'long-input',
      placeholder: "BusinessPartnerCategory eq '1'",
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_list_business_partners',
          'sap_s4hana_list_customers',
          'sap_s4hana_list_suppliers',
          'sap_s4hana_list_sales_orders',
          'sap_s4hana_list_outbound_deliveries',
          'sap_s4hana_list_inbound_deliveries',
          'sap_s4hana_list_billing_documents',
          'sap_s4hana_list_products',
          'sap_s4hana_list_material_stock',
          'sap_s4hana_list_material_documents',
          'sap_s4hana_list_purchase_requisitions',
          'sap_s4hana_list_purchase_orders',
          'sap_s4hana_list_supplier_invoices',
        ],
      },
    },
    {
      id: 'top',
      title: '$top',
      type: 'short-input',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_list_business_partners',
          'sap_s4hana_list_customers',
          'sap_s4hana_list_suppliers',
          'sap_s4hana_list_sales_orders',
          'sap_s4hana_list_outbound_deliveries',
          'sap_s4hana_list_inbound_deliveries',
          'sap_s4hana_list_billing_documents',
          'sap_s4hana_list_products',
          'sap_s4hana_list_material_stock',
          'sap_s4hana_list_material_documents',
          'sap_s4hana_list_purchase_requisitions',
          'sap_s4hana_list_purchase_orders',
          'sap_s4hana_list_supplier_invoices',
        ],
      },
    },
    {
      id: 'skip',
      title: '$skip',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_list_business_partners',
          'sap_s4hana_list_customers',
          'sap_s4hana_list_suppliers',
          'sap_s4hana_list_sales_orders',
          'sap_s4hana_list_outbound_deliveries',
          'sap_s4hana_list_inbound_deliveries',
          'sap_s4hana_list_billing_documents',
          'sap_s4hana_list_products',
          'sap_s4hana_list_material_stock',
          'sap_s4hana_list_material_documents',
          'sap_s4hana_list_purchase_requisitions',
          'sap_s4hana_list_purchase_orders',
          'sap_s4hana_list_supplier_invoices',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'orderBy',
      title: '$orderby',
      type: 'short-input',
      placeholder: 'CreationDate desc',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_list_business_partners',
          'sap_s4hana_list_customers',
          'sap_s4hana_list_suppliers',
          'sap_s4hana_list_sales_orders',
          'sap_s4hana_list_outbound_deliveries',
          'sap_s4hana_list_inbound_deliveries',
          'sap_s4hana_list_billing_documents',
          'sap_s4hana_list_products',
          'sap_s4hana_list_material_stock',
          'sap_s4hana_list_material_documents',
          'sap_s4hana_list_purchase_requisitions',
          'sap_s4hana_list_purchase_orders',
          'sap_s4hana_list_supplier_invoices',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'select',
      title: '$select',
      type: 'short-input',
      placeholder: 'BusinessPartner,FirstName,LastName',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_list_business_partners',
          'sap_s4hana_get_business_partner',
          'sap_s4hana_list_customers',
          'sap_s4hana_get_customer',
          'sap_s4hana_list_suppliers',
          'sap_s4hana_get_supplier',
          'sap_s4hana_list_sales_orders',
          'sap_s4hana_get_sales_order',
          'sap_s4hana_list_outbound_deliveries',
          'sap_s4hana_get_outbound_delivery',
          'sap_s4hana_list_inbound_deliveries',
          'sap_s4hana_get_inbound_delivery',
          'sap_s4hana_list_billing_documents',
          'sap_s4hana_get_billing_document',
          'sap_s4hana_list_products',
          'sap_s4hana_get_product',
          'sap_s4hana_list_material_stock',
          'sap_s4hana_list_material_documents',
          'sap_s4hana_list_purchase_requisitions',
          'sap_s4hana_get_purchase_requisition',
          'sap_s4hana_list_purchase_orders',
          'sap_s4hana_get_purchase_order',
          'sap_s4hana_list_supplier_invoices',
          'sap_s4hana_get_supplier_invoice',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'expand',
      title: '$expand',
      type: 'short-input',
      placeholder: 'to_Item',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_list_business_partners',
          'sap_s4hana_get_business_partner',
          'sap_s4hana_list_customers',
          'sap_s4hana_get_customer',
          'sap_s4hana_list_suppliers',
          'sap_s4hana_get_supplier',
          'sap_s4hana_list_sales_orders',
          'sap_s4hana_get_sales_order',
          'sap_s4hana_list_outbound_deliveries',
          'sap_s4hana_get_outbound_delivery',
          'sap_s4hana_list_inbound_deliveries',
          'sap_s4hana_get_inbound_delivery',
          'sap_s4hana_list_billing_documents',
          'sap_s4hana_get_billing_document',
          'sap_s4hana_list_products',
          'sap_s4hana_get_product',
          'sap_s4hana_list_material_stock',
          'sap_s4hana_list_material_documents',
          'sap_s4hana_list_purchase_requisitions',
          'sap_s4hana_get_purchase_requisition',
          'sap_s4hana_list_purchase_orders',
          'sap_s4hana_get_purchase_order',
          'sap_s4hana_list_supplier_invoices',
          'sap_s4hana_get_supplier_invoice',
        ],
      },
      mode: 'advanced',
    },

    // Business Partner: get/create
    {
      id: 'businessPartner',
      title: 'BusinessPartner',
      type: 'short-input',
      placeholder: '1000123',
      condition: {
        field: 'operation',
        value: ['sap_s4hana_get_business_partner', 'sap_s4hana_update_business_partner'],
      },
      required: true,
    },
    {
      id: 'businessPartnerCategory',
      title: 'BusinessPartnerCategory',
      type: 'dropdown',
      options: [
        { label: '1 — Person', id: '1' },
        { label: '2 — Organization', id: '2' },
        { label: '3 — Group', id: '3' },
      ],
      value: () => '2',
      condition: { field: 'operation', value: 'sap_s4hana_create_business_partner' },
      required: true,
    },
    {
      id: 'businessPartnerGrouping',
      title: 'BusinessPartnerGrouping',
      type: 'short-input',
      placeholder: 'Tenant-configured grouping (see customizing)',
      condition: { field: 'operation', value: 'sap_s4hana_create_business_partner' },
      required: true,
    },
    {
      id: 'firstName',
      title: 'FirstName',
      type: 'short-input',
      placeholder: 'Required for Person',
      condition: {
        field: 'operation',
        value: 'sap_s4hana_create_business_partner',
        and: { field: 'businessPartnerCategory', value: '1' },
      },
      required: {
        field: 'operation',
        value: 'sap_s4hana_create_business_partner',
        and: { field: 'businessPartnerCategory', value: '1' },
      },
    },
    {
      id: 'lastName',
      title: 'LastName',
      type: 'short-input',
      placeholder: 'Required for Person',
      condition: {
        field: 'operation',
        value: 'sap_s4hana_create_business_partner',
        and: { field: 'businessPartnerCategory', value: '1' },
      },
      required: {
        field: 'operation',
        value: 'sap_s4hana_create_business_partner',
        and: { field: 'businessPartnerCategory', value: '1' },
      },
    },
    {
      id: 'organizationBPName1',
      title: 'OrganizationBPName1',
      type: 'short-input',
      placeholder: 'Required for Organization',
      condition: {
        field: 'operation',
        value: 'sap_s4hana_create_business_partner',
        and: { field: 'businessPartnerCategory', value: '2' },
      },
      required: {
        field: 'operation',
        value: 'sap_s4hana_create_business_partner',
        and: { field: 'businessPartnerCategory', value: '2' },
      },
    },
    {
      id: 'businessPartnerBody',
      title: 'Additional Fields (JSON)',
      type: 'code',
      placeholder: '{"CorrespondenceLanguage":"EN"}',
      condition: { field: 'operation', value: 'sap_s4hana_create_business_partner' },
      mode: 'advanced',
    },

    // Customer: get
    {
      id: 'customer',
      title: 'Customer',
      type: 'short-input',
      placeholder: '17100001',
      condition: {
        field: 'operation',
        value: ['sap_s4hana_get_customer', 'sap_s4hana_update_customer'],
      },
      required: true,
    },

    // Sales Order: get/create
    {
      id: 'salesOrder',
      title: 'SalesOrder',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_get_sales_order',
          'sap_s4hana_update_sales_order',
          'sap_s4hana_delete_sales_order',
        ],
      },
      required: true,
    },
    {
      id: 'salesOrderType',
      title: 'SalesOrderType',
      type: 'short-input',
      placeholder: 'OR',
      condition: { field: 'operation', value: 'sap_s4hana_create_sales_order' },
      required: true,
    },
    {
      id: 'salesOrganization',
      title: 'SalesOrganization',
      type: 'short-input',
      placeholder: '1010',
      condition: { field: 'operation', value: 'sap_s4hana_create_sales_order' },
      required: true,
    },
    {
      id: 'distributionChannel',
      title: 'DistributionChannel',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'sap_s4hana_create_sales_order' },
      required: true,
    },
    {
      id: 'organizationDivision',
      title: 'OrganizationDivision',
      type: 'short-input',
      placeholder: '00',
      condition: { field: 'operation', value: 'sap_s4hana_create_sales_order' },
      required: true,
    },
    {
      id: 'soldToParty',
      title: 'SoldToParty',
      type: 'short-input',
      placeholder: '17100001',
      condition: { field: 'operation', value: 'sap_s4hana_create_sales_order' },
      required: true,
    },
    {
      id: 'salesOrderItems',
      title: 'Items (to_Item, JSON array)',
      type: 'code',
      placeholder: '[{"Material":"TG11","RequestedQuantity":"1"}]',
      condition: { field: 'operation', value: 'sap_s4hana_create_sales_order' },
      required: true,
    },
    {
      id: 'salesOrderBody',
      title: 'Additional Fields (JSON)',
      type: 'code',
      placeholder: '{"PurchaseOrderByCustomer":"PO-12345"}',
      condition: { field: 'operation', value: 'sap_s4hana_create_sales_order' },
      mode: 'advanced',
    },

    // Delivery Document: shared by outbound and inbound
    {
      id: 'deliveryDocument',
      title: 'DeliveryDocument',
      type: 'short-input',
      placeholder: '80000000',
      condition: {
        field: 'operation',
        value: ['sap_s4hana_get_outbound_delivery', 'sap_s4hana_get_inbound_delivery'],
      },
      required: true,
    },

    // Billing Document: get
    {
      id: 'billingDocument',
      title: 'BillingDocument',
      type: 'short-input',
      placeholder: '90000000',
      condition: { field: 'operation', value: 'sap_s4hana_get_billing_document' },
      required: true,
    },

    // Product: get
    {
      id: 'product',
      title: 'Product',
      type: 'short-input',
      placeholder: 'TG11',
      condition: {
        field: 'operation',
        value: ['sap_s4hana_get_product', 'sap_s4hana_update_product'],
      },
      required: true,
    },

    // Purchase Requisition: get/update
    {
      id: 'purchaseRequisition',
      title: 'PurchaseRequisition',
      type: 'short-input',
      placeholder: '10000000',
      condition: {
        field: 'operation',
        value: ['sap_s4hana_get_purchase_requisition', 'sap_s4hana_update_purchase_requisition'],
      },
      required: true,
    },
    // Purchase Requisition: create
    {
      id: 'purchaseRequisitionType',
      title: 'PurchaseRequisitionType',
      type: 'short-input',
      placeholder: 'NB',
      condition: { field: 'operation', value: 'sap_s4hana_create_purchase_requisition' },
      required: true,
    },
    {
      id: 'purchaseRequisitionItems',
      title: 'Items (to_PurchaseReqnItem, JSON array)',
      type: 'code',
      placeholder:
        '[{"PurchaseRequisitionItem":"10","Material":"TG11","RequestedQuantity":"5","Plant":"1010","BaseUnit":"PC"}]',
      condition: { field: 'operation', value: 'sap_s4hana_create_purchase_requisition' },
      required: true,
    },
    {
      id: 'purchaseRequisitionBody',
      title: 'Additional Fields (JSON)',
      type: 'code',
      placeholder: '{"PurchaseRequisitionDescription":"Office supplies"}',
      condition: { field: 'operation', value: 'sap_s4hana_create_purchase_requisition' },
      mode: 'advanced',
    },

    // Purchase Order: get/create
    {
      id: 'purchaseOrder',
      title: 'PurchaseOrder',
      type: 'short-input',
      placeholder: '4500000001',
      condition: {
        field: 'operation',
        value: ['sap_s4hana_get_purchase_order', 'sap_s4hana_update_purchase_order'],
      },
      required: true,
    },
    {
      id: 'purchaseOrderType',
      title: 'PurchaseOrderType',
      type: 'short-input',
      placeholder: 'NB',
      condition: { field: 'operation', value: 'sap_s4hana_create_purchase_order' },
      required: true,
    },
    {
      id: 'companyCode',
      title: 'CompanyCode',
      type: 'short-input',
      placeholder: '1010',
      condition: { field: 'operation', value: 'sap_s4hana_create_purchase_order' },
      required: true,
    },
    {
      id: 'purchasingOrganization',
      title: 'PurchasingOrganization',
      type: 'short-input',
      placeholder: '1010',
      condition: { field: 'operation', value: 'sap_s4hana_create_purchase_order' },
      required: true,
    },
    {
      id: 'purchasingGroup',
      title: 'PurchasingGroup',
      type: 'short-input',
      placeholder: '001',
      condition: { field: 'operation', value: 'sap_s4hana_create_purchase_order' },
      required: true,
    },
    {
      id: 'supplier',
      title: 'Supplier',
      type: 'short-input',
      placeholder: '17300001',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_create_purchase_order',
          'sap_s4hana_get_supplier',
          'sap_s4hana_update_supplier',
        ],
      },
      required: true,
    },
    {
      id: 'purchaseOrderBody',
      title: 'Items & Additional Fields (JSON)',
      type: 'code',
      placeholder:
        '{"to_PurchaseOrderItem":[{"PurchaseOrderItem":"10","Material":"TG11","OrderQuantity":"5","Plant":"1010","PurchaseOrderQuantityUnit":"PC","NetPriceAmount":"100.00","DocumentCurrency":"USD"}]}',
      condition: { field: 'operation', value: 'sap_s4hana_create_purchase_order' },
      required: true,
    },

    // Supplier Invoice: get
    {
      id: 'supplierInvoice',
      title: 'SupplierInvoice',
      type: 'short-input',
      placeholder: '5105600000',
      condition: { field: 'operation', value: 'sap_s4hana_get_supplier_invoice' },
      required: true,
    },
    {
      id: 'fiscalYear',
      title: 'FiscalYear',
      type: 'short-input',
      placeholder: '2024',
      condition: { field: 'operation', value: 'sap_s4hana_get_supplier_invoice' },
      required: true,
    },

    // Shared body for all PATCH update operations
    {
      id: 'updateBody',
      title: 'Fields to Update (JSON)',
      type: 'code',
      placeholder: '{"FirstName":"Jane","SearchTerm1":"VIP"}',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_update_business_partner',
          'sap_s4hana_update_customer',
          'sap_s4hana_update_supplier',
          'sap_s4hana_update_product',
          'sap_s4hana_update_sales_order',
          'sap_s4hana_update_purchase_order',
          'sap_s4hana_update_purchase_requisition',
        ],
      },
      required: true,
    },
    // Shared If-Match for all update + delete operations
    {
      id: 'updateIfMatch',
      title: 'If-Match (ETag)',
      type: 'short-input',
      placeholder: '* (default — bypass concurrency check)',
      condition: {
        field: 'operation',
        value: [
          'sap_s4hana_update_business_partner',
          'sap_s4hana_update_customer',
          'sap_s4hana_update_supplier',
          'sap_s4hana_update_product',
          'sap_s4hana_update_sales_order',
          'sap_s4hana_delete_sales_order',
          'sap_s4hana_update_purchase_order',
          'sap_s4hana_update_purchase_requisition',
        ],
      },
      mode: 'advanced',
    },

    // OData Query passthrough
    {
      id: 'odataService',
      title: 'OData Service',
      type: 'short-input',
      placeholder: 'API_BUSINESS_PARTNER',
      condition: { field: 'operation', value: 'sap_s4hana_odata_query' },
      required: true,
    },
    {
      id: 'odataPath',
      title: 'Entity Path',
      type: 'short-input',
      placeholder: "/A_BusinessPartner('1000123')",
      condition: { field: 'operation', value: 'sap_s4hana_odata_query' },
      required: true,
    },
    {
      id: 'odataMethod',
      title: 'HTTP Method',
      type: 'dropdown',
      options: [
        { label: 'GET', id: 'GET' },
        { label: 'POST', id: 'POST' },
        { label: 'PATCH', id: 'PATCH' },
        { label: 'PUT', id: 'PUT' },
        { label: 'DELETE', id: 'DELETE' },
        { label: 'MERGE', id: 'MERGE' },
      ],
      value: () => 'GET',
      condition: { field: 'operation', value: 'sap_s4hana_odata_query' },
    },
    {
      id: 'odataQuery',
      title: 'Query Parameters (JSON or query string)',
      type: 'code',
      placeholder: '{"$filter":"BusinessPartnerCategory eq \'1\'","$top":10}',
      condition: { field: 'operation', value: 'sap_s4hana_odata_query' },
      mode: 'advanced',
    },
    {
      id: 'odataBody',
      title: 'Request Body (JSON)',
      type: 'code',
      placeholder: '{"FirstName":"Jane"}',
      condition: { field: 'operation', value: 'sap_s4hana_odata_query' },
      mode: 'advanced',
    },
    {
      id: 'odataIfMatch',
      title: 'If-Match (ETag)',
      type: 'short-input',
      placeholder: 'W/"datetimeoffset\'2024-01-01T00:00:00Z\'"',
      condition: { field: 'operation', value: 'sap_s4hana_odata_query' },
      mode: 'advanced',
    },

    // Connection (always shown)
    {
      id: 'deploymentType',
      title: 'Deployment',
      type: 'dropdown',
      options: [
        { label: 'S/4HANA Cloud Public Edition', id: 'cloud_public' },
        { label: 'S/4HANA Cloud Private Edition (RISE)', id: 'cloud_private' },
        { label: 'S/4HANA On-Premise', id: 'on_premise' },
      ],
      value: () => 'cloud_public',
      required: true,
    },
    {
      id: 'authType',
      title: 'Authentication',
      type: 'dropdown',
      options: [
        { label: 'OAuth 2.0 Client Credentials', id: 'oauth_client_credentials' },
        { label: 'Basic (Communication User)', id: 'basic' },
      ],
      value: () => 'oauth_client_credentials',
      condition: { field: 'deploymentType', value: ['cloud_private', 'on_premise'] },
      required: { field: 'deploymentType', value: ['cloud_private', 'on_premise'] },
      dependsOn: ['deploymentType'],
    },

    // Cloud Public: subdomain + region (SAP BTP UAA pattern)
    {
      id: 'subdomain',
      title: 'BTP Subdomain',
      type: 'short-input',
      placeholder: 'my-tenant',
      condition: { field: 'deploymentType', value: 'cloud_public' },
      required: { field: 'deploymentType', value: 'cloud_public' },
    },
    {
      id: 'region',
      title: 'BTP Region',
      type: 'dropdown',
      options: [
        { label: 'eu10 — Europe / Frankfurt (AWS)', id: 'eu10' },
        { label: 'eu11 — Europe / Frankfurt (AWS, EU Access)', id: 'eu11' },
        { label: 'eu20 — Europe / Netherlands (Azure)', id: 'eu20' },
        { label: 'eu22 — Europe / Zurich (Azure)', id: 'eu22' },
        { label: 'eu30 — Europe / Frankfurt (GCP)', id: 'eu30' },
        { label: 'uk20 — UK South (Azure)', id: 'uk20' },
        { label: 'ch20 — Switzerland North (Azure)', id: 'ch20' },
        { label: 'us10 — US East / Virginia (AWS)', id: 'us10' },
        { label: 'us11 — US West / Oregon (AWS)', id: 'us11' },
        { label: 'us20 — US East 2 / Virginia (Azure)', id: 'us20' },
        { label: 'us21 — US Central / Iowa (Azure)', id: 'us21' },
        { label: 'us30 — US Central / Iowa (GCP)', id: 'us30' },
        { label: 'ca10 — Canada / Montreal (AWS)', id: 'ca10' },
        { label: 'ca20 — Canada Central / Toronto (Azure)', id: 'ca20' },
        { label: 'br10 — Brazil / São Paulo (AWS)', id: 'br10' },
        { label: 'br20 — Brazil South (Azure)', id: 'br20' },
        { label: 'br30 — Brazil / São Paulo (GCP)', id: 'br30' },
        { label: 'jp10 — Japan / Tokyo (AWS)', id: 'jp10' },
        { label: 'jp20 — Japan East / Tokyo (Azure)', id: 'jp20' },
        { label: 'jp30 — Japan / Tokyo (GCP)', id: 'jp30' },
        { label: 'jp31 — Japan / Osaka (GCP)', id: 'jp31' },
        { label: 'ap10 — Australia / Sydney (AWS)', id: 'ap10' },
        { label: 'ap11 — Singapore (AWS)', id: 'ap11' },
        { label: 'ap12 — South Korea / Seoul (AWS)', id: 'ap12' },
        { label: 'ap20 — Australia East / Sydney (Azure)', id: 'ap20' },
        { label: 'ap21 — East Asia / Hong Kong (Azure)', id: 'ap21' },
        { label: 'ap30 — Asia Pacific / Sydney (GCP)', id: 'ap30' },
        { label: 'in30 — India (GCP)', id: 'in30' },
        { label: 'il30 — Israel (GCP)', id: 'il30' },
        { label: 'sa30 — Saudi Arabia / Dammam (GCP)', id: 'sa30' },
        { label: 'sa31 — Saudi Arabia / Riyadh (GCP)', id: 'sa31' },
      ],
      value: () => 'eu10',
      condition: { field: 'deploymentType', value: 'cloud_public' },
      required: { field: 'deploymentType', value: 'cloud_public' },
    },

    // Private / On-Prem: explicit host (and token URL for OAuth)
    {
      id: 'baseUrl',
      title: 'Base URL',
      type: 'short-input',
      placeholder: 'https://s4h.example.com:44300',
      condition: { field: 'deploymentType', value: ['cloud_private', 'on_premise'] },
      required: { field: 'deploymentType', value: ['cloud_private', 'on_premise'] },
    },
    {
      id: 'tokenUrl',
      title: 'OAuth Token URL',
      type: 'short-input',
      placeholder: 'https://auth.example.com/oauth/token',
      condition: {
        field: 'deploymentType',
        value: ['cloud_private', 'on_premise'],
        and: { field: 'authType', value: 'oauth_client_credentials' },
      },
      required: {
        field: 'deploymentType',
        value: ['cloud_private', 'on_premise'],
        and: { field: 'authType', value: 'oauth_client_credentials' },
      },
    },

    // OAuth credentials (shown whenever authType is oauth_client_credentials — cloud_public defaults to this)
    {
      id: 'clientId',
      title: 'OAuth Client ID',
      type: 'short-input',
      placeholder: 'sb-...!b1234',
      password: true,
      condition: { field: 'authType', value: 'basic', not: true },
      required: { field: 'authType', value: 'basic', not: true },
    },
    {
      id: 'clientSecret',
      title: 'OAuth Client Secret',
      type: 'short-input',
      placeholder: 'Client secret from Communication Arrangement',
      password: true,
      condition: { field: 'authType', value: 'basic', not: true },
      required: { field: 'authType', value: 'basic', not: true },
    },

    // Basic credentials (only surfaced on Private/On-Prem + Basic auth)
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Communication user (e.g., CC_ORDERS_USER)',
      condition: { field: 'authType', value: 'basic' },
      required: { field: 'authType', value: 'basic' },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Password for the communication user',
      password: true,
      condition: { field: 'authType', value: 'basic' },
      required: { field: 'authType', value: 'basic' },
    },
  ],
  tools: {
    access: [
      'sap_s4hana_list_business_partners',
      'sap_s4hana_get_business_partner',
      'sap_s4hana_create_business_partner',
      'sap_s4hana_update_business_partner',
      'sap_s4hana_list_customers',
      'sap_s4hana_get_customer',
      'sap_s4hana_update_customer',
      'sap_s4hana_list_suppliers',
      'sap_s4hana_get_supplier',
      'sap_s4hana_update_supplier',
      'sap_s4hana_list_sales_orders',
      'sap_s4hana_get_sales_order',
      'sap_s4hana_create_sales_order',
      'sap_s4hana_update_sales_order',
      'sap_s4hana_delete_sales_order',
      'sap_s4hana_list_outbound_deliveries',
      'sap_s4hana_get_outbound_delivery',
      'sap_s4hana_list_inbound_deliveries',
      'sap_s4hana_get_inbound_delivery',
      'sap_s4hana_list_billing_documents',
      'sap_s4hana_get_billing_document',
      'sap_s4hana_list_products',
      'sap_s4hana_get_product',
      'sap_s4hana_update_product',
      'sap_s4hana_list_material_stock',
      'sap_s4hana_list_material_documents',
      'sap_s4hana_list_purchase_requisitions',
      'sap_s4hana_get_purchase_requisition',
      'sap_s4hana_create_purchase_requisition',
      'sap_s4hana_update_purchase_requisition',
      'sap_s4hana_list_purchase_orders',
      'sap_s4hana_get_purchase_order',
      'sap_s4hana_create_purchase_order',
      'sap_s4hana_update_purchase_order',
      'sap_s4hana_list_supplier_invoices',
      'sap_s4hana_get_supplier_invoice',
      'sap_s4hana_odata_query',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const auth = {
          deploymentType: params.deploymentType || 'cloud_public',
          authType: params.authType || 'oauth_client_credentials',
          subdomain: params.subdomain || undefined,
          region: params.region || undefined,
          baseUrl: params.baseUrl || undefined,
          tokenUrl: params.tokenUrl || undefined,
          clientId: params.clientId || undefined,
          clientSecret: params.clientSecret || undefined,
          username: params.username || undefined,
          password: params.password || undefined,
        }
        const listFields = {
          filter: params.filter || undefined,
          top: params.top ? Number(params.top) : undefined,
          skip: params.skip ? Number(params.skip) : undefined,
          orderBy: params.orderBy || undefined,
          select: params.select || undefined,
          expand: params.expand || undefined,
        }
        const entityFields = {
          select: params.select || undefined,
          expand: params.expand || undefined,
        }

        switch (params.operation) {
          case 'sap_s4hana_list_business_partners':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_business_partner':
            return { ...auth, ...entityFields, businessPartner: params.businessPartner }
          case 'sap_s4hana_create_business_partner':
            return {
              ...auth,
              businessPartnerCategory: params.businessPartnerCategory,
              businessPartnerGrouping: params.businessPartnerGrouping,
              firstName: params.firstName || undefined,
              lastName: params.lastName || undefined,
              organizationBPName1: params.organizationBPName1 || undefined,
              body: params.businessPartnerBody || undefined,
            }
          case 'sap_s4hana_update_business_partner':
            return {
              ...auth,
              businessPartner: params.businessPartner,
              body: params.updateBody,
              ifMatch: params.updateIfMatch || undefined,
            }
          case 'sap_s4hana_list_customers':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_customer':
            return { ...auth, ...entityFields, customer: params.customer }
          case 'sap_s4hana_update_customer':
            return {
              ...auth,
              customer: params.customer,
              body: params.updateBody,
              ifMatch: params.updateIfMatch || undefined,
            }
          case 'sap_s4hana_list_suppliers':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_supplier':
            return { ...auth, ...entityFields, supplier: params.supplier }
          case 'sap_s4hana_update_supplier':
            return {
              ...auth,
              supplier: params.supplier,
              body: params.updateBody,
              ifMatch: params.updateIfMatch || undefined,
            }
          case 'sap_s4hana_list_sales_orders':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_sales_order':
            return { ...auth, ...entityFields, salesOrder: params.salesOrder }
          case 'sap_s4hana_create_sales_order':
            return {
              ...auth,
              salesOrderType: params.salesOrderType,
              salesOrganization: params.salesOrganization,
              distributionChannel: params.distributionChannel,
              organizationDivision: params.organizationDivision,
              soldToParty: params.soldToParty,
              items: params.salesOrderItems,
              body: params.salesOrderBody || undefined,
            }
          case 'sap_s4hana_update_sales_order':
            return {
              ...auth,
              salesOrder: params.salesOrder,
              body: params.updateBody,
              ifMatch: params.updateIfMatch || undefined,
            }
          case 'sap_s4hana_delete_sales_order':
            return {
              ...auth,
              salesOrder: params.salesOrder,
              ifMatch: params.updateIfMatch || undefined,
            }
          case 'sap_s4hana_list_outbound_deliveries':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_outbound_delivery':
            return {
              ...auth,
              ...entityFields,
              deliveryDocument: params.deliveryDocument,
            }
          case 'sap_s4hana_list_inbound_deliveries':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_inbound_delivery':
            return {
              ...auth,
              ...entityFields,
              deliveryDocument: params.deliveryDocument,
            }
          case 'sap_s4hana_list_billing_documents':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_billing_document':
            return { ...auth, ...entityFields, billingDocument: params.billingDocument }
          case 'sap_s4hana_list_products':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_product':
            return { ...auth, ...entityFields, product: params.product }
          case 'sap_s4hana_update_product':
            return {
              ...auth,
              product: params.product,
              body: params.updateBody,
              ifMatch: params.updateIfMatch || undefined,
            }
          case 'sap_s4hana_list_material_stock':
            return { ...auth, ...listFields }
          case 'sap_s4hana_list_material_documents':
            return { ...auth, ...listFields }
          case 'sap_s4hana_list_purchase_requisitions':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_purchase_requisition':
            return {
              ...auth,
              ...entityFields,
              purchaseRequisition: params.purchaseRequisition,
            }
          case 'sap_s4hana_create_purchase_requisition':
            return {
              ...auth,
              purchaseRequisitionType: params.purchaseRequisitionType,
              items: params.purchaseRequisitionItems,
              body: params.purchaseRequisitionBody || undefined,
            }
          case 'sap_s4hana_update_purchase_requisition':
            return {
              ...auth,
              purchaseRequisition: params.purchaseRequisition,
              body: params.updateBody,
              ifMatch: params.updateIfMatch || undefined,
            }
          case 'sap_s4hana_list_purchase_orders':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_purchase_order':
            return { ...auth, ...entityFields, purchaseOrder: params.purchaseOrder }
          case 'sap_s4hana_create_purchase_order':
            return {
              ...auth,
              purchaseOrderType: params.purchaseOrderType,
              companyCode: params.companyCode,
              purchasingOrganization: params.purchasingOrganization,
              purchasingGroup: params.purchasingGroup,
              supplier: params.supplier,
              body: params.purchaseOrderBody || undefined,
            }
          case 'sap_s4hana_update_purchase_order':
            return {
              ...auth,
              purchaseOrder: params.purchaseOrder,
              body: params.updateBody,
              ifMatch: params.updateIfMatch || undefined,
            }
          case 'sap_s4hana_list_supplier_invoices':
            return { ...auth, ...listFields }
          case 'sap_s4hana_get_supplier_invoice':
            return {
              ...auth,
              ...entityFields,
              supplierInvoice: params.supplierInvoice,
              fiscalYear: params.fiscalYear,
            }
          case 'sap_s4hana_odata_query':
            return {
              ...auth,
              service: params.odataService,
              path: params.odataPath,
              method: params.odataMethod || 'GET',
              query: params.odataQuery || undefined,
              body: params.odataBody || undefined,
              ifMatch: params.odataIfMatch || undefined,
            }
          default:
            return auth
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    deploymentType: {
      type: 'string',
      description: 'cloud_public | cloud_private | on_premise',
    },
    authType: {
      type: 'string',
      description: 'oauth_client_credentials | basic',
    },
    subdomain: { type: 'string', description: 'BTP subdomain (Cloud Public)' },
    region: { type: 'string', description: 'BTP region (Cloud Public, e.g., eu10, us10)' },
    baseUrl: { type: 'string', description: 'Base URL (Cloud Private / On-Premise)' },
    tokenUrl: {
      type: 'string',
      description: 'OAuth token URL (Cloud Private / On-Premise + OAuth)',
    },
    clientId: { type: 'string', description: 'OAuth client ID' },
    clientSecret: { type: 'string', description: 'OAuth client secret' },
    username: { type: 'string', description: 'Username (Basic auth)' },
    password: { type: 'string', description: 'Password (Basic auth)' },
    filter: { type: 'string', description: 'OData $filter expression' },
    top: { type: 'number', description: 'OData $top' },
    skip: { type: 'number', description: 'OData $skip' },
    orderBy: { type: 'string', description: 'OData $orderby expression' },
    select: { type: 'string', description: 'OData $select fields' },
    expand: { type: 'string', description: 'OData $expand navigation properties' },
    businessPartner: { type: 'string', description: 'BusinessPartner key' },
    businessPartnerCategory: { type: 'string', description: 'BusinessPartnerCategory (1, 2, 3)' },
    businessPartnerGrouping: { type: 'string', description: 'BusinessPartnerGrouping' },
    firstName: { type: 'string', description: 'FirstName for Person' },
    lastName: { type: 'string', description: 'LastName for Person' },
    organizationBPName1: { type: 'string', description: 'OrganizationBPName1 for Organization' },
    businessPartnerBody: { type: 'json', description: 'Additional A_BusinessPartner fields' },
    customer: { type: 'string', description: 'Customer key' },
    salesOrder: { type: 'string', description: 'SalesOrder key' },
    salesOrderType: { type: 'string', description: 'SalesOrderType' },
    salesOrganization: { type: 'string', description: 'SalesOrganization' },
    distributionChannel: { type: 'string', description: 'DistributionChannel' },
    organizationDivision: { type: 'string', description: 'OrganizationDivision' },
    soldToParty: { type: 'string', description: 'SoldToParty business partner key' },
    salesOrderItems: { type: 'json', description: 'Sales order items for to_Item deep insert' },
    salesOrderBody: { type: 'json', description: 'Additional A_SalesOrder fields' },
    deliveryDocument: { type: 'string', description: 'DeliveryDocument key' },
    billingDocument: { type: 'string', description: 'BillingDocument key' },
    product: { type: 'string', description: 'Product key' },
    purchaseRequisition: { type: 'string', description: 'PurchaseRequisition key' },
    purchaseRequisitionType: { type: 'string', description: 'PurchaseRequisitionType' },
    purchaseRequisitionItems: {
      type: 'json',
      description: 'Purchase requisition items for to_PurchaseReqnItem deep insert',
    },
    purchaseRequisitionBody: {
      type: 'json',
      description: 'Additional A_PurchaseRequisitionHeader fields',
    },
    purchaseOrder: { type: 'string', description: 'PurchaseOrder key' },
    purchaseOrderType: { type: 'string', description: 'PurchaseOrderType' },
    companyCode: { type: 'string', description: 'CompanyCode' },
    purchasingOrganization: { type: 'string', description: 'PurchasingOrganization' },
    purchasingGroup: { type: 'string', description: 'PurchasingGroup' },
    supplier: { type: 'string', description: 'Supplier business partner key' },
    purchaseOrderBody: { type: 'json', description: 'Items and additional A_PurchaseOrder fields' },
    supplierInvoice: { type: 'string', description: 'SupplierInvoice key' },
    fiscalYear: { type: 'string', description: 'FiscalYear (4-digit year)' },
    odataService: { type: 'string', description: 'OData service name' },
    odataPath: { type: 'string', description: 'OData entity path' },
    odataMethod: { type: 'string', description: 'HTTP method for OData call' },
    odataQuery: { type: 'json', description: 'OData query parameters' },
    odataBody: { type: 'json', description: 'OData request body' },
    odataIfMatch: { type: 'string', description: 'If-Match ETag header' },
    updateBody: { type: 'json', description: 'JSON object with fields to update' },
    updateIfMatch: {
      type: 'string',
      description: 'If-Match ETag for update/delete (defaults to "*")',
    },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: { type: 'json', description: 'Parsed OData payload (entity, collection, or null)' },
  },
}
