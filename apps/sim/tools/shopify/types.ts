import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property constants for Shopify tools.
 * Based on Shopify Admin GraphQL API documentation.
 * @see https://shopify.dev/docs/api/admin-graphql
 */

/** Pagination info output properties */
export const PAGE_INFO_OUTPUT_PROPERTIES = {
  startCursor: { type: 'string', nullable: true, description: 'Cursor at the start of this page' },
  endCursor: {
    type: 'string',
    nullable: true,
    description: 'Cursor to pass as after for the next page',
  },
  hasNextPage: { type: 'boolean', description: 'Whether there are more results after this page' },
  hasPreviousPage: { type: 'boolean', description: 'Whether there are results before this page' },
} as const satisfies Record<string, OutputProperty>

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
  firstName: { type: 'string', nullable: true, description: 'First name' },
  lastName: { type: 'string', nullable: true, description: 'Last name' },
  address1: {
    type: 'string',
    nullable: true,
    description: 'Street address line 1',
    optional: true,
  },
  address2: {
    type: 'string',
    nullable: true,
    description: 'Street address line 2',
    optional: true,
  },
  city: { type: 'string', nullable: true, description: 'City' },
  province: { type: 'string', nullable: true, description: 'Province or state name' },
  provinceCode: {
    type: 'string',
    nullable: true,
    description: 'Province or state code',
    optional: true,
  },
  country: { type: 'string', nullable: true, description: 'Country name' },
  countryCode: {
    type: 'string',
    nullable: true,
    description: 'Country code (ISO 3166-1 alpha-2)',
    optional: true,
  },
  zip: { type: 'string', nullable: true, description: 'Postal or ZIP code' },
  phone: { type: 'string', nullable: true, description: 'Phone number', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Variant properties from Shopify ProductVariant object */
const VARIANT_PROPERTIES = {
  id: { type: 'string', description: 'Unique variant identifier (GID)' },
  title: { type: 'string', description: 'Variant title' },
  price: { type: 'string', description: 'Variant price' },
  barcode: { type: 'string', nullable: true, optional: true, description: 'Variant barcode' },
  taxable: { type: 'boolean', optional: true, description: 'Whether the variant is taxable' },
  inventoryPolicy: {
    type: 'string',
    optional: true,
    description: 'Inventory policy (DENY or CONTINUE)',
  },
  inventoryItem: {
    optional: true,
    type: 'object',
    description: 'Inventory item for stock operations',
    properties: {
      id: { type: 'string', description: 'Inventory item GID' },
      sku: { type: 'string', nullable: true, description: 'SKU' },
      tracked: { type: 'boolean', description: 'Whether stock is tracked' },
    },
  },
  selectedOptions: {
    optional: true,
    type: 'array',
    description: 'Selected product options',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Option name' },
        value: { type: 'string', description: 'Selected value' },
      },
    },
  },
  compareAtPrice: {
    type: 'string',
    nullable: true,
    description: 'Compare at price',
    optional: true,
  },
  sku: { type: 'string', nullable: true, description: 'Stock keeping unit' },
  inventoryQuantity: {
    type: 'number',
    nullable: true,
    description: 'Available inventory quantity',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Variant fields always selected by bulk create and update mutations, including nullable values. */
export const BULK_VARIANT_OUTPUT_PROPERTIES = {
  ...VARIANT_PROPERTIES,
  barcode: { type: 'string', nullable: true, description: 'Variant barcode' },
  taxable: { type: 'boolean', description: 'Whether the variant is taxable' },
  inventoryPolicy: { type: 'string', description: 'Inventory policy (DENY or CONTINUE)' },
  inventoryItem: {
    type: 'object',
    description: 'Inventory item for stock operations',
    properties: {
      id: { type: 'string', description: 'Inventory item GID' },
      sku: { type: 'string', nullable: true, description: 'SKU' },
      tracked: { type: 'boolean', description: 'Whether stock is tracked' },
    },
  },
  selectedOptions: {
    type: 'array',
    description: 'Selected product options',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Option name' },
        value: { type: 'string', description: 'Selected value' },
      },
    },
  },
  compareAtPrice: { type: 'string', nullable: true, description: 'Compare at price' },
  inventoryQuantity: {
    type: 'number',
    nullable: true,
    description: 'Available inventory quantity',
  },
} as const satisfies Record<string, OutputProperty>

/** Image properties from Shopify Image object */
const IMAGE_PROPERTIES = {
  id: { type: 'string', nullable: true, description: 'Unique image identifier (GID)' },
  url: { type: 'string', description: 'Image URL' },
  altText: { type: 'string', nullable: true, description: 'Alternative text for accessibility' },
} as const satisfies Record<string, OutputProperty>

const FEATURED_IMAGE_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Featured image URL' },
  altText: { type: 'string', nullable: true, description: 'Alternative text for accessibility' },
} as const satisfies Record<string, OutputProperty>

/** Tracking info properties from Shopify FulfillmentTrackingInfo object */
const TRACKING_INFO_PROPERTIES = {
  company: { type: 'string', nullable: true, description: 'Shipping carrier name' },
  number: { type: 'string', nullable: true, description: 'Tracking number' },
  url: { type: 'string', nullable: true, description: 'Tracking URL' },
} as const satisfies Record<string, OutputProperty>

