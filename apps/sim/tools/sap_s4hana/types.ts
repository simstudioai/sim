import type { ToolResponse } from '@/tools/types'

export type SapDeploymentType = 'cloud_public' | 'cloud_private' | 'on_premise'
export type SapAuthType = 'oauth_client_credentials' | 'basic'

export interface SapBaseParams {
  deploymentType?: SapDeploymentType
  authType?: SapAuthType
  subdomain?: string
  region?: string
  baseUrl?: string
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  username?: string
  password?: string
}

interface ProxyOutput {
  status: number
  data: unknown
}

export interface SapProxyResponse extends ToolResponse {
  output: ProxyOutput
}

export interface ListBusinessPartnersParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetBusinessPartnerParams extends SapBaseParams {
  businessPartner: string
  select?: string
  expand?: string
}

export interface CreateBusinessPartnerParams extends SapBaseParams {
  businessPartnerCategory: string
  businessPartnerGrouping: string
  firstName?: string
  lastName?: string
  organizationBPName1?: string
  body?: Record<string, unknown> | string
}

export interface ListSalesOrdersParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetSalesOrderParams extends SapBaseParams {
  salesOrder: string
  select?: string
  expand?: string
}

export interface CreateSalesOrderParams extends SapBaseParams {
  salesOrderType: string
  salesOrganization: string
  distributionChannel: string
  organizationDivision: string
  soldToParty: string
  items: string | Array<Record<string, unknown>>
  body?: Record<string, unknown> | string
}

export interface ListProductsParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetProductParams extends SapBaseParams {
  product: string
  select?: string
  expand?: string
}

export interface ListPurchaseOrdersParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetPurchaseOrderParams extends SapBaseParams {
  purchaseOrder: string
  select?: string
  expand?: string
}

export interface CreatePurchaseOrderParams extends SapBaseParams {
  purchaseOrderType: string
  companyCode: string
  purchasingOrganization: string
  purchasingGroup: string
  supplier: string
  body: Record<string, unknown> | string
}

export interface ListSupplierInvoicesParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetSupplierInvoiceParams extends SapBaseParams {
  supplierInvoice: string
  fiscalYear: string
  select?: string
  expand?: string
}

export interface ListOutboundDeliveriesParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetOutboundDeliveryParams extends SapBaseParams {
  deliveryDocument: string
  select?: string
  expand?: string
}

export interface ListBillingDocumentsParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetBillingDocumentParams extends SapBaseParams {
  billingDocument: string
  select?: string
  expand?: string
}

export interface ListPurchaseRequisitionsParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetPurchaseRequisitionParams extends SapBaseParams {
  purchaseRequisition: string
  select?: string
  expand?: string
}

export interface ListMaterialStockParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface ListSuppliersParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetSupplierParams extends SapBaseParams {
  supplier: string
  select?: string
  expand?: string
}

export interface ListCustomersParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetCustomerParams extends SapBaseParams {
  customer: string
  select?: string
  expand?: string
}

export interface ListInboundDeliveriesParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface GetInboundDeliveryParams extends SapBaseParams {
  deliveryDocument: string
  select?: string
  expand?: string
}

export interface GetMaterialDocumentParams extends SapBaseParams {
  materialDocumentYear: string
  materialDocument: string
  select?: string
  expand?: string
}

export interface ListMaterialDocumentsParams extends SapBaseParams {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}

export interface UpdateBusinessPartnerParams extends SapBaseParams {
  businessPartner: string
  body: Record<string, unknown> | string
  ifMatch?: string
}

export interface UpdateCustomerParams extends SapBaseParams {
  customer: string
  body: Record<string, unknown> | string
  ifMatch?: string
}

export interface UpdateSupplierParams extends SapBaseParams {
  supplier: string
  body: Record<string, unknown> | string
  ifMatch?: string
}

export interface UpdateProductParams extends SapBaseParams {
  product: string
  body: Record<string, unknown> | string
  ifMatch?: string
}

export interface UpdateSalesOrderParams extends SapBaseParams {
  salesOrder: string
  body: Record<string, unknown> | string
  ifMatch?: string
}

export interface DeleteSalesOrderParams extends SapBaseParams {
  salesOrder: string
  ifMatch?: string
}

export interface UpdatePurchaseOrderParams extends SapBaseParams {
  purchaseOrder: string
  body: Record<string, unknown> | string
  ifMatch?: string
}

export interface UpdatePurchaseRequisitionParams extends SapBaseParams {
  purchaseRequisition: string
  body: Record<string, unknown> | string
  ifMatch?: string
}

export interface CreatePurchaseRequisitionParams extends SapBaseParams {
  purchaseRequisitionType: string
  items: string | Array<Record<string, unknown>>
  body?: Record<string, unknown> | string
}

export type ODataMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'MERGE'

export interface ODataQueryParams extends SapBaseParams {
  service: string
  path: string
  method?: ODataMethod
  query?: string | Record<string, string | number | boolean>
  body?: Record<string, unknown> | string
  ifMatch?: string
}
