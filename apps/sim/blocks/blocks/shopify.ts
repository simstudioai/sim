import { ShopifyIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'

interface ShopifyResponse {
  success: boolean
  error?: string
  output: Record<string, unknown>
}

const LIST_OPERATIONS = [
  'shopify_list_products',
  'shopify_list_orders',
  'shopify_list_customers',
  'shopify_list_inventory_items',
  'shopify_list_locations',
  'shopify_list_collections',
] as const

export const ShopifyBlock: BlockConfig<ShopifyResponse> = {
  type: 'shopify',
  name: 'Shopify',
  description: 'Manage products, orders, customers, and inventory in your Shopify store',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Shopify into your workflow. Manage products, orders, customers, and inventory. Create, read, update, and delete products. List and manage orders. Handle customer data and adjust inventory levels.',
  docsLink: 'https://docs.sim.ai/tools/shopify',
  category: 'tools',
  integrationType: IntegrationType.Ecommerce,
  tags: ['payments', 'subscriptions'],
  icon: ShopifyIcon,
  bgColor: '#FFFFFF',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Product Operations
        { label: 'Create Product', id: 'shopify_create_product' },
        { label: 'Get Product', id: 'shopify_get_product' },
        { label: 'List Products', id: 'shopify_list_products' },
        { label: 'Update Product', id: 'shopify_update_product' },
        { label: 'Delete Product', id: 'shopify_delete_product' },
        // Order Operations
        { label: 'Get Order', id: 'shopify_get_order' },
        { label: 'List Orders', id: 'shopify_list_orders' },
        { label: 'Update Order', id: 'shopify_update_order' },
        { label: 'Cancel Order', id: 'shopify_cancel_order' },
        // Customer Operations
        { label: 'Create Customer', id: 'shopify_create_customer' },
        { label: 'Get Customer', id: 'shopify_get_customer' },
        { label: 'List Customers', id: 'shopify_list_customers' },
        { label: 'Update Customer', id: 'shopify_update_customer' },
        { label: 'Delete Customer', id: 'shopify_delete_customer' },
        // Inventory Operations
        { label: 'List Inventory Items', id: 'shopify_list_inventory_items' },
        { label: 'Get Inventory Level', id: 'shopify_get_inventory_level' },
        { label: 'Adjust Inventory', id: 'shopify_adjust_inventory' },
        // Location Operations
        { label: 'List Locations', id: 'shopify_list_locations' },
        // Fulfillment Operations
        { label: 'Create Fulfillment', id: 'shopify_create_fulfillment' },
        // Collection Operations
        { label: 'List Collections', id: 'shopify_list_collections' },
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
    // Product ID (for get/update/delete operations)
    {
      id: 'productId',
      title: 'Product ID',
      type: 'short-input',
      placeholder: 'gid://shopify/Product/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_get_product', 'shopify_update_product', 'shopify_delete_product'],
      },
    },
    // Product Title (for create/update)
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
    // Product Description
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
    // Product Type
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
    // Vendor
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
    // Tags
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2, tag3 (comma-separated)',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    // Status
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Active', id: 'ACTIVE' },
        { label: 'Draft', id: 'DRAFT' },
        { label: 'Archived', id: 'ARCHIVED' },
      ],
      value: () => 'ACTIVE',
      condition: {
        field: 'operation',
        value: ['shopify_create_product', 'shopify_update_product'],
      },
    },
    // Query for listing products
    {
      id: 'productQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter products (optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_list_products'],
      },
    },
    // Query for listing customers
    {
      id: 'customerQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., first_name:John OR email:*@gmail.com',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_list_customers'],
      },
    },
    // Query for listing inventory items
    {
      id: 'inventoryQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., sku:ABC123',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_list_inventory_items'],
      },
    },
    {
      id: 'first',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Defaults to 50, max 250',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: LIST_OPERATIONS as unknown as string[],
      },
    },
    // Order ID
    {
      id: 'orderId',
      title: 'Order ID',
      type: 'short-input',
      placeholder: 'gid://shopify/Order/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_get_order', 'shopify_update_order', 'shopify_cancel_order'],
      },
    },
    // Order Status (for listing)
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
      condition: {
        field: 'operation',
        value: ['shopify_list_orders'],
      },
    },
    // Order Note (for update)
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
    // Order Email (for update)
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
    // Order Tags (for update)
    {
      id: 'orderTags',
      title: 'Order Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2, tag3 (comma-separated)',
      condition: {
        field: 'operation',
        value: ['shopify_update_order'],
      },
    },
    // Cancel Order Reason
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
    // Staff Note (for cancel order)
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
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      required: true,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_cancel_order'],
      },
    },
    {
      id: 'cancelNotifyCustomer',
      title: 'Notify Customer',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_cancel_order'],
      },
    },
    {
      id: 'refundOriginalPayment',
      title: 'Refund to Original Payment Method',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_cancel_order'],
      },
    },
    // Customer ID
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
    // Customer Email (at least one of email/phone/firstName/lastName required for create)
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
    // Customer First Name
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
    // Customer Last Name
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
    // Customer Phone
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
    // Customer Note
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
    // Customer Tags
    {
      id: 'customerTags',
      title: 'Customer Tags',
      type: 'short-input',
      placeholder: 'vip, wholesale (comma-separated)',
      condition: {
        field: 'operation',
        value: ['shopify_create_customer', 'shopify_update_customer'],
      },
    },
    // Inventory Item ID
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
    // Location ID
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
    // Delta (for inventory adjustment)
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
    // Fulfillment Order ID
    {
      id: 'fulfillmentOrderId',
      title: 'Fulfillment Order ID',
      type: 'short-input',
      placeholder: 'gid://shopify/FulfillmentOrder/123456789',
      required: true,
      condition: {
        field: 'operation',
        value: ['shopify_create_fulfillment'],
      },
    },
    // Tracking Number
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
    // Tracking Company
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
    // Tracking URL
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
    // Notify Customer (for fulfillment)
    {
      id: 'notifyCustomer',
      title: 'Notify Customer',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_create_fulfillment'],
      },
    },
    {
      id: 'includeInactive',
      title: 'Include Inactive Locations',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['shopify_list_locations'],
      },
    },
    // Collection ID
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
    // Collection Query
    {
      id: 'collectionQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., title:Summer OR collection_type:smart',
      mode: 'advanced',
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
      'shopify_get_collection',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'shopify_list_products'
      },
      params: (params) => {
        const first = parseOptionalNumberInput(params.first, 'first')
        const baseParams: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
          shopDomain: params.shopDomain?.trim(),
        }

        switch (params.operation) {
          // Product Operations
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
              status: params.status,
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
              status: params.status,
            }

          case 'shopify_delete_product':
            if (!params.productId?.trim()) {
              throw new Error('Product ID is required.')
            }
            return {
              ...baseParams,
              productId: params.productId.trim(),
            }

          // Order Operations
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
                parseOptionalBooleanInput(params.refundOriginalPayment) === true
                  ? { originalPaymentMethodsRefund: true }
                  : undefined,
              staffNote: params.staffNote?.trim(),
            }

          // Customer Operations
          case 'shopify_create_customer':
            // At least one of email/phone/firstName/lastName required (validated in tool)
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

          // Inventory Operations
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

          // Location Operations
          case 'shopify_list_locations':
            return {
              ...baseParams,
              first,
              includeInactive: parseOptionalBooleanInput(params.includeInactive),
            }

          // Fulfillment Operations
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

          // Collection Operations
          case 'shopify_list_collections':
            return {
              ...baseParams,
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

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Shopify access token' },
    shopDomain: { type: 'string', description: 'Shopify store domain' },
    // Product inputs
    productId: { type: 'string', description: 'Product ID' },
    title: { type: 'string', description: 'Product title' },
    descriptionHtml: { type: 'string', description: 'Product description (HTML)' },
    productType: { type: 'string', description: 'Product type' },
    vendor: { type: 'string', description: 'Product vendor' },
    tags: { type: 'string', description: 'Tags (comma-separated)' },
    status: { type: 'string', description: 'Product status' },
    productQuery: { type: 'string', description: 'Product search query' },
    first: { type: 'number', description: 'Maximum number of results to return' },
    // Order inputs
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
    // Customer inputs
    customerId: { type: 'string', description: 'Customer ID' },
    customerEmail: { type: 'string', description: 'Customer email' },
    firstName: { type: 'string', description: 'Customer first name' },
    lastName: { type: 'string', description: 'Customer last name' },
    phone: { type: 'string', description: 'Customer phone' },
    customerNote: { type: 'string', description: 'Customer note' },
    customerTags: { type: 'string', description: 'Customer tags' },
    customerQuery: { type: 'string', description: 'Customer search query' },
    // Inventory inputs
    inventoryQuery: { type: 'string', description: 'Inventory search query' },
    inventoryItemId: { type: 'string', description: 'Inventory item ID' },
    locationId: { type: 'string', description: 'Location ID' },
    delta: { type: 'number', description: 'Quantity change' },
    // Fulfillment inputs
    fulfillmentOrderId: { type: 'string', description: 'Fulfillment order ID' },
    trackingNumber: { type: 'string', description: 'Shipment tracking number' },
    trackingCompany: { type: 'string', description: 'Shipping carrier name' },
    trackingUrl: { type: 'string', description: 'Tracking URL' },
    notifyCustomer: { type: 'boolean', description: 'Send shipping notification email' },
    includeInactive: { type: 'boolean', description: 'Include inactive locations in results' },
    // Collection inputs
    collectionId: { type: 'string', description: 'Collection ID' },
    collectionQuery: { type: 'string', description: 'Collection search query' },
    productsFirst: { type: 'number', description: 'Maximum number of products to return' },
  },
  outputs: {
    // Product outputs
    product: {
      type: 'json',
      description:
        'Product details (id, title, handle, descriptionHtml, vendor, productType, tags, status, variants, images)',
    },
    products: {
      type: 'json',
      description: 'List of products with core product fields and media summaries',
    },
    // Order outputs
    order: {
      type: 'json',
      description:
        'Order details or cancellation result depending on the operation (order fields, customer, totals, notes, line items, or cancellation job status)',
    },
    orders: {
      type: 'json',
      description: 'List of orders with status, totals, customer, and shipping summary fields',
    },
    // Customer outputs
    customer: {
      type: 'json',
      description:
        'Customer details (id, email, name, phone, note, tags, amountSpent, addresses, defaultAddress)',
    },
    customers: {
      type: 'json',
      description: 'List of customers with contact details, tags, spend, and default address',
    },
    // Inventory outputs
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
    // Location outputs
    locations: {
      type: 'json',
      description:
        'Store locations with id, name, active status, fulfillment capability, and address',
    },
    // Fulfillment outputs
    fulfillment: {
      type: 'json',
      description:
        'Fulfillment result (id, status, trackingInfo, createdAt, updatedAt, fulfillmentLineItems)',
    },
    // Collection outputs
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
      description: 'Pagination info for list operations (hasNextPage, hasPreviousPage)',
    },
    // Delete outputs
    deletedId: { type: 'string', description: 'ID of deleted resource' },
    // Success indicator
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
