import { ShopifyIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'

const LIST_OPERATIONS = [
  'shopify_list_products',
  'shopify_list_orders',
  'shopify_list_customers',
  'shopify_list_inventory_items',
  'shopify_list_locations',
  'shopify_list_collections',
  'shopify_list_fulfillment_orders',
  'shopify_get_fulfillment_order',
  'shopify_get_fulfillment',
  'shopify_get_inventory_level',
] as const

export const ShopifyBlock: BlockConfig = {
  type: 'shopify',
  name: 'Shopify',
  description: 'Manage products, orders, customers, and inventory in your Shopify store',
  authMode: AuthMode.OAuth,
  longDescription:
    'Manage Shopify products and variants, orders, customers, inventory, collections, and merchant-managed fulfillment using Admin GraphQL API 2026-10. Discover fulfillment orders, ship selected items, update tracking, and check cancellation jobs. Continue list and nested results with the returned cursors. Product activation does not publish to sales channels. Orders normally cover the last 60 days; older orders and protected customer fields require Shopify approval and access. Expanded list details are optional and use smaller pages to stay within query-cost limits.',
  docsLink: 'https://docs.sim.ai/integrations/shopify',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  icon: ShopifyIcon,
  bgColor: '#FFFFFF',
  canvasPresentation: {
    defaultTitle: 'Shopify',
    sentences: {
      byOperation: {
        shopify_update_fulfillment_tracking: [
          { text: 'Update tracking for fulfillment', field: 'fulfillmentId', core: true },
        ],
        shopify_get_fulfillment: [{ text: 'Read shipment', field: 'fulfillmentId', core: true }],
        shopify_update_product_variants: [
          { text: 'Update variants of product', field: 'productId', core: true },
        ],
        shopify_create_product_variants: [
          { text: 'Create variants for product', field: 'productId', core: true },
        ],
        shopify_get_job: [{ text: 'Check job', field: 'jobId', core: true }],
        shopify_get_fulfillment_order: [
          { text: 'Read fulfillment order', field: 'fulfillmentOrderId', core: true },
        ],
        shopify_list_fulfillment_orders: [
          { text: 'List fulfillment orders for', field: 'orderId', core: true },
        ],
        shopify_create_product: [
          { text: 'Create product', field: 'title', core: true },
          { text: ', of type', field: 'productType' },
          { text: ', as', field: 'status' },
        ],
        shopify_get_product: [{ text: 'Fetch product', field: 'productId', core: true }],
        shopify_list_products: [
          'List products',
          { text: ', matching', field: 'productQuery' },
          { text: ', up to', field: 'first', after: 'results' },
        ],
        shopify_update_product: [
          { text: 'Update product', field: 'productId', core: true },
          { text: ', renaming to', field: 'title' },
          { text: ', setting status to', field: 'status' },
        ],
        shopify_delete_product: [{ text: 'Delete product', field: 'productId', core: true }],
        shopify_get_order: [{ text: 'Fetch order', field: 'orderId', core: true }],
        shopify_list_orders: [
          'List orders',
          { text: ', matching', field: 'orderQuery' },
          { text: ', up to', field: 'first', after: 'results' },
        ],
        shopify_update_order: [
          { text: 'Update order', field: 'orderId', core: true },
          { text: ', setting email to', field: 'orderEmail' },
          { text: ', with note', field: 'orderNote' },
        ],
        shopify_cancel_order: [
          { text: 'Cancel order', field: 'orderId', core: true },
          { text: ', citing', field: 'cancelReason' },
        ],
        shopify_create_customer: [
          'Create a customer',
          { text: 'named', field: 'firstName' },
          { text: 'with email', field: 'customerEmail' },
        ],
        shopify_get_customer: [{ text: 'Fetch customer', field: 'customerId', core: true }],
        shopify_list_customers: [
          'List customers',
          { text: ', matching', field: 'customerQuery' },
          { text: ', up to', field: 'first', after: 'results' },
        ],
        shopify_update_customer: [
          { text: 'Update customer', field: 'customerId', core: true },
          { text: ', setting email to', field: 'customerEmail' },
          { text: ', with phone', field: 'phone' },
        ],
        shopify_delete_customer: [{ text: 'Delete customer', field: 'customerId', core: true }],
        shopify_list_inventory_items: [
          'List inventory items',
          { text: ', matching', field: 'inventoryQuery' },
          { text: ', up to', field: 'first', after: 'results' },
        ],
        shopify_get_inventory_level: [
          { text: 'Read the inventory level of item', field: 'inventoryItemId', core: true },
          { text: 'at location', field: 'locationId' },
        ],
        shopify_adjust_inventory: [
          { text: 'Adjust inventory of item', field: 'inventoryItemId', core: true },
          { text: 'by', field: 'delta' },
          { text: 'at location', field: 'locationId' },
        ],
        shopify_list_locations: [
          'List inventory locations',
          { text: ', up to', field: 'first', after: 'results' },
        ],
        shopify_create_fulfillment: [
          {
            text: 'Mark fulfillment order',
            field: 'fulfillmentOrderId',
            after: 'as shipped',
            core: true,
          },
          { text: ', via', field: 'trackingCompany' },
          { text: ', tracking', field: 'trackingNumber' },
        ],
        shopify_list_collections: [
          'List collections',
          { text: ', matching', field: 'collectionQuery' },
          { text: ', up to', field: 'first', after: 'results' },
        ],
        shopify_get_collection: [
          { text: 'Fetch collection', field: 'collectionId', core: true },
          { text: ', with up to', field: 'productsFirst', after: 'products' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'productsSortKey',
      title: 'Sort By',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Shopify default', id: '' },
        { label: 'Created At', id: 'CREATED_AT' },
        { label: 'Id', id: 'ID' },
        { label: 'Inventory Total', id: 'INVENTORY_TOTAL' },
        { label: 'Product Type', id: 'PRODUCT_TYPE' },
        { label: 'Published At', id: 'PUBLISHED_AT' },
        { label: 'Relevance', id: 'RELEVANCE' },
        { label: 'Title', id: 'TITLE' },
        { label: 'Updated At', id: 'UPDATED_AT' },
        { label: 'Vendor', id: 'VENDOR' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'shopify_list_products' },
    },
    {
      id: 'ordersSortKey',
      title: 'Sort By',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Shopify default', id: '' },
        { label: 'Created At', id: 'CREATED_AT' },
        { label: 'Current Total Price', id: 'CURRENT_TOTAL_PRICE' },
        { label: 'Customer Name', id: 'CUSTOMER_NAME' },
        { label: 'Destination', id: 'DESTINATION' },
        { label: 'Financial Status', id: 'FINANCIAL_STATUS' },
        { label: 'Fulfillment Status', id: 'FULFILLMENT_STATUS' },
        { label: 'Id', id: 'ID' },
        { label: 'Order Number', id: 'ORDER_NUMBER' },
        { label: 'Po Number', id: 'PO_NUMBER' },
        { label: 'Processed At', id: 'PROCESSED_AT' },
        { label: 'Relevance', id: 'RELEVANCE' },
        { label: 'Total Items Quantity', id: 'TOTAL_ITEMS_QUANTITY' },
        { label: 'Total Price', id: 'TOTAL_PRICE' },
        { label: 'Updated At', id: 'UPDATED_AT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'shopify_list_orders' },
    },
    {
      id: 'customersSortKey',
      title: 'Sort By',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Shopify default', id: '' },
        { label: 'Created At', id: 'CREATED_AT' },
        { label: 'Id', id: 'ID' },
        { label: 'Location', id: 'LOCATION' },
        { label: 'Name', id: 'NAME' },
        { label: 'Relevance', id: 'RELEVANCE' },
        { label: 'Updated At', id: 'UPDATED_AT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'shopify_list_customers' },
    },
    {
      id: 'collectionsSortKey',
      title: 'Sort By',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Shopify default', id: '' },
        { label: 'Id', id: 'ID' },
        { label: 'Relevance', id: 'RELEVANCE' },
        { label: 'Title', id: 'TITLE' },
        { label: 'Updated At', id: 'UPDATED_AT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'shopify_list_collections' },
    },
    {
      id: 'locationsSortKey',
      title: 'Sort By',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Shopify default', id: '' },
        { label: 'Id', id: 'ID' },
        { label: 'Name', id: 'NAME' },
        { label: 'Relevance', id: 'RELEVANCE' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'shopify_list_locations' },
    },
    {
      id: 'reverse',
      title: 'Reverse Sort Order',
      type: 'switch',
      defaultValue: false,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'shopify_list_products',
          'shopify_list_orders',
          'shopify_list_customers',
          'shopify_list_collections',
          'shopify_list_locations',
          'shopify_list_inventory_items',
        ],
      },
    },
    {
      id: 'includeLegacy',
      title: 'Include Legacy Locations',
      type: 'switch',
      defaultValue: false,
      mode: 'advanced',
      condition: { field: 'operation', value: 'shopify_list_locations' },
    },
    {
      id: 'locationQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'name:Warehouse',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Shopify location search query using name:Warehouse or active:true. Return ONLY the Shopify search query.',
        placeholder: 'Describe the locations to find',
      },
      condition: { field: 'operation', value: 'shopify_list_locations' },
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Product', id: 'shopify_create_product' },
        { label: 'Get Product', id: 'shopify_get_product' },
        { label: 'List Products', id: 'shopify_list_products' },
        { label: 'Update Product', id: 'shopify_update_product' },
        { label: 'Delete Product', id: 'shopify_delete_product' },
        { label: 'Get Order', id: 'shopify_get_order' },
        { label: 'List Orders', id: 'shopify_list_orders' },
        { label: 'Update Order', id: 'shopify_update_order' },
        { label: 'Cancel Order', id: 'shopify_cancel_order' },
        { label: 'Create Customer', id: 'shopify_create_customer' },
        { label: 'Get Customer', id: 'shopify_get_customer' },
        { label: 'List Customers', id: 'shopify_list_customers' },
        { label: 'Update Customer', id: 'shopify_update_customer' },
        { label: 'Delete Customer', id: 'shopify_delete_customer' },
        { label: 'List Inventory Items', id: 'shopify_list_inventory_items' },
        { label: 'Get Inventory Level', id: 'shopify_get_inventory_level' },
        { label: 'Adjust Inventory', id: 'shopify_adjust_inventory' },
        { label: 'List Locations', id: 'shopify_list_locations' },
        { label: 'Create Fulfillment', id: 'shopify_create_fulfillment' },
        { label: 'List Collections', id: 'shopify_list_collections' },
        { label: 'List Fulfillment Orders', id: 'shopify_list_fulfillment_orders' },
        { label: 'Get Fulfillment Order', id: 'shopify_get_fulfillment_order' },
        { label: 'Get Job', id: 'shopify_get_job' },
        { label: 'Create Product Variants', id: 'shopify_create_product_variants' },
        { label: 'Update Product Variants', id: 'shopify_update_product_variants' },
        { label: 'Get Fulfillment', id: 'shopify_get_fulfillment' },
        { label: 'Update Fulfillment Tracking', id: 'shopify_update_fulfillment_tracking' },
        { label: 'Get Collection', id: 'shopify_get_collection' },
      ],
      value: () => 'shopify_list_products',
    },
    {
      id: 'credential',
      title: 'Shopify Account',
      type: 'oauth-input',
      serviceId: 'shopify',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('shopify'),
      placeholder: 'Select Shopify account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Shopify Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'shopDomain',
      title: 'Shop Domain',
      type: 'short-input',
      placeholder: 'Auto-detected from OAuth or enter manually',
      hidden: true,
    },
    {
      id: 'productId',
      title: 'Product ID',
      type: 'short-input',
      placeholder: 'gid://shopify/Product/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'shopify_get_product',
          'shopify_update_product',
          'shopify_delete_product',
          'shopify_create_product_variants',
          'shopify_update_product_variants',
        ],
      },
    },
    {
      id: 'title',
      title: 'Product Title',
      type: 'short-input',
      placeholder: 'Enter product title',
      required: {
        field: 'operation',
        value: ['shopify_create_product'],
      },
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'descriptionHtml',
      title: 'Description (HTML)',
      type: 'long-input',
      placeholder: 'Enter product description',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'productType',
      title: 'Product Type',
      type: 'short-input',
      placeholder: 'e.g., Shoes, Electronics',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'vendor',
      title: 'Vendor',
      type: 'short-input',
      placeholder: 'Enter vendor name',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2, tag3 (comma-separated)',
      wandConfig: {
        enabled: true,
        prompt: 'Generate relevant Shopify tags. Return ONLY the comma-separated list.',
        placeholder: 'Describe the filter or tags',
      },
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Active', id: 'ACTIVE' },
        { label: 'Draft', id: 'DRAFT' },
        { label: 'Archived', id: 'ARCHIVED' },
        { label: 'Unlisted', id: 'UNLISTED' },
        { label: 'Use default / keep unchanged', id: '' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'productQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter products (optional)',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Shopify search query using field:value filters such as title:shirt or created_at:>2026-01-01. Return ONLY the Shopify search query.',
        placeholder: 'Describe the filter or tags',
      },
      condition: {
        field: 'operation',
        value: ['shopify_list_products'],
      },
    },
    {
      id: 'customerQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., first_name:John OR email:*@gmail.com',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Shopify search query using field:value filters such as title:shirt or created_at:>2026-01-01. Return ONLY the Shopify search query.',
        placeholder: 'Describe the filter or tags',
      },
      condition: {
        field: 'operation',
        value: ['shopify_list_customers'],
      },
    },
    {
      id: 'inventoryQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., sku:ABC123',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Shopify search query using field:value filters such as title:shirt or created_at:>2026-01-01. Return ONLY the Shopify search query.',
        placeholder: 'Describe the filter or tags',
      },
      condition: {
        field: 'operation',
        value: ['shopify_list_inventory_items'],
      },
    },
    {
      id: 'includeDetails',
      title: 'Include Expanded Details',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_list_products', 'shopify_list_orders'] },
    },
    {
      id: 'first',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Default 50, max 250; expanded products 20/orders 10; fulfillment orders 20',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [...LIST_OPERATIONS],
      },
    },
    {
      id: 'orderId',
      title: 'Order ID',
      type: 'short-input',
      placeholder: 'gid://shopify/Order/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'shopify_get_order',
          'shopify_update_order',
          'shopify_cancel_order',
          'shopify_list_fulfillment_orders',
        ],
      },
    },
    {
      id: 'orderStatus',
      title: 'Order Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
        { label: 'Cancelled', id: 'cancelled' },
      ],
      value: () => 'any',
      condition: {
        field: 'operation',
        value: ['shopify_list_orders'],
      },
    },
    {
      id: 'orderQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., financial_status:paid OR email:customer@example.com',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Shopify search query using field:value filters such as title:shirt or created_at:>2026-01-01. Return ONLY the Shopify search query.',
        placeholder: 'Describe the filter or tags',
      },
      condition: {
        field: 'operation',
        value: ['shopify_list_orders'],
      },
    },
    {
      id: 'orderNote',
      title: 'Order Note',
      type: 'long-input',
      placeholder: 'Enter order note',
      condition: {
        field: 'operation',
        value: ['shopify_update_order'],
      },
    },
    {
      id: 'orderEmail',
      title: 'Customer Email',
      type: 'short-input',
      placeholder: 'customer@example.com',
      condition: {
        field: 'operation',
        value: ['shopify_update_order'],
      },
    },
    {
      id: 'orderTags',
      title: 'Order Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2, tag3 (comma-separated)',
      wandConfig: {
        enabled: true,
        prompt: 'Generate relevant Shopify tags. Return ONLY the comma-separated list.',
        placeholder: 'Describe the filter or tags',
      },
      condition: {
        field: 'operation',
        value: ['shopify_update_order'],
      },
    },
    {
      id: 'cancelReason',
      title: 'Cancel Reason',
      type: 'dropdown',
      options: [
        { label: 'Customer Request', id: 'CUSTOMER' },
        { label: 'Declined Payment', id: 'DECLINED' },
        { label: 'Fraud', id: 'FRAUD' },
        { label: 'Inventory Issue', id: 'INVENTORY' },
        { label: 'Staff Error', id: 'STAFF' },
        { label: 'Other', id: 'OTHER' },
      ],
      value: () => 'OTHER',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_cancel_order'],
      },
    },
    {
      id: 'staffNote',
      title: 'Staff Note',
      type: 'long-input',
      placeholder: 'Internal note about this cancellation',
      condition: {
        field: 'operation',
        value: ['shopify_cancel_order'],
      },
    },
    {
      id: 'restock',
      title: 'Restock Inventory',
      type: 'switch',
      defaultValue: false,
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_cancel_order'],
      },
    },
    {
      id: 'cancelNotifyCustomer',
      title: 'Notify Customer',
      type: 'switch',
      defaultValue: false,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_cancel_order'],
      },
    },
    {
      id: 'refundOriginalPayment',
      title: 'Refund to Original Payment Method',
      type: 'switch',
      defaultValue: false,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_cancel_order'],
      },
    },
    {
      id: 'customerId',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'gid://shopify/Customer/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_get_customer', 'shopify_update_customer', 'shopify_delete_customer'],
      },
    },
    {
      id: 'customerEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'customer@example.com',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Enter first name',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Enter last name',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: '+1234567890',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    {
      id: 'customerNote',
      title: 'Customer Note',
      type: 'long-input',
      placeholder: 'Enter note about customer',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    {
      id: 'customerTags',
      title: 'Customer Tags',
      type: 'short-input',
      placeholder: 'vip, wholesale (comma-separated)',
      wandConfig: {
        enabled: true,
        prompt: 'Generate relevant Shopify tags. Return ONLY the comma-separated list.',
        placeholder: 'Describe the filter or tags',
      },
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    {
      id: 'inventoryItemId',
      title: 'Inventory Item ID',
      type: 'short-input',
      placeholder: 'gid://shopify/InventoryItem/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_get_inventory_level', 'shopify_adjust_inventory'],
      },
    },
    {
      id: 'locationId',
      title: 'Location ID',
      type: 'short-input',
      placeholder: 'gid://shopify/Location/123456789',
      required: {
        field: 'operation',
        value: 'shopify_adjust_inventory',
      },
      condition: {
        field: 'operation',
        value: ['shopify_get_inventory_level', 'shopify_adjust_inventory'],
      },
    },
    {
      id: 'delta',
      title: 'Quantity Change',
      type: 'short-input',
      placeholder: 'Positive to add, negative to subtract',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_adjust_inventory'],
      },
    },
    {
      id: 'fulfillmentOrderId',
      title: 'Fulfillment Order ID',
      type: 'short-input',
      placeholder: 'gid://shopify/FulfillmentOrder/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_create_fulfillment', 'shopify_get_fulfillment_order'],
      },
    },
    {
      id: 'trackingNumber',
      title: 'Tracking Number',
      type: 'short-input',
      placeholder: 'Enter tracking number',
      condition: {
        field: 'operation',
        value: ['shopify_create_fulfillment'],
      },
    },
    {
      id: 'trackingCompany',
      title: 'Shipping Carrier',
      type: 'short-input',
      placeholder: 'e.g., UPS, FedEx, USPS, DHL',
      condition: {
        field: 'operation',
        value: ['shopify_create_fulfillment'],
      },
    },
    {
      id: 'trackingUrl',
      title: 'Tracking URL',
      type: 'short-input',
      placeholder: 'https://...',
      condition: {
        field: 'operation',
        value: ['shopify_create_fulfillment'],
      },
    },
    {
      id: 'notifyCustomer',
      title: 'Notify Customer',
      type: 'switch',
      defaultValue: true,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_fulfillment'],
      },
    },
    {
      id: 'trackingNotifyCustomer',
      title: 'Notify Customer',
      type: 'switch',
      defaultValue: false,
      mode: 'advanced',
      condition: { field: 'operation', value: 'shopify_update_fulfillment_tracking' },
    },
    {
      id: 'includeInactive',
      title: 'Include Inactive Locations',
      type: 'switch',
      defaultValue: false,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_list_locations'],
      },
    },
    {
      id: 'collectionId',
      title: 'Collection ID',
      type: 'short-input',
      placeholder: 'gid://shopify/Collection/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_get_collection'],
      },
    },
    {
      id: 'collectionQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., title:Summer OR collection_type:smart',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Shopify search query using field:value filters such as title:shirt or created_at:>2026-01-01. Return ONLY the Shopify search query.',
        placeholder: 'Describe the filter or tags',
      },
      condition: {
        field: 'operation',
        value: ['shopify_list_collections'],
      },
    },
    {
      id: 'productsFirst',
      title: 'Max Products In Collection',
      type: 'short-input',
      placeholder: 'Defaults to 50, max 250',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_get_collection'],
      },
    },
    {
      id: 'handle',
      title: 'Handle',
      type: 'short-input',
      placeholder: 'URL-friendly product handle',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'seo',
      title: 'Seo',
      type: 'code',
      language: 'json',
      placeholder: 'SEOInput object with title and description',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify seo: SEOInput object with title and description. Return ONLY the JSON object.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      placeholder: 'Product taxonomy category GID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'templateSuffix',
      title: 'Template Suffix',
      type: 'short-input',
      placeholder: 'Theme template suffix',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'metafields',
      title: 'Metafields',
      type: 'code',
      language: 'json',
      placeholder: 'MetafieldInput array: namespace, key, type, value, or id',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'shopify_create_product',
          'shopify_update_product',
          'shopify_create_customer',
          'shopify_update_customer',
          'shopify_update_order',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify metafields: MetafieldInput array: namespace, key, type, value, or id. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'collectionsToJoin',
      title: 'Collections To Join',
      type: 'code',
      language: 'json',
      placeholder: 'Collection GIDs to add the product to',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify collectionsToJoin: Collection GIDs to add the product to. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'requiresSellingPlan',
      title: 'Requires Selling Plan',
      type: 'dropdown',
      options: [
        { label: 'Use default / keep unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    {
      id: 'productOptions',
      title: 'Product Options',
      type: 'code',
      language: 'json',
      placeholder:
        'OptionCreateInput array with name and values: [{name: "Size", values: [{name: "Small"}]}]',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_create_product'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify productOptions: OptionCreateInput array with name and values: [{name: "Size", values: [{name: "Small"}]}]. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'media',
      title: 'Media',
      type: 'code',
      language: 'json',
      placeholder: 'CreateMediaInput array with originalSource, mediaContentType, and optional alt',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'shopify_create_product',
          'shopify_update_product',
          'shopify_create_product_variants',
          'shopify_update_product_variants',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify media: CreateMediaInput array with originalSource, mediaContentType, and optional alt. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'collectionsToLeave',
      title: 'Collections To Leave',
      type: 'code',
      language: 'json',
      placeholder: 'Collection GIDs to remove the product from',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_update_product'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify collectionsToLeave: Collection GIDs to remove the product from. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'redirectNewHandle',
      title: 'Redirect New Handle',
      type: 'dropdown',
      options: [
        { label: 'Use default / keep unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_update_product'] },
    },
    {
      id: 'addresses',
      title: 'Addresses',
      type: 'code',
      language: 'json',
      placeholder: 'MailingAddressInput array; replacing addresses is deprecated by Shopify',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify addresses: MailingAddressInput array; replacing addresses is deprecated by Shopify. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'locale',
      title: 'Locale',
      type: 'short-input',
      placeholder: 'Customer locale, such as en',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    {
      id: 'taxExempt',
      title: 'Tax Exempt',
      type: 'dropdown',
      options: [
        { label: 'Use default / keep unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    {
      id: 'emailMarketingConsent',
      title: 'Email Marketing Consent',
      type: 'code',
      language: 'json',
      placeholder:
        'CustomerEmailMarketingConsentInput with marketingState, marketingOptInLevel, consentUpdatedAt',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify emailMarketingConsent: CustomerEmailMarketingConsentInput with marketingState, marketingOptInLevel, consentUpdatedAt. Return ONLY the JSON object.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'smsMarketingConsent',
      title: 'Sms Marketing Consent',
      type: 'code',
      language: 'json',
      placeholder:
        'CustomerSmsMarketingConsentInput with marketingState, marketingOptInLevel, consentUpdatedAt',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify smsMarketingConsent: CustomerSmsMarketingConsentInput with marketingState, marketingOptInLevel, consentUpdatedAt. Return ONLY the JSON object.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'shippingAddress',
      title: 'Shipping Address',
      type: 'code',
      language: 'json',
      placeholder:
        'MailingAddressInput object with firstName, lastName, address1, address2, city, provinceCode, countryCode, zip, and phone',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_update_order'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify shippingAddress: MailingAddressInput object with firstName, lastName, address1, address2, city, provinceCode, countryCode, zip, and phone. Return ONLY the JSON object.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'customAttributes',
      title: 'Custom Attributes',
      type: 'code',
      language: 'json',
      placeholder: 'Order attributes as an array of {key, value} objects',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_update_order'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify customAttributes: Order attributes as an array of {key, value} objects. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'poNumber',
      title: 'Po Number',
      type: 'short-input',
      placeholder: 'Purchase order number',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_update_order'] },
    },
    {
      id: 'after',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Cursor from pageInfo.endCursor',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'shopify_list_products',
          'shopify_list_orders',
          'shopify_list_customers',
          'shopify_list_inventory_items',
          'shopify_list_locations',
          'shopify_list_collections',
          'shopify_list_fulfillment_orders',
          'shopify_get_fulfillment_order',
          'shopify_get_fulfillment',
          'shopify_get_inventory_level',
        ],
      },
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'jobResult.id (gid://shopify/OrderCancelJobResult/123) or legacy Job ID',
      required: true,
      condition: { field: 'operation', value: ['shopify_get_job'] },
    },
    {
      id: 'fulfillmentId',
      title: 'Fulfillment ID',
      type: 'short-input',
      placeholder: 'gid://shopify/Fulfillment/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_get_fulfillment', 'shopify_update_fulfillment_tracking'],
      },
    },
    {
      id: 'variants',
      title: 'Variants',
      type: 'code',
      language: 'json',
      placeholder:
        'Create: [{"optionValues":[{"optionName":"Size","name":"Small"}],"price":"19.99"}]; update: [{"id":"gid://shopify/ProductVariant/123","price":"19.99"}]',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_create_product_variants', 'shopify_update_product_variants'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify ProductVariantsBulkInput objects. For creation use optionValues with optionName and name plus price; for updates use variant id plus only changed fields such as price. Never supply an id for creation. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'strategy',
      title: 'Variant Creation Strategy',
      type: 'dropdown',
      options: [
        { id: 'DEFAULT', label: 'Default' },
        { id: 'REMOVE_STANDALONE_VARIANT', label: 'Remove standalone variant' },
        { id: 'PRESERVE_STANDALONE_VARIANT', label: 'Preserve standalone variant' },
      ],
      value: () => 'DEFAULT',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_create_product_variants'] },
    },
    {
      id: 'allowPartialUpdates',
      title: 'Allow Partial Updates',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_update_product_variants'] },
    },
    {
      id: 'trackingInfo',
      title: 'Tracking Information',
      type: 'code',
      language: 'json',
      placeholder: '{"company":"UPS","number":"1Z123","url":"https://..."}',
      required: true,
      condition: { field: 'operation', value: ['shopify_update_fulfillment_tracking'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify trackingInfo: {"company":"UPS","number":"1Z123","url":"https://..."}. Return ONLY the JSON object.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'fulfillmentOrderLineItems',
      title: 'Items to Fulfill',
      type: 'code',
      language: 'json',
      placeholder:
        '[{"id":"gid://shopify/FulfillmentOrderLineItem/123","quantity":1}]; omit for all remaining items',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_create_fulfillment'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify fulfillmentOrderLineItems: [{"id":"gid://shopify/FulfillmentOrderLineItem/123","quantity":1}]; omit for all remaining items. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'originAddress',
      title: 'Shipment Origin',
      type: 'code',
      language: 'json',
      placeholder: '{"address1":"123 Main St","city":"New York","countryCode":"US","zip":"10001"}',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_create_fulfillment'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify originAddress: {"address1":"123 Main St","city":"New York","countryCode":"US","zip":"10001"}. Return ONLY the JSON object.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'message',
      title: 'Fulfillment Message',
      type: 'short-input',
      placeholder: 'Optional message for the fulfillment',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_create_fulfillment'] },
    },
    {
      id: 'trackingNumbers',
      title: 'Tracking Numbers',
      type: 'code',
      language: 'json',
      placeholder: '["1Z123", "1Z456"]',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_create_fulfillment'] },
      wandConfig: {
        enabled: true,
        prompt: 'Generate Shopify trackingNumbers: ["1Z123", "1Z456"]. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'trackingUrls',
      title: 'Tracking URLs',
      type: 'code',
      language: 'json',
      placeholder: '["https://carrier.example/track/1Z123"]',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_create_fulfillment'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify trackingUrls: ["https://carrier.example/track/1Z123"]. Return ONLY the JSON array.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'idempotencyKey',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'Optional: reuse the same key when retrying this stock adjustment',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_adjust_inventory'] },
    },
    {
      id: 'reason',
      title: 'Inventory Adjustment Reason',
      type: 'short-input',
      placeholder: 'correction (default), received, damaged, or promotion',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_adjust_inventory'] },
    },
    {
      id: 'name',
      title: 'Inventory Quantity',
      type: 'dropdown',
      options: [
        { id: 'available', label: 'Available' },
        { id: 'on_hand', label: 'On hand' },
      ],
      value: () => 'available',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_adjust_inventory'] },
    },
    {
      id: 'referenceDocumentUri',
      title: 'Reference Document URI',
      type: 'short-input',
      placeholder: 'logistics://warehouse/receipt/123',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_adjust_inventory'] },
    },
    {
      id: 'ledgerDocumentUri',
      title: 'Ledger Document URI',
      type: 'short-input',
      placeholder: 'logistics://warehouse/entry/123 (required for on_hand)',
      required: { field: 'name', value: 'on_hand' },
      condition: { field: 'operation', value: ['shopify_adjust_inventory'] },
    },
    {
      id: 'changeFromQuantity',
      title: 'Expected Current Quantity',
      type: 'short-input',
      placeholder: 'Optional stock quantity for a compare-and-swap check',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_adjust_inventory'] },
    },
    {
      id: 'refundMethod',
      title: 'Refund Method',
      type: 'code',
      language: 'json',
      placeholder: '{"originalPaymentMethodsRefund":true} or {"storeCreditRefund":{...}}',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_cancel_order'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Shopify refundMethod: {"originalPaymentMethodsRefund":true} or {"storeCreditRefund":{...}}. Return ONLY the JSON object.',
        placeholder: 'Describe the values to send',
        generationType: 'json-object',
      },
    },
    {
      id: 'orderPhone',
      title: 'Order Phone',
      type: 'short-input',
      placeholder: '+1234567890',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_update_order'] },
    },
    {
      id: 'variantsFirst',
      title: 'Variants Per Page',
      type: 'short-input',
      placeholder: 'Defaults to 50, max 100',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_get_product'] },
    },
    {
      id: 'variantsAfter',
      title: 'Variant Cursor',
      type: 'short-input',
      placeholder: 'Cursor from product.variants.pageInfo.endCursor',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_get_product'] },
    },
    {
      id: 'imagesFirst',
      title: 'Images Per Page',
      type: 'short-input',
      placeholder: 'Defaults to 20, max 100',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_get_product'] },
    },
    {
      id: 'imagesAfter',
      title: 'Image Cursor',
      type: 'short-input',
      placeholder: 'Cursor from product.images.pageInfo.endCursor',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_get_product'] },
    },
    {
      id: 'lineItemsFirst',
      title: 'Line Items Per Page',
      type: 'short-input',
      placeholder: 'Defaults to 50, max 50',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_get_order'] },
    },
    {
      id: 'lineItemsAfter',
      title: 'Line Item Cursor',
      type: 'short-input',
      placeholder: 'Cursor from order.lineItems.pageInfo.endCursor',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_get_order'] },
    },
    {
      id: 'productsAfter',
      title: 'Collection Product Cursor',
      type: 'short-input',
      placeholder: 'Cursor from collection.productsPageInfo.endCursor',
      mode: 'advanced',
      condition: { field: 'operation', value: ['shopify_get_collection'] },
    },
  ],
  tools: {
    access: [
      'shopify_create_product',
      'shopify_get_product',
      'shopify_list_products',
      'shopify_update_product',
      'shopify_delete_product',
      'shopify_get_order',
      'shopify_list_orders',
      'shopify_update_order',
      'shopify_cancel_order',
      'shopify_create_customer',
      'shopify_get_customer',
      'shopify_list_customers',
      'shopify_update_customer',
      'shopify_delete_customer',
      'shopify_list_inventory_items',
      'shopify_get_inventory_level',
      'shopify_adjust_inventory',
      'shopify_list_locations',
      'shopify_create_fulfillment',
      'shopify_list_collections',
      'shopify_list_fulfillment_orders',
      'shopify_get_fulfillment_order',
      'shopify_get_job',
      'shopify_create_product_variants',
      'shopify_update_product_variants',
      'shopify_get_fulfillment',
      'shopify_update_fulfillment_tracking',
      'shopify_get_collection',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'shopify_list_products'
      },
      params: (params) => {
        const first = parseOptionalNumberInput(params.first, 'first')
        const baseParams: Record<string, unknown> = {
          handle: params.handle?.trim() || undefined,
          seo: params.seo,
          category: params.category?.trim() || undefined,
          templateSuffix: params.templateSuffix?.trim() || undefined,
          metafields: params.metafields,
          collectionsToJoin: params.collectionsToJoin,
          requiresSellingPlan: parseOptionalBooleanInput(params.requiresSellingPlan),
          productOptions: params.productOptions,
          media: params.media,
          collectionsToLeave: params.collectionsToLeave,
          redirectNewHandle: parseOptionalBooleanInput(params.redirectNewHandle),
          addresses: params.addresses,
          locale: params.locale?.trim() || undefined,
          taxExempt: parseOptionalBooleanInput(params.taxExempt),
          emailMarketingConsent: params.emailMarketingConsent,
          smsMarketingConsent: params.smsMarketingConsent,
          shippingAddress: params.shippingAddress,
          customAttributes: params.customAttributes,
          poNumber: params.poNumber?.trim() || undefined,
          after: params.after,
          reverse: parseOptionalBooleanInput(params.reverse),
          includeDetails: parseOptionalBooleanInput(params.includeDetails),
          jobId: params.jobId,
          fulfillmentId: params.fulfillmentId,
          variants: params.variants,
          strategy: params.strategy?.trim() || undefined,
          allowPartialUpdates: parseOptionalBooleanInput(params.allowPartialUpdates),
          trackingInfo: params.trackingInfo,
          fulfillmentOrderLineItems: params.fulfillmentOrderLineItems,
          originAddress: params.originAddress,
          message: params.message?.trim() || undefined,
          trackingNumbers: params.trackingNumbers,
          trackingUrls: params.trackingUrls,
          idempotencyKey: params.idempotencyKey?.trim() || undefined,
          reason: params.reason?.trim() || undefined,
          name: params.name?.trim() || undefined,
          referenceDocumentUri: params.referenceDocumentUri?.trim() || undefined,
          ledgerDocumentUri: params.ledgerDocumentUri?.trim() || undefined,
          changeFromQuantity: parseOptionalNumberInput(
            params.changeFromQuantity,
            'changeFromQuantity'
          ),
          refundMethod: params.refundMethod,
          orderPhone: params.orderPhone,
          variantsFirst: parseOptionalNumberInput(params.variantsFirst, 'variantsFirst'),
          variantsAfter: params.variantsAfter,
          imagesFirst: parseOptionalNumberInput(params.imagesFirst, 'imagesFirst'),
          imagesAfter: params.imagesAfter,
          lineItemsFirst: parseOptionalNumberInput(params.lineItemsFirst, 'lineItemsFirst'),
          lineItemsAfter: params.lineItemsAfter,
          productsAfter: params.productsAfter,
          first,
          oauthCredential: params.oauthCredential,
          shopDomain: params.shopDomain?.trim(),
        }

        switch (params.operation || 'shopify_list_products') {
          case 'shopify_create_product':
            if (!params.title?.trim()) {
              throw new Error('Product title is required.')
            }
            return {
              ...baseParams,
              title: params.title.trim(),
              descriptionHtml: params.descriptionHtml?.trim(),
              productType: params.productType?.trim(),
              vendor: params.vendor?.trim(),
              tags: params.tags
                ?.split(',')
                .map((t: string) => t.trim())
                .filter(Boolean),
              status: params.status || undefined,
            }

          case 'shopify_get_product':
            if (!params.productId?.trim()) {
              throw new Error('Product ID is required.')
            }
            return {
              ...baseParams,
              productId: params.productId.trim(),
            }

          case 'shopify_list_products':
            return {
              ...baseParams,
              sortKey: params.productsSortKey || undefined,
              first,
              query: params.productQuery?.trim(),
            }

          case 'shopify_update_product':
            if (!params.productId?.trim()) {
              throw new Error('Product ID is required.')
            }
            return {
              ...baseParams,
              productId: params.productId.trim(),
              title: params.title?.trim(),
              descriptionHtml: params.descriptionHtml?.trim(),
              productType: params.productType?.trim(),
              vendor: params.vendor?.trim(),
              tags: params.tags
                ?.split(',')
                .map((t: string) => t.trim())
                .filter(Boolean),
              status: params.status || undefined,
            }

          case 'shopify_delete_product':
            if (!params.productId?.trim()) {
              throw new Error('Product ID is required.')
            }
            return {
              ...baseParams,
              productId: params.productId.trim(),
            }

          case 'shopify_get_order':
            if (!params.orderId?.trim()) {
              throw new Error('Order ID is required.')
            }
            return {
              ...baseParams,
              orderId: params.orderId.trim(),
            }

          case 'shopify_list_orders':
            return {
              ...baseParams,
              sortKey: params.ordersSortKey || undefined,
              first,
              status: params.orderStatus !== 'any' ? params.orderStatus : undefined,
              query: params.orderQuery?.trim(),
            }

          case 'shopify_update_order':
            if (!params.orderId?.trim()) {
              throw new Error('Order ID is required.')
            }
            return {
              ...baseParams,
              orderId: params.orderId.trim(),
              note: params.orderNote?.trim(),
              email: params.orderEmail?.trim(),
              phone: params.orderPhone?.trim(),
              tags: params.orderTags
                ?.split(',')
                .map((t: string) => t.trim())
                .filter(Boolean),
            }

          case 'shopify_cancel_order':
            if (!params.orderId?.trim()) {
              throw new Error('Order ID is required.')
            }
            if (!params.cancelReason) {
              throw new Error('Cancel reason is required.')
            }
            return {
              ...baseParams,
              orderId: params.orderId.trim(),
              reason: params.cancelReason,
              restock: parseOptionalBooleanInput(params.restock) ?? false,
              notifyCustomer: parseOptionalBooleanInput(params.cancelNotifyCustomer),
              refundMethod:
                params.refundMethod ||
                (parseOptionalBooleanInput(params.refundOriginalPayment) === true
                  ? { originalPaymentMethodsRefund: true }
                  : undefined),
              staffNote: params.staffNote?.trim(),
            }

          case 'shopify_create_customer':
            return {
              ...baseParams,
              email: params.customerEmail?.trim(),
              firstName: params.firstName?.trim(),
              lastName: params.lastName?.trim(),
              phone: params.phone?.trim(),
              note: params.customerNote?.trim(),
              tags: params.customerTags
                ?.split(',')
                .map((t: string) => t.trim())
                .filter(Boolean),
            }

          case 'shopify_get_customer':
            if (!params.customerId?.trim()) {
              throw new Error('Customer ID is required.')
            }
            return {
              ...baseParams,
              customerId: params.customerId.trim(),
            }

          case 'shopify_list_customers':
            return {
              ...baseParams,
              sortKey: params.customersSortKey || undefined,
              first,
              query: params.customerQuery?.trim(),
            }

          case 'shopify_update_customer':
            if (!params.customerId?.trim()) {
              throw new Error('Customer ID is required.')
            }
            return {
              ...baseParams,
              customerId: params.customerId.trim(),
              email: params.customerEmail?.trim(),
              firstName: params.firstName?.trim(),
              lastName: params.lastName?.trim(),
              phone: params.phone?.trim(),
              note: params.customerNote?.trim(),
              tags: params.customerTags
                ?.split(',')
                .map((t: string) => t.trim())
                .filter(Boolean),
            }

          case 'shopify_delete_customer':
            if (!params.customerId?.trim()) {
              throw new Error('Customer ID is required.')
            }
            return {
              ...baseParams,
              customerId: params.customerId.trim(),
            }

          case 'shopify_list_inventory_items':
            return {
              ...baseParams,
              first,
              query: params.inventoryQuery?.trim(),
            }

          case 'shopify_get_inventory_level':
            if (!params.inventoryItemId?.trim()) {
              throw new Error('Inventory Item ID is required.')
            }
            return {
              ...baseParams,
              inventoryItemId: params.inventoryItemId.trim(),
              locationId: params.locationId?.trim(),
            }

          case 'shopify_adjust_inventory':
            if (!params.inventoryItemId?.trim()) {
              throw new Error('Inventory Item ID is required.')
            }
            if (!params.locationId?.trim()) {
              throw new Error('Location ID is required.')
            }
            if (params.delta === undefined || params.delta === '') {
              throw new Error('Quantity change (delta) is required.')
            }
            return {
              ...baseParams,
              inventoryItemId: params.inventoryItemId.trim(),
              locationId: params.locationId.trim(),
              delta: Number(params.delta),
            }

          case 'shopify_list_locations':
            return {
              ...baseParams,
              sortKey: params.locationsSortKey || undefined,
              first,
              includeInactive: parseOptionalBooleanInput(params.includeInactive),
              includeLegacy: parseOptionalBooleanInput(params.includeLegacy),
              query: params.locationQuery?.trim(),
            }

          case 'shopify_create_fulfillment':
            if (!params.fulfillmentOrderId?.trim()) {
              throw new Error('Fulfillment Order ID is required.')
            }
            return {
              ...baseParams,
              fulfillmentOrderId: params.fulfillmentOrderId.trim(),
              trackingNumber: params.trackingNumber?.trim(),
              trackingCompany: params.trackingCompany?.trim(),
              trackingUrl: params.trackingUrl?.trim(),
              notifyCustomer: parseOptionalBooleanInput(params.notifyCustomer),
            }

          case 'shopify_list_collections':
            return {
              ...baseParams,
              sortKey: params.collectionsSortKey || undefined,
              first,
              query: params.collectionQuery?.trim(),
            }

          case 'shopify_get_collection':
            if (!params.collectionId?.trim()) {
              throw new Error('Collection ID is required.')
            }
            return {
              ...baseParams,
              collectionId: params.collectionId.trim(),
              productsFirst: parseOptionalNumberInput(params.productsFirst, 'productsFirst'),
            }

          case 'shopify_list_fulfillment_orders':
            return { ...baseParams, orderId: params.orderId?.trim() }
          case 'shopify_get_fulfillment_order':
            return { ...baseParams, fulfillmentOrderId: params.fulfillmentOrderId?.trim() }
          case 'shopify_get_job':
            return { ...baseParams, jobId: params.jobId?.trim() }
          case 'shopify_create_product_variants':
            return { ...baseParams, productId: params.productId?.trim() }
          case 'shopify_update_product_variants':
            return { ...baseParams, productId: params.productId?.trim() }
          case 'shopify_get_fulfillment':
            return { ...baseParams, fulfillmentId: params.fulfillmentId?.trim() }
          case 'shopify_update_fulfillment_tracking':
            return {
              ...baseParams,
              fulfillmentId: params.fulfillmentId?.trim(),
              notifyCustomer: parseOptionalBooleanInput(params.trackingNotifyCustomer),
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    productsSortKey: { type: 'string', description: 'Sort products by the selected field' },
    ordersSortKey: { type: 'string', description: 'Sort orders by the selected field' },
    customersSortKey: { type: 'string', description: 'Sort customers by the selected field' },
    collectionsSortKey: { type: 'string', description: 'Sort collections by the selected field' },
    locationsSortKey: { type: 'string', description: 'Sort locations by the selected field' },
    reverse: { type: 'boolean', description: 'Reverse result sort order' },
    includeLegacy: { type: 'boolean', description: 'Include legacy fulfillment-service locations' },
    locationQuery: { type: 'string', description: 'Filter locations using Shopify search syntax' },
    trackingNotifyCustomer: {
      type: 'boolean',
      description: 'Notify the customer about updated tracking',
    },
    handle: { type: 'string', description: 'URL-friendly product handle' },
    seo: { type: 'json', description: 'SEOInput object with title and description' },
    category: { type: 'string', description: 'Product taxonomy category GID' },
    templateSuffix: { type: 'string', description: 'Theme template suffix' },
    metafields: {
      type: 'json',
      description: 'MetafieldInput array: namespace, key, type, value, or id',
    },
    collectionsToJoin: { type: 'json', description: 'Collection GIDs to add the product to' },
    requiresSellingPlan: {
      type: 'boolean',
      description: 'Whether a selling plan is required to purchase the product',
    },
    productOptions: {
      type: 'json',
      description:
        'OptionCreateInput array with name and values: [{name: "Size", values: [{name: "Small"}]}]',
    },
    media: {
      type: 'json',
      description: 'CreateMediaInput array with originalSource, mediaContentType, and optional alt',
    },
    collectionsToLeave: { type: 'json', description: 'Collection GIDs to remove the product from' },
    redirectNewHandle: {
      type: 'boolean',
      description: 'Create a redirect when changing the handle',
    },
    addresses: {
      type: 'json',
      description: 'MailingAddressInput array; replacing addresses is deprecated by Shopify',
    },
    locale: { type: 'string', description: 'Customer locale, such as en' },
    taxExempt: { type: 'boolean', description: 'Whether the customer is exempt from taxes' },
    emailMarketingConsent: {
      type: 'json',
      description:
        'CustomerEmailMarketingConsentInput with marketingState, marketingOptInLevel, consentUpdatedAt',
    },
    smsMarketingConsent: {
      type: 'json',
      description:
        'CustomerSmsMarketingConsentInput with marketingState, marketingOptInLevel, consentUpdatedAt',
    },
    shippingAddress: {
      type: 'json',
      description:
        'MailingAddressInput object with firstName, lastName, address1, address2, city, provinceCode, countryCode, zip, and phone',
    },
    customAttributes: {
      type: 'json',
      description: 'Order attributes as an array of {key, value} objects',
    },
    poNumber: { type: 'string', description: 'Purchase order number' },
    after: { type: 'string', description: 'Cursor from pageInfo.endCursor' },
    jobId: { type: 'string', description: 'gid://shopify/Job/123456789' },
    fulfillmentId: { type: 'string', description: 'gid://shopify/Fulfillment/123456789' },
    variants: {
      type: 'json',
      description: '[{"id":"gid://shopify/ProductVariant/123","price":"19.99"}]',
    },
    strategy: {
      type: 'string',
      description: 'DEFAULT, REMOVE_STANDALONE_VARIANT, or PRESERVE_STANDALONE_VARIANT',
    },
    allowPartialUpdates: { type: 'boolean', description: 'Update valid variants when others fail' },
    trackingInfo: {
      type: 'json',
      description: '{"company":"UPS","number":"1Z123","url":"https://..."}',
    },
    fulfillmentOrderLineItems: {
      type: 'json',
      description:
        '[{"id":"gid://shopify/FulfillmentOrderLineItem/123","quantity":1}]; omit for all remaining items',
    },
    originAddress: {
      type: 'json',
      description: '{"address1":"123 Main St","city":"New York","countryCode":"US","zip":"10001"}',
    },
    message: { type: 'string', description: 'Optional message for the fulfillment' },
    trackingNumbers: { type: 'json', description: '["1Z123", "1Z456"]' },
    trackingUrls: { type: 'json', description: '["https://carrier.example/track/1Z123"]' },
    idempotencyKey: {
      type: 'string',
      description: 'Optional: reuse the same key when retrying this stock adjustment',
    },
    reason: {
      type: 'string',
      description: 'correction (default), received, damaged, or promotion',
    },
    name: { type: 'string', description: 'available (default) or on_hand' },
    referenceDocumentUri: { type: 'string', description: 'logistics://warehouse/receipt/123' },
    ledgerDocumentUri: { type: 'string', description: 'logistics://warehouse/entry/123' },
    changeFromQuantity: {
      type: 'number',
      description: 'Optional stock quantity for a compare-and-swap check',
    },
    refundMethod: {
      type: 'json',
      description: '{"originalPaymentMethodsRefund":true} or {"storeCreditRefund":{...}}',
    },
    orderPhone: { type: 'string', description: '+1234567890' },
    variantsFirst: { type: 'number', description: 'Defaults to 50, max 100' },
    variantsAfter: {
      type: 'string',
      description: 'Cursor from product.variants.pageInfo.endCursor',
    },
    imagesFirst: { type: 'number', description: 'Defaults to 20, max 100' },
    imagesAfter: { type: 'string', description: 'Cursor from product.images.pageInfo.endCursor' },
    lineItemsFirst: { type: 'number', description: 'Defaults to 50, max 50' },
    lineItemsAfter: {
      type: 'string',
      description: 'Cursor from order.lineItems.pageInfo.endCursor',
    },
    productsAfter: {
      type: 'string',
      description: 'Cursor from collection.productsPageInfo.endCursor',
    },

    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Shopify credential ID' },
    shopDomain: { type: 'string', description: 'Shopify store domain' },
    productId: { type: 'string', description: 'Product ID' },
    title: { type: 'string', description: 'Product title' },
    descriptionHtml: { type: 'string', description: 'Product description (HTML)' },
    productType: { type: 'string', description: 'Product type' },
    vendor: { type: 'string', description: 'Product vendor' },
    tags: { type: 'string', description: 'Tags (comma-separated)' },
    status: { type: 'string', description: 'Product status' },
    productQuery: { type: 'string', description: 'Product search query' },
    includeDetails: {
      type: 'boolean',
      description: 'Include expanded product or order details with smaller pages',
    },
    first: { type: 'number', description: 'Maximum number of results to return' },
    orderId: { type: 'string', description: 'Order ID' },
    orderStatus: { type: 'string', description: 'Order status filter' },
    orderQuery: { type: 'string', description: 'Order search query' },
    orderNote: { type: 'string', description: 'Order note' },
    orderEmail: { type: 'string', description: 'Order customer email' },
    orderTags: { type: 'string', description: 'Order tags' },
    cancelReason: { type: 'string', description: 'Order cancellation reason' },
    restock: { type: 'boolean', description: 'Whether to restock cancelled items' },
    cancelNotifyCustomer: { type: 'boolean', description: 'Whether to notify the customer' },
    refundOriginalPayment: {
      type: 'boolean',
      description: 'Whether to refund to the original payment method',
    },
    staffNote: { type: 'string', description: 'Staff note for order cancellation' },
    customerId: { type: 'string', description: 'Customer ID' },
    customerEmail: { type: 'string', description: 'Customer email' },
    firstName: { type: 'string', description: 'Customer first name' },
    lastName: { type: 'string', description: 'Customer last name' },
    phone: { type: 'string', description: 'Customer phone' },
    customerNote: { type: 'string', description: 'Customer note' },
    customerTags: { type: 'string', description: 'Customer tags' },
    customerQuery: { type: 'string', description: 'Customer search query' },
    inventoryQuery: { type: 'string', description: 'Inventory search query' },
    inventoryItemId: { type: 'string', description: 'Inventory item ID' },
    locationId: { type: 'string', description: 'Location ID' },
    delta: { type: 'number', description: 'Quantity change' },
    fulfillmentOrderId: { type: 'string', description: 'Fulfillment order ID' },
    trackingNumber: { type: 'string', description: 'Shipment tracking number' },
    trackingCompany: { type: 'string', description: 'Shipping carrier name' },
    trackingUrl: { type: 'string', description: 'Tracking URL' },
    notifyCustomer: { type: 'boolean', description: 'Send shipping notification email' },
    includeInactive: { type: 'boolean', description: 'Include inactive locations in results' },
    collectionId: { type: 'string', description: 'Collection ID' },
    collectionQuery: { type: 'string', description: 'Collection search query' },
    productsFirst: { type: 'number', description: 'Maximum number of products to return' },
  },
  outputs: {
    jobResult: {
      type: 'json',
      description:
        'Cancellation outcome (id, done, status, errors, order with id and cancelledAt); poll with Get Job',
    },
    job: { type: 'json', description: 'Asynchronous job (id, done); poll Get Job until done' },
    fulfillmentOrders: {
      type: 'json',
      description:
        'Fulfillment orders (id, orderId, status, requestStatus, assignedLocation, supportedActions, lineItems with remainingQuantity and pageInfo)',
    },
    fulfillmentOrder: {
      type: 'json',
      description:
        'Fulfillment order details (id, orderId, status, assignedLocation, supportedActions, lineItems.edges.node and lineItems.pageInfo)',
    },
    productVariants: {
      type: 'json',
      description:
        'Created or updated variants (id, title, price, compareAtPrice, sku, inventoryItem, selectedOptions)',
    },
    userErrors: {
      type: 'json',
      description:
        'Variant validation errors [{field, message}], including partial update failures',
    },

    product: {
      type: 'json',
      description:
        'Product details (id, title, handle, descriptionHtml, vendor, productType, tags, status, variants, images)',
    },
    products: {
      type: 'json',
      description: 'List of products with core product fields and media summaries',
    },
    order: {
      type: 'json',
      description:
        'Order details or cancellation result depending on the operation (order fields, customer, totals, notes, line items, or cancellation job status)',
    },
    orders: {
      type: 'json',
      description: 'List of orders with status, totals, customer, and shipping summary fields',
    },
    customer: {
      type: 'json',
      description:
        'Customer details (id, email, name, phone, note, tags, amountSpent, addresses, defaultAddress)',
    },
    customers: {
      type: 'json',
      description: 'List of customers with contact details, tags, spend, and default address',
    },
    inventoryItems: {
      type: 'json',
      description:
        'Inventory items with SKU, tracking status, variant details, and per-location stock',
    },
    inventoryLevel: {
      type: 'json',
      description:
        'Inventory levels for an item or an inventory adjustment result (levels by location, or adjustmentGroup and changes)',
    },
    locations: {
      type: 'json',
      description:
        'Store locations with id, name, active status, fulfillment capability, and address',
    },
    fulfillment: {
      type: 'json',
      description:
        'Fulfillment result (id, status, trackingInfo, createdAt, updatedAt, fulfillmentLineItems)',
    },
    collection: {
      type: 'json',
      description:
        'Collection details (id, title, handle, descriptionHtml, image, sortOrder, productsCount, products)',
    },
    collections: {
      type: 'json',
      description:
        'List of collections with id, title, handle, product counts, sort order, and image',
    },
    pageInfo: {
      type: 'json',
      description: 'Pagination info (hasNextPage, hasPreviousPage, startCursor, endCursor)',
    },
    deletedId: { type: 'string', description: 'ID of deleted resource' },
  },
}

export const ShopifyBlockMeta = {
  tags: ['payments', 'automation'],
  url: 'https://www.shopify.com',
  templates: [
    {
      icon: ShopifyIcon,
      title: 'Shopify order monitor',
      prompt:
        'Build a workflow that monitors Shopify orders, flags high-value or unusual orders for review, tracks fulfillment status in a table, and sends daily inventory and sales summaries to Slack with restock alerts when items run low.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ShopifyIcon,
      title: 'Shopify unpaid order recovery',
      prompt:
        'Build a scheduled workflow that lists Shopify orders left open and unpaid in the past day, drafts a personalized recovery email referencing the items, and sends it via Gmail while logging recovery attempts to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ShopifyIcon,
      title: 'Shopify restock alerter',
      prompt:
        'Create a scheduled hourly workflow that lists Shopify inventory items, computes days-of-cover from recent sales velocity, flags SKUs below a configurable threshold, and posts a Slack alert to the operations channel with the variant, location, and recommended reorder quantity.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring', 'operations'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ShopifyIcon,
      title: 'Shopify VIP segmenter',
      prompt:
        'Build a scheduled weekly workflow that pulls Shopify customers, uses amount spent and lifetime order count to group them into VIP and regular cohorts in a tracking table, and emails the marketing team via Gmail with a list of new VIPs to nurture.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'marketing', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ShopifyIcon,
      title: 'Shopify fulfillment tracker',
      prompt:
        'Create a scheduled workflow that lists Shopify orders and their fulfillment status, updates a status table with fulfillment status and tracking links, and proactively emails customers when their order misses an SLA so support gets ahead of the inquiry.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'support', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ShopifyIcon,
      title: 'Shopify product launcher',
      prompt:
        'Build a workflow that takes a new product brief, creates a draft product in Shopify, creates its variants with pricing, adds it to a collection using Collections To Join, drafts a launch announcement, and sends a Slack and Gmail draft announcement for marketing review. Publish to sales channels in Shopify after approval.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'marketing', 'automation'],
      alsoIntegrations: ['gmail', 'slack'],
    },
    {
      icon: ShopifyIcon,
      title: 'Shopify order anomaly detector',
      prompt:
        'Create a scheduled workflow that runs every fifteen minutes, lists recent Shopify orders, scores each for anomalies — high value, unusual destination, mismatched billing — flags suspects in a review queue table, and Slacks the operations team for hands-on inspection.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring', 'analysis'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-product-listing',
      description: 'Create a Shopify product and add variants with pricing.',
      content:
        '# Create Product Listing\n\nAdd a new product to the Shopify store.\n\n## Steps\n1. Run Create Product with the title, body description, vendor, and product type.\n2. Set status to draft while preparing the listing and run Create Product Variants to add options and prices. Active status alone does not publish a product to sales channels.\n3. Verify with Get Product on the returned product ID.\n\n## Output\nReturn the new product ID, title, and status, and confirm the listing was created as draft or active as intended.',
    },
    {
      name: 'process-recent-orders',
      description:
        'List recent Shopify orders and summarize them by status, value, or fulfillment need.',
      content:
        '# Process Recent Orders\n\nReview the latest orders to triage fulfillment and flag anything unusual.\n\n## Steps\n1. Run List Orders filtered by status (open, closed, cancelled, or any) and a recent time window.\n2. For orders needing detail, run Get Order to read line items, customer, and shipping address.\n3. Group orders by fulfillment status and total value.\n\n## Output\nReturn a summary of recent orders with their order numbers, totals, and status, highlighting any that need immediate fulfillment or review.',
    },
    {
      name: 'fulfill-order',
      description: 'Create a fulfillment for a Shopify order and update its status.',
      content:
        '# Fulfill Order\n\nMark an order as fulfilled once it has shipped.\n\n## Steps\n1. Run Get Order to confirm the order, then List Fulfillment Orders to find the fulfillment order ID and assigned location.\n2. Use Get Fulfillment Order to page through remaining items. Run Create Fulfillment with its fulfillment order ID, optional item IDs and quantities, and tracking details.\n3. Optionally run Update Order to record any notes.\n\n## Output\nConfirm the order number, the fulfillment created, and any tracking number supplied.',
    },
    {
      name: 'adjust-inventory',
      description: 'Check and adjust Shopify inventory levels for an item at a location.',
      content:
        '# Adjust Inventory\n\nReconcile stock levels for an inventory item.\n\n## Steps\n1. Run List Inventory Items and List Locations to identify the item and the location.\n2. Run Get Inventory Level to read the current available quantity.\n3. Run Adjust Inventory with the delta and expected current quantity. Reuse the idempotency key when retrying the same adjustment.\n\n## Output\nReport the inventory item, the location, the previous and new quantities, and the adjustment applied.',
    },
    {
      name: 'manage-customer-record',
      description: 'Create, look up, or update a Shopify customer record.',
      content:
        '# Manage Customer Record\n\nMaintain a customer profile in Shopify.\n\n## Steps\n1. To find an existing customer, run List Customers with a filter or Get Customer by ID.\n2. To add a new one, run Create Customer with name, email, and any tags.\n3. To change details, run Update Customer with only the fields to modify.\n\n## Output\nReturn the customer ID, name, and email, and note whether the record was created, found, or updated.',
    },
    {
      name: 'update-variant-prices',
      description: 'Update prices for selected variants without changing other product details.',
      content:
        '# Update Variant Prices\n\nMaintain product pricing in Shopify.\n\n## Steps\n1. Run Get Product and follow variant cursors to find the target variant IDs.\n2. Run Update Product Variants with each ID, price, and optional compareAtPrice.\n3. Check userErrors and read the affected variants again.\n\n## Output\nReturn updated variant IDs, prices, and any rejected changes.',
    },
    {
      name: 'correct-shipment-tracking',
      description: 'Correct carrier or tracking information on an existing fulfillment.',
      content:
        '# Correct Shipment Tracking\n\nKeep shipment references current.\n\n## Steps\n1. Run Get Order to find the fulfillment ID, then Get Fulfillment to read its tracking information.\n2. Run Update Fulfillment Tracking with the corrected carrier, number, or URL.\n3. Enable customer notification only when requested.\n\n## Output\nReturn the fulfillment ID and the confirmed tracking information.',
    },
  ],
} as const satisfies BlockMeta
