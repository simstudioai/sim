// Shopify GraphQL API Types
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property constants for Shopify tools.
 * Based on Shopify Admin GraphQL API documentation.
 * @see https://shopify.dev/docs/api/admin-graphql
 */

/** Money properties from Shopify MoneyV2 object */
const MONEY_PROPERTIES = {
  amount: { type: 'string', description: 'Decimal money amount' },
  currencyCode: { type: 'string', description: 'Currency code (ISO 4217)' },
} as const satisfies Record<string, OutputProperty>

/** MoneyBag properties (shop and presentment currencies) */
const MONEY_BAG_PROPERTIES = {
  shopMoney: {
    type: 'object',
    description: 'Amount in shop currency',
    properties: MONEY_PROPERTIES,
  },
  presentmentMoney: {
    type: 'object',
    description: 'Amount in presentment currency',
    properties: MONEY_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Address properties from Shopify MailingAddress object */
const ADDRESS_PROPERTIES = {
  firstName: { type: 'string', description: 'First name', optional: true },
  lastName: { type: 'string', description: 'Last name', optional: true },
  address1: { type: 'string', description: 'Street address line 1', optional: true },
  address2: { type: 'string', description: 'Street address line 2', optional: true },
  city: { type: 'string', description: 'City', optional: true },
  province: { type: 'string', description: 'Province or state name', optional: true },
  provinceCode: { type: 'string', description: 'Province or state code', optional: true },
  country: { type: 'string', description: 'Country name', optional: true },
  countryCode: { type: 'string', description: 'Country code (ISO 3166-1 alpha-2)', optional: true },
  zip: { type: 'string', description: 'Postal or ZIP code', optional: true },
  phone: { type: 'string', description: 'Phone number', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Variant properties from Shopify ProductVariant object */
const VARIANT_PROPERTIES = {
  id: { type: 'string', description: 'Unique variant identifier (GID)' },
  title: { type: 'string', description: 'Variant title' },
  price: { type: 'string', description: 'Variant price' },
  compareAtPrice: { type: 'string', description: 'Compare at price', optional: true },
  sku: { type: 'string', description: 'Stock keeping unit', optional: true },
  inventoryQuantity: {
    type: 'number',
    description: 'Available inventory quantity',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Image properties from Shopify Image object */
const IMAGE_PROPERTIES = {
  id: { type: 'string', description: 'Unique image identifier (GID)' },
  url: { type: 'string', description: 'Image URL' },
  altText: { type: 'string', description: 'Alternative text for accessibility', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Tracking info properties from Shopify FulfillmentTrackingInfo object */
const TRACKING_INFO_PROPERTIES = {
  company: { type: 'string', description: 'Shipping carrier name', optional: true },
  number: { type: 'string', description: 'Tracking number', optional: true },
  url: { type: 'string', description: 'Tracking URL', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Product output properties based on Shopify Product GraphQL object */
export const PRODUCT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique product identifier (GID)' },
  title: { type: 'string', description: 'Product title' },
  handle: { type: 'string', description: 'URL-friendly product identifier' },
  descriptionHtml: { type: 'string', description: 'Product description in HTML format' },
  vendor: { type: 'string', description: 'Product vendor or manufacturer' },
  productType: { type: 'string', description: 'Product type classification' },
  tags: {
    type: 'array',
    description: 'Product tags for categorization',
    items: { type: 'string' },
  },
  status: { type: 'string', description: 'Product status (ACTIVE, DRAFT, ARCHIVED)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  variants: {
    type: 'object',
    description: 'Product variants with edges/nodes structure',
    properties: {
      edges: {
        type: 'array',
        description: 'Array of variant edges',
        items: {
          type: 'object',
          properties: {
            node: {
              type: 'object',
              description: 'Variant node',
              properties: VARIANT_PROPERTIES,
            },
          },
        },
      },
    },
  },
  images: {
    type: 'object',
    description: 'Product images with edges/nodes structure',
    properties: {
      edges: {
        type: 'array',
        description: 'Array of image edges',
        items: {
          type: 'object',
          properties: {
            node: {
              type: 'object',
              description: 'Image node',
              properties: IMAGE_PROPERTIES,
            },
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Customer output properties based on Shopify Customer GraphQL object */
export const CUSTOMER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique customer identifier (GID)' },
  email: { type: 'string', description: 'Customer email address', optional: true },
  firstName: { type: 'string', description: 'Customer first name', optional: true },
  lastName: { type: 'string', description: 'Customer last name', optional: true },
  phone: { type: 'string', description: 'Customer phone number', optional: true },
  createdAt: { type: 'string', description: 'Account creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  note: { type: 'string', description: 'Internal notes about the customer', optional: true },
  tags: {
    type: 'array',
    description: 'Customer tags for categorization',
    items: { type: 'string' },
  },
  amountSpent: {
    type: 'object',
    description: 'Total amount spent by customer',
    properties: MONEY_PROPERTIES,
  },
  addresses: {
    type: 'array',
    description: 'Customer addresses',
    items: {
      type: 'object',
      properties: ADDRESS_PROPERTIES,
    },
  },
  defaultAddress: {
    type: 'object',
    description: 'Customer default address',
    properties: ADDRESS_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Line item properties from Shopify LineItem GraphQL object */
const LINE_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Unique line item identifier (GID)' },
  title: { type: 'string', description: 'Product title' },
  quantity: { type: 'number', description: 'Quantity ordered' },
  variant: {
    type: 'object',
    description: 'Associated product variant',
    properties: VARIANT_PROPERTIES,
    optional: true,
  },
  originalTotalSet: {
    type: 'object',
    description: 'Original total price before discounts',
    properties: MONEY_BAG_PROPERTIES,
  },
  discountedTotalSet: {
    type: 'object',
    description: 'Total price after discounts',
    properties: MONEY_BAG_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/** Fulfillment properties from Shopify Fulfillment GraphQL object */
const FULFILLMENT_PROPERTIES = {
  id: { type: 'string', description: 'Unique fulfillment identifier (GID)' },
  status: {
    type: 'string',
    description: 'Fulfillment status (pending, open, success, cancelled, error, failure)',
  },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  trackingInfo: {
    type: 'array',
    description: 'Tracking information for shipments',
    items: {
      type: 'object',
      properties: TRACKING_INFO_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Order customer properties (subset of full customer) */
const ORDER_CUSTOMER_PROPERTIES = {
  id: { type: 'string', description: 'Unique customer identifier (GID)' },
  email: { type: 'string', description: 'Customer email address', optional: true },
  firstName: { type: 'string', description: 'Customer first name', optional: true },
  lastName: { type: 'string', description: 'Customer last name', optional: true },
  phone: { type: 'string', description: 'Customer phone number', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Order output properties based on Shopify Order GraphQL object */
export const ORDER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique order identifier (GID)' },
  name: { type: 'string', description: 'Order name (e.g., #1001)' },
  email: { type: 'string', description: 'Customer email for the order', optional: true },
  phone: { type: 'string', description: 'Customer phone for the order', optional: true },
  createdAt: { type: 'string', description: 'Order creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  cancelledAt: { type: 'string', description: 'Cancellation timestamp (ISO 8601)', optional: true },
  closedAt: { type: 'string', description: 'Closure timestamp (ISO 8601)', optional: true },
  displayFinancialStatus: {
    type: 'string',
    description:
      'Financial status (PENDING, AUTHORIZED, PARTIALLY_PAID, PAID, PARTIALLY_REFUNDED, REFUNDED, VOIDED)',
  },
  displayFulfillmentStatus: {
    type: 'string',
    description:
      'Fulfillment status (UNFULFILLED, PARTIALLY_FULFILLED, FULFILLED, RESTOCKED, PENDING_FULFILLMENT, OPEN, IN_PROGRESS, ON_HOLD, SCHEDULED)',
  },
  totalPriceSet: {
    type: 'object',
    description: 'Total order price',
    properties: MONEY_BAG_PROPERTIES,
  },
  subtotalPriceSet: {
    type: 'object',
    description: 'Order subtotal (before shipping and taxes)',
    properties: MONEY_BAG_PROPERTIES,
  },
  totalTaxSet: {
    type: 'object',
    description: 'Total tax amount',
    properties: MONEY_BAG_PROPERTIES,
  },
  totalShippingPriceSet: {
    type: 'object',
    description: 'Total shipping price',
    properties: MONEY_BAG_PROPERTIES,
  },
  note: { type: 'string', description: 'Order note', optional: true },
  tags: {
    type: 'array',
    description: 'Order tags',
    items: { type: 'string' },
  },
  customer: {
    type: 'object',
    description: 'Customer who placed the order',
    properties: ORDER_CUSTOMER_PROPERTIES,
    optional: true,
  },
  lineItems: {
    type: 'object',
    description: 'Order line items with edges/nodes structure',
    properties: {
      edges: {
        type: 'array',
        description: 'Array of line item edges',
        items: {
          type: 'object',
          properties: {
            node: {
              type: 'object',
              description: 'Line item node',
              properties: LINE_ITEM_PROPERTIES,
            },
          },
        },
      },
    },
  },
  shippingAddress: {
    type: 'object',
    description: 'Shipping address',
    properties: ADDRESS_PROPERTIES,
    optional: true,
  },
  billingAddress: {
    type: 'object',
    description: 'Billing address',
    properties: ADDRESS_PROPERTIES,
    optional: true,
  },
  fulfillments: {
    type: 'array',
    description: 'Order fulfillments',
    items: {
      type: 'object',
      properties: FULFILLMENT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Fulfillment output properties for create fulfillment response */
export const FULFILLMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique fulfillment identifier (GID)' },
  status: {
    type: 'string',
    description: 'Fulfillment status (pending, open, success, cancelled, error, failure)',
  },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  trackingInfo: {
    type: 'array',
    description: 'Tracking information for shipments',
    items: {
      type: 'object',
      properties: TRACKING_INFO_PROPERTIES,
    },
  },
  fulfillmentLineItems: {
    type: 'array',
    description: 'Fulfilled line items',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Fulfillment line item identifier (GID)' },
        quantity: { type: 'number', description: 'Quantity fulfilled' },
        lineItem: {
          type: 'object',
          description: 'Associated order line item',
          properties: {
            title: { type: 'string', description: 'Product title' },
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Location output properties based on Shopify Location GraphQL object */
export const LOCATION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique location identifier (GID)' },
  name: { type: 'string', description: 'Location name' },
  isActive: { type: 'boolean', description: 'Whether the location is active' },
  fulfillsOnlineOrders: {
    type: 'boolean',
    description: 'Whether the location fulfills online orders',
  },
  address: {
    type: 'object',
    description: 'Location address',
    properties: ADDRESS_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Collection output properties based on Shopify Collection GraphQL object */
export const COLLECTION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique collection identifier (GID)' },
  title: { type: 'string', description: 'Collection title' },
  handle: { type: 'string', description: 'URL-friendly collection identifier' },
  description: { type: 'string', description: 'Plain text description', optional: true },
  descriptionHtml: { type: 'string', description: 'HTML-formatted description', optional: true },
  productsCount: { type: 'number', description: 'Number of products in the collection' },
  sortOrder: { type: 'string', description: 'Product sort order in the collection' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  image: {
    type: 'object',
    description: 'Collection image',
    properties: IMAGE_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Collection with products output properties */
export const COLLECTION_WITH_PRODUCTS_OUTPUT_PROPERTIES = {
  ...COLLECTION_OUTPUT_PROPERTIES,
  products: {
    type: 'array',
    description: 'Products in the collection',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique product identifier (GID)' },
        title: { type: 'string', description: 'Product title' },
        handle: { type: 'string', description: 'URL-friendly product identifier' },
        status: { type: 'string', description: 'Product status (ACTIVE, DRAFT, ARCHIVED)' },
        vendor: { type: 'string', description: 'Product vendor' },
        productType: { type: 'string', description: 'Product type classification' },
        totalInventory: { type: 'number', description: 'Total inventory across all variants' },
        featuredImage: {
          type: 'object',
          description: 'Featured product image',
          properties: IMAGE_PROPERTIES,
          optional: true,
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Inventory level output properties based on Shopify InventoryLevel GraphQL object */
export const INVENTORY_LEVEL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Inventory item identifier (GID)' },
  sku: { type: 'string', description: 'Stock keeping unit', optional: true },
  tracked: { type: 'boolean', description: 'Whether inventory is tracked' },
  levels: {
    type: 'array',
    description: 'Inventory levels at different locations',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Inventory level identifier (GID)' },
        available: { type: 'number', description: 'Available quantity' },
        onHand: { type: 'number', description: 'On-hand quantity' },
        committed: { type: 'number', description: 'Committed quantity' },
        incoming: { type: 'number', description: 'Incoming quantity' },
        reserved: { type: 'number', description: 'Reserved quantity' },
        location: {
          type: 'object',
          description: 'Location for this inventory level',
          properties: {
            id: { type: 'string', description: 'Location identifier (GID)' },
            name: { type: 'string', description: 'Location name' },
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Inventory adjustment output properties */
export const INVENTORY_ADJUSTMENT_OUTPUT_PROPERTIES = {
  adjustmentGroup: {
    type: 'object',
    description: 'Inventory adjustment group details',
    properties: {
      createdAt: { type: 'string', description: 'Adjustment timestamp (ISO 8601)' },
      reason: { type: 'string', description: 'Adjustment reason' },
    },
  },
  changes: {
    type: 'array',
    description: 'Inventory changes applied',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Quantity name (e.g., available)' },
        delta: { type: 'number', description: 'Quantity change amount' },
        quantityAfterChange: { type: 'number', description: 'Quantity after adjustment' },
        item: {
          type: 'object',
          description: 'Inventory item',
          properties: {
            id: { type: 'string', description: 'Inventory item identifier (GID)' },
            sku: { type: 'string', description: 'Stock keeping unit', optional: true },
          },
        },
        location: {
          type: 'object',
          description: 'Location of the adjustment',
          properties: {
            id: { type: 'string', description: 'Location identifier (GID)' },
            name: { type: 'string', description: 'Location name' },
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Inventory item output properties based on Shopify InventoryItem GraphQL object */
export const INVENTORY_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique inventory item identifier (GID)' },
  sku: { type: 'string', description: 'Stock keeping unit', optional: true },
  tracked: { type: 'boolean', description: 'Whether inventory is tracked' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  variant: {
    type: 'object',
    description: 'Associated product variant',
    properties: {
      id: { type: 'string', description: 'Variant identifier (GID)' },
      title: { type: 'string', description: 'Variant title' },
      product: {
        type: 'object',
        description: 'Associated product',
        properties: {
          id: { type: 'string', description: 'Product identifier (GID)' },
          title: { type: 'string', description: 'Product title' },
        },
        optional: true,
      },
    },
    optional: true,
  },
  inventoryLevels: {
    type: 'array',
    description: 'Inventory levels at different locations',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Inventory level identifier (GID)' },
        available: { type: 'number', description: 'Available quantity' },
        location: {
          type: 'object',
          description: 'Location for this inventory level',
          properties: {
            id: { type: 'string', description: 'Location identifier (GID)' },
            name: { type: 'string', description: 'Location name' },
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Pagination info output properties */
export const PAGE_INFO_OUTPUT_PROPERTIES = {
  hasNextPage: { type: 'boolean', description: 'Whether there are more results after this page' },
  hasPreviousPage: { type: 'boolean', description: 'Whether there are results before this page' },
} as const satisfies Record<string, OutputProperty>

/** Cancel order output properties */
export const CANCEL_ORDER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Job identifier for the cancellation' },
  cancelled: { type: 'boolean', description: 'Whether the cancellation completed' },
  message: { type: 'string', description: 'Status message' },
} as const satisfies Record<string, OutputProperty>

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
