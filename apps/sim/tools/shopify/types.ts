// Shopify GraphQL API Types
import type { ToolResponse } from '@/tools/types'

// Common GraphQL Response Types
export interface ShopifyGraphQLError {
  message: string
  locations?: { line: number; column: number }[]
  path?: string[]
  extensions?: Record<string, unknown>
}

export interface ShopifyUserError {
  field: string[]
  message: string
}

// Product Types
export interface ShopifyProduct {
  id: string
  title: string
  handle: string
  descriptionHtml: string
  vendor: string
  productType: string
  tags: string[]
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
  variants: {
    edges: Array<{
      node: ShopifyVariant
    }>
  }
  images: {
    edges: Array<{
      node: ShopifyImage
    }>
  }
}

export interface ShopifyVariant {
  id: string
  title: string
  price: string
  compareAtPrice: string | null
  sku: string | null
  inventoryQuantity: number
}

export interface ShopifyImage {
  id: string
  url: string
  altText: string | null
}

// Order Types
export interface ShopifyOrder {
  id: string
  name: string
  email: string | null
  phone: string | null
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  closedAt: string | null
  displayFinancialStatus: string
  displayFulfillmentStatus: string
  totalPriceSet: ShopifyMoneyBag
  subtotalPriceSet: ShopifyMoneyBag
  totalTaxSet: ShopifyMoneyBag
  totalShippingPriceSet: ShopifyMoneyBag
  note: string | null
  tags: string[]
  customer: ShopifyCustomer | null
  lineItems: {
    edges: Array<{
      node: ShopifyLineItem
    }>
  }
  shippingAddress: ShopifyAddress | null
  billingAddress: ShopifyAddress | null
  fulfillments: ShopifyFulfillment[]
}

export interface ShopifyMoneyBag {
  shopMoney: {
    amount: string
    currencyCode: string
  }
  presentmentMoney: {
    amount: string
    currencyCode: string
  }
}

export interface ShopifyLineItem {
  id: string
  title: string
  quantity: number
  variant: ShopifyVariant | null
  originalTotalSet: ShopifyMoneyBag
  discountedTotalSet: ShopifyMoneyBag
}

export interface ShopifyAddress {
  firstName: string | null
  lastName: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  provinceCode: string | null
  country: string | null
  countryCode: string | null
  zip: string | null
  phone: string | null
}

// Customer Types
export interface ShopifyCustomer {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  createdAt: string
  updatedAt: string
  note: string | null
  tags: string[]
  amountSpent: {
    amount: string
    currencyCode: string
  }
  addresses: ShopifyAddress[]
  defaultAddress: ShopifyAddress | null
}

// Fulfillment Types
export interface ShopifyFulfillment {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  trackingInfo: Array<{
    company: string | null
    number: string | null
    url: string | null
  }>
}

// Inventory Types
export interface ShopifyInventoryLevel {
  id: string
  available: number
  onHand: number
  committed: number
  incoming: number
  reserved: number
  location: {
    id: string
    name: string
  }
}

export interface ShopifyInventoryItem {
  id: string
  sku: string | null
  tracked: boolean
  inventoryLevels: {
    edges: Array<{
      node: ShopifyInventoryLevel
    }>
  }
}

// Tool Parameter Types
export interface ShopifyBaseParams {
  accessToken: string
  shopDomain: string
  idToken?: string // Shop domain from OAuth, used as fallback
}

// Product Tool Params
export interface ShopifyCreateProductParams extends ShopifyBaseParams {
  title: string
  descriptionHtml?: string
  vendor?: string
  productType?: string
  tags?: string[]
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
}

export interface ShopifyGetProductParams extends ShopifyBaseParams {
  productId: string
}

export interface ShopifyListProductsParams extends ShopifyBaseParams {
  first?: number
  query?: string
}

export interface ShopifyUpdateProductParams extends ShopifyBaseParams {
  productId: string
  title?: string
  descriptionHtml?: string
  vendor?: string
  productType?: string
  tags?: string[]
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
}

export interface ShopifyDeleteProductParams extends ShopifyBaseParams {
  productId: string
}

// Order Tool Params
export interface ShopifyGetOrderParams extends ShopifyBaseParams {
  orderId: string
}

export interface ShopifyListOrdersParams extends ShopifyBaseParams {
  first?: number
  status?: string
  query?: string
}

export interface ShopifyUpdateOrderParams extends ShopifyBaseParams {
  orderId: string
  note?: string
  tags?: string[]
  email?: string
}

export interface ShopifyCancelOrderParams extends ShopifyBaseParams {
  orderId: string
  reason: 'CUSTOMER' | 'FRAUD' | 'INVENTORY' | 'DECLINED' | 'OTHER'
  notifyCustomer?: boolean
  refund?: boolean
  restock?: boolean
  staffNote?: string
}

// Customer Tool Params
export interface ShopifyCreateCustomerParams extends ShopifyBaseParams {
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  note?: string
  tags?: string[]
  addresses?: Array<{
    address1?: string
    address2?: string
    city?: string
    province?: string
    country?: string
    zip?: string
    phone?: string
  }>
}

export interface ShopifyGetCustomerParams extends ShopifyBaseParams {
  customerId: string
}

export interface ShopifyListCustomersParams extends ShopifyBaseParams {
  first?: number
  query?: string
}

export interface ShopifyUpdateCustomerParams extends ShopifyBaseParams {
  customerId: string
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  note?: string
  tags?: string[]
}

export interface ShopifyDeleteCustomerParams extends ShopifyBaseParams {
  customerId: string
}

// Inventory Tool Params
export interface ShopifyGetInventoryLevelParams extends ShopifyBaseParams {
  inventoryItemId: string
  locationId?: string
}

export interface ShopifyAdjustInventoryParams extends ShopifyBaseParams {
  inventoryItemId: string
  locationId: string
  delta: number
}

export interface ShopifySetInventoryParams extends ShopifyBaseParams {
  inventoryItemId: string
  locationId: string
  quantity: number
}

// Fulfillment Tool Params
export interface ShopifyCreateFulfillmentParams extends ShopifyBaseParams {
  orderId: string
  lineItemIds?: string[]
  trackingNumber?: string
  trackingCompany?: string
  trackingUrl?: string
  notifyCustomer?: boolean
}

// Tool Response Types
export interface ShopifyProductResponse extends ToolResponse {
  output: {
    product?: ShopifyProduct
  }
}

export interface ShopifyProductsResponse extends ToolResponse {
  output: {
    products?: ShopifyProduct[]
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
    }
  }
}

export interface ShopifyOrderResponse extends ToolResponse {
  output: {
    order?: ShopifyOrder | Record<string, unknown>
  }
}

export interface ShopifyOrdersResponse extends ToolResponse {
  output: {
    orders?: ShopifyOrder[]
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
    }
  }
}

export interface ShopifyCustomerResponse extends ToolResponse {
  output: {
    customer?: ShopifyCustomer
  }
}

export interface ShopifyCustomersResponse extends ToolResponse {
  output: {
    customers?: ShopifyCustomer[]
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
    }
  }
}

export interface ShopifyInventoryResponse extends ToolResponse {
  output: {
    inventoryLevel?: ShopifyInventoryLevel | Record<string, unknown>
  }
}

export interface ShopifyFulfillmentResponse extends ToolResponse {
  output: {
    fulfillment?: ShopifyFulfillment
  }
}

export interface ShopifyDeleteResponse extends ToolResponse {
  output: {
    deletedId?: string
  }
}