/** Product output properties based on Shopify Product GraphQL object */
export const PRODUCT_OUTPUT_PROPERTIES = {
  templateSuffix: {
    type: 'string',
    nullable: true,
    optional: true,
    description: 'Theme template suffix',
  },
  requiresSellingPlan: {
    type: 'boolean',
    optional: true,
    description: 'Whether purchasing requires a selling plan',
  },
  category: {
    type: 'object',
    nullable: true,
    optional: true,
    description: 'Product taxonomy category',
    properties: {
      id: { type: 'string', description: 'Taxonomy category GID' },
      fullName: { type: 'string', description: 'Category path' },
    },
  },
  id: { type: 'string', description: 'Unique product identifier (GID)' },
  title: { type: 'string', description: 'Product title' },
  handle: { type: 'string', description: 'URL-friendly product identifier' },
  seo: {
    optional: true,
    type: 'object',
    description: 'Search engine listing',
    properties: {
      title: { type: 'string', nullable: true, description: 'SEO title' },
      description: { type: 'string', nullable: true, description: 'SEO description' },
    },
  },
  onlineStoreUrl: {
    type: 'string',
    nullable: true,
    optional: true,
    description: 'Online store URL, null when not published',
  },
  options: {
    optional: true,
    type: 'array',
    description: 'Product options',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Option GID' },
        name: { type: 'string', description: 'Option name' },
        position: { type: 'number', description: 'Option position' },
        values: { type: 'array', description: 'Option values', items: { type: 'string' } },
      },
    },
  },
  descriptionHtml: { type: 'string', description: 'Product description in HTML format' },
  vendor: { type: 'string', description: 'Product vendor or manufacturer' },
  productType: { type: 'string', description: 'Product type classification' },
  tags: {
    type: 'array',
    description: 'Product tags for categorization',
    items: { type: 'string' },
  },
  status: { type: 'string', description: 'Product status (ACTIVE, DRAFT, ARCHIVED, UNLISTED)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  variants: {
    type: 'object',
    description: 'Product variants page; use Get Product with variantsAfter for subsequent pages',
    properties: {
      pageInfo: {
        type: 'object',
        description: 'Variant pagination',
        properties: PAGE_INFO_OUTPUT_PROPERTIES,
      },
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
    description: 'Product images page; use Get Product with imagesAfter for subsequent pages',
    properties: {
      pageInfo: {
        type: 'object',
        description: 'Image pagination',
        properties: PAGE_INFO_OUTPUT_PROPERTIES,
      },
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

/** Customer fields returned by list queries, excluding the separate addresses collection. */
export const CUSTOMER_SUMMARY_OUTPUT_PROPERTIES = {
  emailMarketingConsent: {
    type: 'object',
    nullable: true,
    description: 'Email marketing consent',
    properties: {
      marketingState: { type: 'string', description: 'Consent state' },
      marketingOptInLevel: { type: 'string', nullable: true, description: 'Opt-in level' },
      consentUpdatedAt: { type: 'string', nullable: true, description: 'Consent update timestamp' },
    },
  },
  smsMarketingConsent: {
    type: 'object',
    nullable: true,
    description: 'SMS marketing consent',
    properties: {
      marketingState: { type: 'string', description: 'Consent state' },
      marketingOptInLevel: { type: 'string', description: 'Opt-in level' },
      consentUpdatedAt: { type: 'string', nullable: true, description: 'Consent update timestamp' },
    },
  },
  id: { type: 'string', description: 'Unique customer identifier (GID)' },
  email: { type: 'string', nullable: true, description: 'Customer email address' },
  firstName: { type: 'string', nullable: true, description: 'Customer first name' },
  lastName: { type: 'string', nullable: true, description: 'Customer last name' },
  phone: { type: 'string', nullable: true, description: 'Customer phone number' },
  createdAt: { type: 'string', description: 'Account creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  note: { type: 'string', nullable: true, description: 'Internal notes about the customer' },
  tags: {
    type: 'array',
    description: 'Customer tags for categorization',
    items: { type: 'string' },
  },
  numberOfOrders: {
    type: 'string',
    description: 'Lifetime order count as an unsigned integer string',
  },
  locale: { type: 'string', description: 'Customer locale' },
  taxExempt: { type: 'boolean', description: 'Whether the customer is tax exempt' },
  amountSpent: {
    type: 'object',
    description: 'Total amount spent by customer',
    properties: MONEY_PROPERTIES,
  },
  defaultAddress: {
    type: 'object',
    nullable: true,
    description: 'Customer default address',
    properties: ADDRESS_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/** Full customer fields returned by individual reads and customer mutations. */
export const CUSTOMER_OUTPUT_PROPERTIES = {
  ...CUSTOMER_SUMMARY_OUTPUT_PROPERTIES,
  addresses: {
    type: 'array',
    description: 'Customer addresses',
    items: {
      type: 'object',
      properties: ADDRESS_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Line item properties from Shopify LineItem GraphQL object */
const LINE_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Unique line item identifier (GID)' },
  title: { type: 'string', description: 'Product title' },
  quantity: { type: 'number', description: 'Quantity ordered' },
  variant: {
    type: 'object',
    nullable: true,
    description: 'Associated product variant',
    properties: VARIANT_PROPERTIES,
  },
  originalTotalSet: {
    optional: true,
    type: 'object',
    description: 'Original total price before discounts',
    properties: MONEY_BAG_PROPERTIES,
  },
  discountedTotalSet: {
    optional: true,
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
  email: { type: 'string', nullable: true, description: 'Customer email address' },
  firstName: { type: 'string', nullable: true, description: 'Customer first name' },
  lastName: { type: 'string', nullable: true, description: 'Customer last name' },
  phone: { type: 'string', nullable: true, description: 'Customer phone number', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Order output properties based on Shopify Order GraphQL object */
export const ORDER_OUTPUT_PROPERTIES = {
  poNumber: {
    type: 'string',
    nullable: true,
    optional: true,
    description: 'Purchase order number',
  },
  customAttributes: {
    type: 'array',
    optional: true,
    description: 'Order attributes',
    items: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Attribute key' },
        value: { type: 'string', nullable: true, description: 'Attribute value' },
      },
    },
  },
  id: { type: 'string', description: 'Unique order identifier (GID)' },
  name: { type: 'string', description: 'Order name (e.g., #1001)' },
  email: { type: 'string', nullable: true, description: 'Customer email for the order' },
  phone: { type: 'string', nullable: true, description: 'Customer phone for the order' },
  createdAt: { type: 'string', description: 'Order creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  cancelledAt: { type: 'string', nullable: true, description: 'Cancellation timestamp (ISO 8601)' },
  closedAt: { type: 'string', nullable: true, description: 'Closure timestamp (ISO 8601)' },
  displayFinancialStatus: {
    type: 'string',
    nullable: true,
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
    nullable: true,
    description: 'Order subtotal (before shipping and taxes)',
    properties: MONEY_BAG_PROPERTIES,
  },
  totalTaxSet: {
    type: 'object',
    nullable: true,
    description: 'Total tax amount',
    properties: MONEY_BAG_PROPERTIES,
    optional: true,
  },
  totalShippingPriceSet: {
    type: 'object',
    description: 'Total shipping price',
    properties: MONEY_BAG_PROPERTIES,
    optional: true,
  },
  note: { type: 'string', nullable: true, description: 'Order note' },
  tags: {
    type: 'array',
    description: 'Order tags',
    items: { type: 'string' },
  },
  customer: {
    type: 'object',
    nullable: true,
    description: 'Customer who placed the order',
    properties: ORDER_CUSTOMER_PROPERTIES,
  },
  lineItems: {
    optional: true,
    type: 'object',
    description: 'Order line items page; use Get Order with lineItemsAfter for subsequent pages',
    properties: {
      pageInfo: {
        type: 'object',
        description: 'Line item pagination',
        properties: PAGE_INFO_OUTPUT_PROPERTIES,
      },
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
    optional: true,
    type: 'object',
    nullable: true,
    description: 'Shipping address',
    properties: ADDRESS_PROPERTIES,
  },
  billingAddress: {
    optional: true,
    type: 'object',
    nullable: true,
    description: 'Billing address',
    properties: ADDRESS_PROPERTIES,
  },
  fulfillments: {
    type: 'array',
    description: 'Order fulfillments',
    items: {
      type: 'object',
      properties: FULFILLMENT_PROPERTIES,
    },
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Fulfillment output properties for create fulfillment response */
export const FULFILLMENT_OUTPUT_PROPERTIES = {
  lineItemsPageInfo: {
    type: 'object',
    description: 'Fulfillment item pagination; use Get Fulfillment for subsequent pages',
    properties: PAGE_INFO_OUTPUT_PROPERTIES,
  },
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
        quantity: { type: 'number', nullable: true, description: 'Quantity fulfilled' },
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

/** Selected Shopify LocationAddress fields for inventory locations. */
const LOCATION_ADDRESS_PROPERTIES = {
  address1: { type: 'string', nullable: true, description: 'Street address line 1' },
  address2: { type: 'string', nullable: true, description: 'Street address line 2' },
  city: { type: 'string', nullable: true, description: 'City' },
  province: { type: 'string', nullable: true, description: 'Province or state name' },
  provinceCode: { type: 'string', nullable: true, description: 'Province or state code' },
  country: { type: 'string', nullable: true, description: 'Country name' },
  countryCode: { type: 'string', nullable: true, description: 'Country code (ISO 3166-1 alpha-2)' },
  zip: { type: 'string', nullable: true, description: 'Postal or ZIP code' },
  phone: { type: 'string', nullable: true, description: 'Phone number' },
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
    properties: LOCATION_ADDRESS_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/** Collection output properties based on Shopify Collection GraphQL object */
export const COLLECTION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique collection identifier (GID)' },
  title: { type: 'string', description: 'Collection title' },
  handle: { type: 'string', description: 'URL-friendly collection identifier' },
  description: { type: 'string', description: 'Plain text description' },
  descriptionHtml: { type: 'string', description: 'HTML-formatted description' },
  productsCount: { type: 'number', description: 'Number of products in the collection' },
  sortOrder: { type: 'string', description: 'Product sort order in the collection' },
  updatedAt: { type: 'string', description: 'Last modification timestamp (ISO 8601)' },
  image: {
    type: 'object',
    nullable: true,
    description: 'Collection image',
    properties: IMAGE_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/** Collection with products output properties */
export const COLLECTION_WITH_PRODUCTS_OUTPUT_PROPERTIES = {
  ...COLLECTION_OUTPUT_PROPERTIES,
  productsPageInfo: {
    type: 'object',
    description: 'Pagination for collection products; use productsAfter',
    properties: PAGE_INFO_OUTPUT_PROPERTIES,
  },
  products: {
    type: 'array',
    description: 'Products in the collection',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique product identifier (GID)' },
        title: { type: 'string', description: 'Product title' },
        handle: { type: 'string', description: 'URL-friendly product identifier' },
        status: {
          type: 'string',
          description: 'Product status (ACTIVE, DRAFT, ARCHIVED, UNLISTED)',
        },
        vendor: { type: 'string', description: 'Product vendor' },
        productType: { type: 'string', description: 'Product type classification' },
        totalInventory: { type: 'number', description: 'Total inventory across all variants' },
        featuredImage: {
          type: 'object',
          nullable: true,
          description: 'Featured product image',
          properties: FEATURED_IMAGE_OUTPUT_PROPERTIES,
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Inventory level output properties based on Shopify InventoryLevel GraphQL object */
export const INVENTORY_LEVEL_OUTPUT_PROPERTIES = {
  pageInfo: {
    type: 'object',
    nullable: true,
    description: 'Location pagination when no locationId is supplied',
    properties: PAGE_INFO_OUTPUT_PROPERTIES,
  },
  id: { type: 'string', description: 'Inventory item identifier (GID)' },
  sku: { type: 'string', nullable: true, description: 'Stock keeping unit' },
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
      referenceDocumentUri: { type: 'string', nullable: true, description: 'Source document URI' },
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
        quantityAfterChange: {
          type: 'number',
          nullable: true,
          description: 'Quantity after adjustment, when available',
        },
        item: {
          type: 'object',
          nullable: true,
          description: 'Inventory item',
          properties: {
            id: { type: 'string', description: 'Inventory item identifier (GID)' },
            sku: { type: 'string', nullable: true, description: 'Stock keeping unit' },
          },
        },
        location: {
          type: 'object',
          nullable: true,
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
  sku: { type: 'string', nullable: true, description: 'Stock keeping unit' },
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
      },
    },
  },
  inventoryLevelsPageInfo: {
    type: 'object',
    description: 'Pagination for location summary; use Get Inventory Level for subsequent pages',
    properties: PAGE_INFO_OUTPUT_PROPERTIES,
  },
  inventoryLevels: {
    type: 'array',
    description: 'Inventory levels at different locations',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Inventory level identifier (GID)' },
        available: { type: 'number', description: 'Available quantity' },
        onHand: { type: 'number', description: 'On-hand quantity' },
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

/** Cancel order output properties */
export const CANCEL_ORDER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Job identifier for the cancellation' },
  cancelled: { type: 'boolean', description: 'Whether the cancellation completed' },
  message: { type: 'string', description: 'Status message' },
} as const satisfies Record<string, OutputProperty>

/** Cancellation status and errors; a completed job can still report an unsuccessful cancellation. */
export const CANCELLATION_RESULT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Cancellation result GID; pass to Get Job' },
  done: {
    type: 'boolean',
    description:
      'Whether the request has finished processing; inspect status and errors for the outcome',
  },
  status: { type: 'string', description: 'Current cancellation status' },
  errors: {
    type: 'array',
    description: 'Asynchronous cancellation errors',
    items: {
      type: 'object',
      properties: {
        field: {
          type: 'array',
          nullable: true,
          description: 'Input field path',
          items: { type: 'string' },
        },
        message: { type: 'string', description: 'Error message' },
        code: { type: 'string', nullable: true, description: 'Cancellation error code' },
      },
    },
  },
  order: {
    type: 'object',
    nullable: true,
    description: 'Associated order',
    properties: {
      id: { type: 'string', description: 'Order GID' },
      cancelledAt: {
        type: 'string',
        nullable: true,
        description: 'Cancellation timestamp, null until cancelled',
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Asynchronous cancellation result, including provider errors and the nullable associated order. */
export interface ShopifyCancellationResult {
  id: string
  done: boolean
  status: string
  errors: Array<ShopifyUserError & { code: string | null }>
  order: { id: string; cancelledAt: string | null } | null
}

interface ShopifyProduct {
  templateSuffix?: string | null
  requiresSellingPlan?: boolean
  category?: { id: string; fullName: string } | null
  seo?: { title: string | null; description: string | null }
  onlineStoreUrl?: string | null
  options?: Array<{ id: string; name: string; position: number; values: string[] }>
  id: string
  title: string
  handle: string
  descriptionHtml: string
  vendor: string
  productType: string
  tags: string[]
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | 'UNLISTED'
  createdAt: string
  updatedAt: string
  variants: {
    pageInfo: ShopifyPageInfo
    edges: Array<{
      node: ShopifyVariant
    }>
  }
  images: {
    pageInfo: ShopifyPageInfo
    edges: Array<{
      node: ShopifyImage
    }>
  }
}

interface ShopifyVariant {
  barcode?: string | null
  taxable?: boolean
  inventoryPolicy?: string
  inventoryItem?: { id: string; sku: string | null; tracked: boolean }
  selectedOptions?: Array<{ name: string; value: string }>
  id: string
  title: string
  price: string
  compareAtPrice?: string | null
  sku: string | null
  inventoryQuantity?: number | null
}

interface ShopifyImage {
  id: string | null
  url: string
  altText: string | null
}

interface ShopifyOrder {
  poNumber?: string | null
  customAttributes?: Array<{ key: string; value: string | null }>
  id: string
  name: string
  email: string | null
  phone: string | null
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  closedAt: string | null
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string
  totalPriceSet: ShopifyMoneyBag
  subtotalPriceSet: ShopifyMoneyBag | null
  totalTaxSet?: ShopifyMoneyBag | null
  totalShippingPriceSet?: ShopifyMoneyBag
  note: string | null
  tags: string[]
  customer:
    | (Pick<ShopifyCustomer, 'id' | 'email' | 'firstName' | 'lastName'> &
        Partial<Pick<ShopifyCustomer, 'phone'>>)
    | null
  lineItems?: {
    pageInfo: ShopifyPageInfo
    edges: Array<{
      node: ShopifyLineItem
    }>
  }
  shippingAddress?: ShopifyAddress | null
  billingAddress?: ShopifyAddress | null
  fulfillments?: ShopifyFulfillment[]
}

interface ShopifyMoneyBag {
  shopMoney: {
    amount: string
    currencyCode: string
  }
  presentmentMoney?: {
    amount: string
    currencyCode: string
  }
}

interface ShopifyLineItem {
  id: string
  title: string
  quantity: number
  variant: ShopifyVariant | null
  originalTotalSet?: ShopifyMoneyBag
  discountedTotalSet?: ShopifyMoneyBag
}

interface ShopifyAddress {
  firstName: string | null
  lastName: string | null
  address1?: string | null
  address2?: string | null
  city: string | null
  province: string | null
  provinceCode?: string | null
  country: string | null
  countryCode?: string | null
  zip: string | null
  phone?: string | null
}

interface ShopifyCustomer {
  emailMarketingConsent: {
    marketingState: string
    marketingOptInLevel: string | null
    consentUpdatedAt: string | null
  } | null
  smsMarketingConsent: {
    marketingState: string
    marketingOptInLevel: string
    consentUpdatedAt: string | null
  } | null
  numberOfOrders: string
  locale: string
  taxExempt: boolean
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

interface ShopifyFulfillment {
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

interface ShopifyInventoryLevel {
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

interface ShopifyBaseParams {
  accessToken: string
  shopDomain?: string
  /** Store domain resolved from a service-account credential */
  domain?: string
  /** Store domain resolved from the connected OAuth credential */
  idToken?: string
}

export interface ShopifyCreateProductParams extends ShopifyBaseParams {
  handle?: string
  seo?: Record<string, unknown> | string
  category?: string
  templateSuffix?: string
  metafields?: Array<Record<string, unknown>> | string
  collectionsToJoin?: string[] | string
  requiresSellingPlan?: boolean
  productOptions?: Array<Record<string, unknown>> | string
  media?: Array<Record<string, unknown>> | string

  title: string
  descriptionHtml?: string
  vendor?: string
  productType?: string
  tags?: string[]
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | 'UNLISTED'
}

export interface ShopifyGetProductParams extends ShopifyBaseParams {
  variantsFirst?: number
  variantsAfter?: string
  imagesFirst?: number
  imagesAfter?: string

  productId: string
}

export interface ShopifyListProductsParams extends ShopifyBaseParams {
  includeDetails?: boolean
  reverse?: boolean
  sortKey?:
    | 'CREATED_AT'
    | 'ID'
    | 'INVENTORY_TOTAL'
    | 'PRODUCT_TYPE'
    | 'PUBLISHED_AT'
    | 'RELEVANCE'
    | 'TITLE'
    | 'UPDATED_AT'
    | 'VENDOR'

  first?: number
  after?: string
  query?: string
}

export interface ShopifyUpdateProductParams extends ShopifyBaseParams {
  handle?: string
  seo?: Record<string, unknown> | string
  category?: string
  templateSuffix?: string
  metafields?: Array<Record<string, unknown>> | string
  collectionsToJoin?: string[] | string
  requiresSellingPlan?: boolean
  collectionsToLeave?: string[] | string
  redirectNewHandle?: boolean
  media?: Array<Record<string, unknown>> | string

  productId: string
  title?: string
  descriptionHtml?: string
  vendor?: string
  productType?: string
  tags?: string[]
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | 'UNLISTED'
}

export interface ShopifyDeleteProductParams extends ShopifyBaseParams {
  productId: string
}

export interface ShopifyGetOrderParams extends ShopifyBaseParams {
  lineItemsFirst?: number
  lineItemsAfter?: string

  orderId: string
}

export interface ShopifyListOrdersParams extends ShopifyBaseParams {
  includeDetails?: boolean
  reverse?: boolean
  sortKey?:
    | 'CREATED_AT'
    | 'CURRENT_TOTAL_PRICE'
    | 'CUSTOMER_NAME'
    | 'DESTINATION'
    | 'FINANCIAL_STATUS'
    | 'FULFILLMENT_STATUS'
    | 'ID'
    | 'ORDER_NUMBER'
    | 'PO_NUMBER'
    | 'PROCESSED_AT'
    | 'RELEVANCE'
    | 'TOTAL_ITEMS_QUANTITY'
    | 'TOTAL_PRICE'
    | 'UPDATED_AT'

  first?: number
  after?: string
  status?: string
  query?: string
}

export interface ShopifyUpdateOrderParams extends ShopifyBaseParams {
  includeDetails?: boolean
  phone?: string
  shippingAddress?: Record<string, unknown> | string
  customAttributes?: Array<Record<string, unknown>> | string
  metafields?: Array<Record<string, unknown>> | string
  poNumber?: string

  orderId: string
  note?: string
  tags?: string[]
  email?: string
}

export interface ShopifyCancelOrderParams extends ShopifyBaseParams {
  orderId: string
  reason: 'CUSTOMER' | 'DECLINED' | 'FRAUD' | 'INVENTORY' | 'OTHER' | 'STAFF'
  restock: boolean
  notifyCustomer?: boolean
  refundMethod?: Record<string, unknown> | string
  staffNote?: string
}

export interface ShopifyCreateCustomerParams extends ShopifyBaseParams {
  locale?: string
  taxExempt?: boolean
  metafields?: Array<Record<string, unknown>> | string
  emailMarketingConsent?: Record<string, unknown> | string
  smsMarketingConsent?: Record<string, unknown> | string

  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  note?: string
  tags?: string[]
  addresses?:
    | string
    | Array<{
        firstName?: string
        lastName?: string
        company?: string
        countryCode?: string
        provinceCode?: string
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
  reverse?: boolean
  sortKey?: 'CREATED_AT' | 'ID' | 'LOCATION' | 'NAME' | 'RELEVANCE' | 'UPDATED_AT'

  first?: number
  after?: string
  query?: string
}

export interface ShopifyUpdateCustomerParams extends ShopifyBaseParams {
  addresses?: Array<Record<string, unknown>> | string
  locale?: string
  taxExempt?: boolean
  metafields?: Array<Record<string, unknown>> | string
  emailMarketingConsent?: Record<string, unknown> | string
  smsMarketingConsent?: Record<string, unknown> | string

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

export interface ShopifyGetInventoryLevelParams extends ShopifyBaseParams {
  first?: number
  after?: string
  inventoryItemId: string
  locationId?: string
}

export interface ShopifyAdjustInventoryParams extends ShopifyBaseParams {
  idempotencyKey?: string
  reason?: string
  name?: string
  referenceDocumentUri?: string
  changeFromQuantity?: number | null
  ledgerDocumentUri?: string

  inventoryItemId: string
  locationId: string
  delta: number
}

export interface ShopifyCreateFulfillmentParams extends ShopifyBaseParams {
  fulfillmentOrderLineItems?: Array<Record<string, unknown>> | string
  message?: string
  originAddress?: Record<string, unknown> | string
  trackingNumbers?: string[] | string
  trackingUrls?: string[] | string

  fulfillmentOrderId: string
  trackingNumber?: string
  trackingCompany?: string
  trackingUrl?: string
  notifyCustomer?: boolean
}

export interface ShopifyListInventoryItemsParams extends ShopifyBaseParams {
  reverse?: boolean

  first?: number
  after?: string
  query?: string
}

export interface ShopifyListLocationsParams extends ShopifyBaseParams {
  reverse?: boolean
  sortKey?: 'ID' | 'NAME' | 'RELEVANCE'
  query?: string
  includeLegacy?: boolean

  first?: number
  after?: string
  includeInactive?: boolean
}

export interface ShopifyListCollectionsParams extends ShopifyBaseParams {
  reverse?: boolean
  sortKey?: 'ID' | 'RELEVANCE' | 'TITLE' | 'UPDATED_AT'

  first?: number
  after?: string
  query?: string
}

export interface ShopifyGetCollectionParams extends ShopifyBaseParams {
  productsAfter?: string

  collectionId: string
  productsFirst?: number
}

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
      startCursor: string | null
      endCursor: string | null
    }
  }
}

export interface ShopifyOrderResponse extends ToolResponse {
  output: {
    order?: ShopifyOrder | Record<string, unknown>
  }
}

export interface ShopifyCancelOrderResponse extends ToolResponse {
  output: {
    jobResult?: ShopifyCancellationResult | null
    job?: { id: string; done: boolean }
    order?: {
      id: string
      cancelled: boolean
      message: string
    }
  }
}

export interface ShopifyOrdersResponse extends ToolResponse {
  output: {
    orders?: ShopifyOrder[]
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
      startCursor: string | null
      endCursor: string | null
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
    customers?: Omit<ShopifyCustomer, 'addresses'>[]
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
      startCursor: string | null
      endCursor: string | null
    }
  }
}

export interface ShopifyInventoryResponse extends ToolResponse {
  output: {
    inventoryLevel?: {
      id: string
      sku: string | null
      tracked: boolean
      levels: ShopifyInventoryLevel[]
      pageInfo: ShopifyPageInfo | null
    }
  }
}

export interface ShopifyInventoryAdjustmentResponse extends ToolResponse {
  output: {
    inventoryLevel?: {
      adjustmentGroup: {
        createdAt: string
        reason: string
        referenceDocumentUri: string | null
      }
      changes: Array<{
        name: string
        delta: number
        quantityAfterChange: number | null
        item: {
          id: string
          sku: string | null
        } | null
        location: {
          id: string
          name: string
        } | null
      }>
    }
  }
}

export interface ShopifyFulfillmentResponse extends ToolResponse {
  output: {
    fulfillment?: ShopifyFulfillment & {
      lineItemsPageInfo: ShopifyPageInfo
      fulfillmentLineItems: Array<{
        id: string
        quantity: number | null
        lineItem: {
          title: string
        }
      }>
    }
  }
}

export interface ShopifyInventoryItemsResponse extends ToolResponse {
  output: {
    inventoryItems?: Array<{
      id: string
      sku: string | null
      tracked: boolean
      createdAt: string
      updatedAt: string
      variant: {
        id: string
        title: string
        product: {
          id: string
          title: string
        }
      }
      inventoryLevelsPageInfo: ShopifyPageInfo
      inventoryLevels: Array<{
        id: string
        available: number
        onHand: number
        location: {
          id: string
          name: string
        }
      }>
    }>
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
      startCursor: string | null
      endCursor: string | null
    }
  }
}

export interface ShopifyLocationsResponse extends ToolResponse {
  output: {
    locations?: Array<{
      id: string
      name: string
      isActive: boolean
      fulfillsOnlineOrders: boolean
      address: {
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
    }>
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
      startCursor: string | null
      endCursor: string | null
    }
  }
}

export interface ShopifyCollectionsResponse extends ToolResponse {
  output: {
    collections?: Array<{
      id: string
      title: string
      handle: string
      description: string
      descriptionHtml: string
      productsCount: number
      sortOrder: string
      updatedAt: string
      image: {
        id: string | null
        url: string
        altText: string | null
      } | null
    }>
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
      startCursor: string | null
      endCursor: string | null
    }
  }
}

export interface ShopifyCollectionResponse extends ToolResponse {
  output: {
    collection?: {
      id: string
      title: string
      handle: string
      description: string
      descriptionHtml: string
      productsCount: number
      sortOrder: string
      updatedAt: string
      image: {
        id: string | null
        url: string
        altText: string | null
      } | null
      productsPageInfo: ShopifyPageInfo
      products: Array<{
        id: string
        title: string
        handle: string
        status: string
        vendor: string
        productType: string
        totalInventory: number
        featuredImage: {
          url: string
          altText: string | null
        } | null
      }>
    }
  }
}

export interface ShopifyDeleteResponse extends ToolResponse {
  output: {
    deletedId?: string
  }
}

/** Connection cursors and navigation flags; cursors are null when a page contains no edges. */
export interface ShopifyPageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string | null
  endCursor: string | null
}

/** Shopify validation error, with a null field path when the error is not tied to an input field. */
export interface ShopifyUserError {
  field: string[] | null
  message: string
}

/** Accepts either a legacy Job GID or an OrderCancelJobResult GID for polling. */
export interface ShopifyGetJobParams extends ShopifyBaseParams {
  jobId: string
}

/** Polling output containing the legacy job or the richer cancellation result for the requested GID. */
export interface ShopifyJobResponse extends ToolResponse {
  output: { job?: { id: string; done: boolean }; jobResult?: ShopifyCancellationResult }
}

/** Order identifier and cursor controls for listing its fulfillment assignments. */
export interface ShopifyListFulfillmentOrdersParams extends ShopifyBaseParams {
  orderId: string
  first?: number
  after?: string
}

/** Fulfillment assignment identifier and cursor controls for its line items. */
export interface ShopifyGetFulfillmentOrderParams extends ShopifyBaseParams {
  fulfillmentOrderId: string
  first?: number
  after?: string
}

/** Assigned fulfillment work with remaining quantities, supported actions, and a page of line items. */
export interface ShopifyFulfillmentOrder {
  id: string
  orderId: string
  status: string
  requestStatus: string
  createdAt: string
  updatedAt: string
  fulfillAt: string | null
  fulfillBy: string | null
  assignedLocation: { name: string; location: { id: string; name: string } | null }
  supportedActions: Array<{ action: string; externalUrl: string | null }>
  lineItems: {
    edges: Array<{
      node: {
        id: string
        totalQuantity: number
        remainingQuantity: number
        inventoryItemId: string | null
        productTitle: string
        variantTitle: string | null
        sku: string | null
        lineItem: { id: string }
      }
    }>
    pageInfo: ShopifyPageInfo
  }
}

/** A page of fulfillment assignments and cursors for retrieving the next page. */
export interface ShopifyFulfillmentOrdersResponse extends ToolResponse {
  output: { fulfillmentOrders?: ShopifyFulfillmentOrder[]; pageInfo?: ShopifyPageInfo }
}

/** One fulfillment assignment, including cursors for continuing its line-item connection. */
export interface ShopifyFulfillmentOrderResponse extends ToolResponse {
  output: { fulfillmentOrder?: ShopifyFulfillmentOrder }
}

/** Variants and optional media to create for one product, with standalone-variant handling. */
export interface ShopifyCreateProductVariantsParams extends ShopifyBaseParams {
  productId: string
  variants: Array<Record<string, unknown>> | string
  strategy?: 'DEFAULT' | 'REMOVE_STANDALONE_VARIANT' | 'PRESERVE_STANDALONE_VARIANT'
  media?: Array<Record<string, unknown>> | string
}

/** Variant updates for one product, optionally retaining valid updates when others fail. */
export interface ShopifyUpdateProductVariantsParams extends ShopifyBaseParams {
  productId: string
  variants: Array<Record<string, unknown>> | string
  allowPartialUpdates?: boolean
  media?: Array<Record<string, unknown>> | string
}

/** Returned variants and provider validation errors, including partial-update results. */
export interface ShopifyProductVariantsResponse extends ToolResponse {
  output: { productVariants?: Required<ShopifyVariant>[]; userErrors?: ShopifyUserError[] }
}

/** Fulfillment identifier and cursor controls for reading its fulfilled line items. */
export interface ShopifyGetFulfillmentParams extends ShopifyBaseParams {
  fulfillmentId: string
  first?: number
  after?: string
}

/** Tracking details for a fulfillment and an optional customer-notification flag. */
export interface ShopifyUpdateFulfillmentTrackingParams extends ShopifyBaseParams {
  fulfillmentId: string
  trackingInfo:
    | { company?: string; number?: string; url?: string; numbers?: string[]; urls?: string[] }
    | string
  notifyCustomer?: boolean
}

/** Fulfillment assignment fields with line-item cursors for subsequent reads and partial fulfillment. */
export const FULFILLMENT_ORDER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Fulfillment order GID to pass to Create Fulfillment' },
  orderId: { type: 'string', description: 'Associated order GID' },
  status: { type: 'string', description: 'Fulfillment order status' },
  requestStatus: { type: 'string', description: 'Fulfillment request status' },
  createdAt: { type: 'string', description: 'Creation timestamp' },
  updatedAt: { type: 'string', description: 'Last update timestamp' },
  fulfillAt: { type: 'string', nullable: true, description: 'Earliest fulfillment timestamp' },
  fulfillBy: { type: 'string', nullable: true, description: 'Fulfillment deadline' },
  assignedLocation: {
    type: 'object',
    description: 'Assigned fulfillment location',
    properties: {
      name: { type: 'string', description: 'Assigned location name' },
      location: {
        type: 'object',
        nullable: true,
        description: 'Current location',
        properties: {
          id: { type: 'string', description: 'Location GID' },
          name: { type: 'string', description: 'Location name' },
        },
      },
    },
  },
  supportedActions: {
    type: 'array',
    description: 'Actions permitted for this fulfillment order',
    items: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Permitted action' },
        externalUrl: {
          type: 'string',
          nullable: true,
          description: 'External fulfillment URL when applicable',
        },
      },
    },
  },
  lineItems: {
    type: 'object',
    description: 'Fulfillment order item page; use Get Fulfillment Order to continue',
    properties: {
      pageInfo: {
        type: 'object',
        description: 'Line item pagination',
        properties: PAGE_INFO_OUTPUT_PROPERTIES,
      },
      edges: {
        type: 'array',
        description: 'Fulfillment order item edges',
        items: {
          type: 'object',
          properties: {
            node: {
              type: 'object',
              description: 'Fulfillment order line item',
              properties: {
                id: {
                  type: 'string',
                  description: 'Fulfillment order line item GID for partial fulfillment',
                },
                totalQuantity: { type: 'number', description: 'Total quantity assigned' },
                remainingQuantity: { type: 'number', description: 'Quantity still to fulfill' },
                inventoryItemId: {
                  type: 'string',
                  nullable: true,
                  description: 'Inventory item GID',
                },
                productTitle: { type: 'string', description: 'Product title' },
                variantTitle: { type: 'string', nullable: true, description: 'Variant title' },
                sku: { type: 'string', nullable: true, description: 'SKU' },
                lineItem: {
                  type: 'object',
                  description: 'Original order line item',
                  properties: { id: { type: 'string', description: 'Order line item GID' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>
