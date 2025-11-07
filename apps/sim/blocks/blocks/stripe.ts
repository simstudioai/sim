import { StripeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { StripeResponse } from '@/tools/stripe/types'
import { getTrigger } from '@/triggers'

export const StripeBlock: BlockConfig<StripeResponse> = {
  type: 'stripe',
  name: 'Stripe',
  description: 'Process payments and manage Stripe data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrates Stripe into the workflow. Manage payment intents, customers, subscriptions, invoices, charges, products, prices, and events. Can be used in trigger mode to trigger a workflow when a Stripe event occurs.',
  docsLink: 'https://docs.sim.ai/tools/stripe',
  category: 'tools',
  bgColor: '#635BFF',
  icon: StripeIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Payment Intents
        { label: 'Create Payment Intent', id: 'create_payment_intent' },
        { label: 'Retrieve Payment Intent', id: 'retrieve_payment_intent' },
        { label: 'Update Payment Intent', id: 'update_payment_intent' },
        { label: 'Confirm Payment Intent', id: 'confirm_payment_intent' },
        { label: 'Capture Payment Intent', id: 'capture_payment_intent' },
        { label: 'Cancel Payment Intent', id: 'cancel_payment_intent' },
        { label: 'List Payment Intents', id: 'list_payment_intents' },
        { label: 'Search Payment Intents', id: 'search_payment_intents' },
        // Customers
        { label: 'Create Customer', id: 'create_customer' },
        { label: 'Retrieve Customer', id: 'retrieve_customer' },
        { label: 'Update Customer', id: 'update_customer' },
        { label: 'Delete Customer', id: 'delete_customer' },
        { label: 'List Customers', id: 'list_customers' },
        { label: 'Search Customers', id: 'search_customers' },
        // Subscriptions
        { label: 'Create Subscription', id: 'create_subscription' },
        { label: 'Retrieve Subscription', id: 'retrieve_subscription' },
        { label: 'Update Subscription', id: 'update_subscription' },
        { label: 'Cancel Subscription', id: 'cancel_subscription' },
        { label: 'Resume Subscription', id: 'resume_subscription' },
        { label: 'List Subscriptions', id: 'list_subscriptions' },
        { label: 'Search Subscriptions', id: 'search_subscriptions' },
        // Invoices
        { label: 'Create Invoice', id: 'create_invoice' },
        { label: 'Retrieve Invoice', id: 'retrieve_invoice' },
        { label: 'Update Invoice', id: 'update_invoice' },
        { label: 'Delete Invoice', id: 'delete_invoice' },
        { label: 'Finalize Invoice', id: 'finalize_invoice' },
        { label: 'Pay Invoice', id: 'pay_invoice' },
        { label: 'Void Invoice', id: 'void_invoice' },
        { label: 'Send Invoice', id: 'send_invoice' },
        { label: 'List Invoices', id: 'list_invoices' },
        { label: 'Search Invoices', id: 'search_invoices' },
        // Charges
        { label: 'Create Charge', id: 'create_charge' },
        { label: 'Retrieve Charge', id: 'retrieve_charge' },
        { label: 'Update Charge', id: 'update_charge' },
        { label: 'Capture Charge', id: 'capture_charge' },
        { label: 'List Charges', id: 'list_charges' },
        { label: 'Search Charges', id: 'search_charges' },
        // Products
        { label: 'Create Product', id: 'create_product' },
        { label: 'Retrieve Product', id: 'retrieve_product' },
        { label: 'Update Product', id: 'update_product' },
        { label: 'Delete Product', id: 'delete_product' },
        { label: 'List Products', id: 'list_products' },
        { label: 'Search Products', id: 'search_products' },
        // Prices
        { label: 'Create Price', id: 'create_price' },
        { label: 'Retrieve Price', id: 'retrieve_price' },
        { label: 'Update Price', id: 'update_price' },
        { label: 'List Prices', id: 'list_prices' },
        { label: 'Search Prices', id: 'search_prices' },
        // Events
        { label: 'Retrieve Event', id: 'retrieve_event' },
        { label: 'List Events', id: 'list_events' },
      ],
      value: () => 'create_payment_intent',
    },
    {
      id: 'apiKey',
      title: 'Stripe API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Stripe secret key (sk_test_... or sk_live_...)',
      required: true,
    },
    // Common ID field for retrieve/update/delete/confirm/capture/cancel operations
    {
      id: 'id',
      title: 'ID',
      type: 'short-input',
      placeholder: 'Enter the ID',
      condition: {
        field: 'operation',
        value: [
          'retrieve_payment_intent',
          'update_payment_intent',
          'confirm_payment_intent',
          'capture_payment_intent',
          'cancel_payment_intent',
          'retrieve_customer',
          'update_customer',
          'delete_customer',
          'retrieve_subscription',
          'update_subscription',
          'cancel_subscription',
          'resume_subscription',
          'retrieve_invoice',
          'update_invoice',
          'delete_invoice',
          'finalize_invoice',
          'pay_invoice',
          'void_invoice',
          'send_invoice',
          'retrieve_charge',
          'update_charge',
          'capture_charge',
          'retrieve_product',
          'update_product',
          'delete_product',
          'retrieve_price',
          'update_price',
          'retrieve_event',
        ],
      },
      required: true,
    },
    // Payment Intent specific fields - CREATE (amount required)
    {
      id: 'amount',
      title: 'Amount (in cents)',
      type: 'short-input',
      placeholder: 'e.g., 1000 for $10.00',
      condition: {
        field: 'operation',
        value: ['create_payment_intent', 'create_charge'],
      },
      required: true,
    },
    // Payment Intent specific fields - UPDATE/CAPTURE (amount optional)
    {
      id: 'amount',
      title: 'Amount (in cents)',
      type: 'short-input',
      placeholder: 'e.g., 1000 for $10.00',
      condition: {
        field: 'operation',
        value: ['update_payment_intent', 'capture_payment_intent', 'capture_charge'],
      },
    },
    // Currency - REQUIRED for create operations
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'e.g., usd, eur, gbp',
      condition: {
        field: 'operation',
        value: ['create_payment_intent', 'create_charge', 'create_price'],
      },
      required: true,
    },
    // Currency - OPTIONAL for update operations
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'e.g., usd, eur, gbp',
      condition: {
        field: 'operation',
        value: ['update_payment_intent'],
      },
    },
    {
      id: 'payment_method',
      title: 'Payment Method ID',
      type: 'short-input',
      placeholder: 'e.g., pm_1234567890',
      condition: {
        field: 'operation',
        value: ['create_payment_intent', 'confirm_payment_intent', 'create_customer'],
      },
    },
    // Customer specific fields - REQUIRED for create_subscription and create_invoice
    {
      id: 'customer',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'e.g., cus_1234567890',
      condition: {
        field: 'operation',
        value: ['create_subscription', 'create_invoice'],
      },
      required: true,
    },
    // Customer specific fields - OPTIONAL for other operations
    {
      id: 'customer',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'e.g., cus_1234567890',
      condition: {
        field: 'operation',
        value: ['create_payment_intent', 'update_payment_intent', 'create_charge', 'list_charges'],
      },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'customer@example.com',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer'],
      },
    },
    // Name - REQUIRED for create_product
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Product Name',
      condition: {
        field: 'operation',
        value: ['create_product'],
      },
      required: true,
    },
    // Name - OPTIONAL for customers and update_product
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Customer or Product Name',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer', 'update_product'],
      },
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: '+1234567890',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer'],
      },
    },
    {
      id: 'address',
      title: 'Address (JSON)',
      type: 'code',
      placeholder: '{"line1": "123 Main St", "city": "New York", "country": "US"}',
      condition: {
        field: 'operation',
        value: ['create_customer', 'update_customer'],
      },
    },
    // Subscription specific fields - REQUIRED for create_subscription
    {
      id: 'items',
      title: 'Items (JSON Array)',
      type: 'code',
      placeholder: '[{"price": "price_1234567890", "quantity": 1}]',
      condition: {
        field: 'operation',
        value: ['create_subscription'],
      },
      required: true,
    },
    // Items - OPTIONAL for update_subscription
    {
      id: 'items',
      title: 'Items (JSON Array)',
      type: 'code',
      placeholder: '[{"price": "price_1234567890", "quantity": 1}]',
      condition: {
        field: 'operation',
        value: ['update_subscription'],
      },
    },
    {
      id: 'trial_period_days',
      title: 'Trial Period (days)',
      type: 'short-input',
      placeholder: 'e.g., 14',
      condition: {
        field: 'operation',
        value: 'create_subscription',
      },
    },
    {
      id: 'default_payment_method',
      title: 'Default Payment Method',
      type: 'short-input',
      placeholder: 'e.g., pm_1234567890',
      condition: {
        field: 'operation',
        value: 'create_subscription',
      },
    },
    {
      id: 'cancel_at_period_end',
      title: 'Cancel at Period End',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['create_subscription', 'update_subscription'],
      },
    },
    // Invoice specific fields
    {
      id: 'collection_method',
      title: 'Collection Method',
      type: 'dropdown',
      options: [
        { label: 'Charge Automatically', id: 'charge_automatically' },
        { label: 'Send Invoice', id: 'send_invoice' },
      ],
      condition: {
        field: 'operation',
        value: 'create_invoice',
      },
    },
    {
      id: 'auto_advance',
      title: 'Auto Advance',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['create_invoice', 'update_invoice', 'finalize_invoice'],
      },
    },
    // Charge specific fields
    {
      id: 'source',
      title: 'Payment Source',
      type: 'short-input',
      placeholder: 'e.g., tok_visa, card ID',
      condition: {
        field: 'operation',
        value: 'create_charge',
      },
    },
    {
      id: 'capture',
      title: 'Capture Immediately',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: 'create_charge',
      },
    },
    // Product specific fields
    {
      id: 'active',
      title: 'Active',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['create_product', 'update_product', 'update_price'],
      },
    },
    {
      id: 'images',
      title: 'Images (JSON Array)',
      type: 'code',
      placeholder: '["https://example.com/image1.jpg", "https://example.com/image2.jpg"]',
      condition: {
        field: 'operation',
        value: ['create_product', 'update_product'],
      },
    },
    // Price specific fields
    {
      id: 'product',
      title: 'Product ID',
      type: 'short-input',
      placeholder: 'e.g., prod_1234567890',
      condition: {
        field: 'operation',
        value: 'create_price',
      },
      required: true,
    },
    {
      id: 'unit_amount',
      title: 'Unit Amount (in cents)',
      type: 'short-input',
      placeholder: 'e.g., 1000 for $10.00',
      condition: {
        field: 'operation',
        value: 'create_price',
      },
    },
    {
      id: 'recurring',
      title: 'Recurring (JSON)',
      type: 'code',
      placeholder: '{"interval": "month", "interval_count": 1}',
      condition: {
        field: 'operation',
        value: 'create_price',
      },
    },
    // Common description field
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter description',
      condition: {
        field: 'operation',
        value: [
          'create_payment_intent',
          'update_payment_intent',
          'create_customer',
          'update_customer',
          'create_invoice',
          'update_invoice',
          'create_charge',
          'update_charge',
          'create_product',
          'update_product',
        ],
      },
    },
    // Common metadata field
    {
      id: 'metadata',
      title: 'Metadata (JSON)',
      type: 'code',
      placeholder: '{"key1": "value1", "key2": "value2"}',
      condition: {
        field: 'operation',
        value: [
          'create_payment_intent',
          'update_payment_intent',
          'create_customer',
          'update_customer',
          'create_subscription',
          'update_subscription',
          'create_invoice',
          'update_invoice',
          'create_charge',
          'update_charge',
          'create_product',
          'update_product',
          'create_price',
          'update_price',
        ],
      },
    },
    // List/Search common fields
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (default: 10)',
      condition: {
        field: 'operation',
        value: [
          'list_payment_intents',
          'list_customers',
          'list_subscriptions',
          'list_invoices',
          'list_charges',
          'list_products',
          'list_prices',
          'list_events',
          'search_payment_intents',
          'search_customers',
          'search_subscriptions',
          'search_invoices',
          'search_charges',
          'search_products',
          'search_prices',
        ],
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter Stripe search query',
      condition: {
        field: 'operation',
        value: [
          'search_payment_intents',
          'search_customers',
          'search_subscriptions',
          'search_invoices',
          'search_charges',
          'search_products',
          'search_prices',
        ],
      },
      required: true,
    },
    // Additional filters for specific list operations
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'e.g., succeeded, pending',
      condition: {
        field: 'operation',
        value: ['list_subscriptions', 'list_invoices'],
      },
    },
    {
      id: 'receipt_email',
      title: 'Receipt Email',
      type: 'short-input',
      placeholder: 'customer@example.com',
      condition: {
        field: 'operation',
        value: 'create_payment_intent',
      },
    },
    {
      id: 'cancellation_reason',
      title: 'Cancellation Reason',
      type: 'short-input',
      placeholder: 'e.g., requested_by_customer',
      condition: {
        field: 'operation',
        value: 'cancel_payment_intent',
      },
    },
    {
      id: 'amount_to_capture',
      title: 'Amount to Capture (in cents)',
      type: 'short-input',
      placeholder: 'Leave empty to capture full amount',
      condition: {
        field: 'operation',
        value: 'capture_payment_intent',
      },
    },
    {
      id: 'prorate',
      title: 'Prorate',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: 'cancel_subscription',
      },
    },
    {
      id: 'invoice_now',
      title: 'Invoice Now',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: 'cancel_subscription',
      },
    },
    {
      id: 'paid_out_of_band',
      title: 'Paid Out of Band',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: 'pay_invoice',
      },
    },
    {
      id: 'type',
      title: 'Event Type',
      type: 'short-input',
      placeholder: 'e.g., payment_intent.succeeded',
      condition: {
        field: 'operation',
        value: 'list_events',
      },
    },
    ...getTrigger('stripe_webhook').subBlocks,
  ],
  tools: {
    access: [
      // Payment Intents
      'stripe_create_payment_intent',
      'stripe_retrieve_payment_intent',
      'stripe_update_payment_intent',
      'stripe_confirm_payment_intent',
      'stripe_capture_payment_intent',
      'stripe_cancel_payment_intent',
      'stripe_list_payment_intents',
      'stripe_search_payment_intents',
      // Customers
      'stripe_create_customer',
      'stripe_retrieve_customer',
      'stripe_update_customer',
      'stripe_delete_customer',
      'stripe_list_customers',
      'stripe_search_customers',
      // Subscriptions
      'stripe_create_subscription',
      'stripe_retrieve_subscription',
      'stripe_update_subscription',
      'stripe_cancel_subscription',
      'stripe_resume_subscription',
      'stripe_list_subscriptions',
      'stripe_search_subscriptions',
      // Invoices
      'stripe_create_invoice',
      'stripe_retrieve_invoice',
      'stripe_update_invoice',
      'stripe_delete_invoice',
      'stripe_finalize_invoice',
      'stripe_pay_invoice',
      'stripe_void_invoice',
      'stripe_send_invoice',
      'stripe_list_invoices',
      'stripe_search_invoices',
      // Charges
      'stripe_create_charge',
      'stripe_retrieve_charge',
      'stripe_update_charge',
      'stripe_capture_charge',
      'stripe_list_charges',
      'stripe_search_charges',
      // Products
      'stripe_create_product',
      'stripe_retrieve_product',
      'stripe_update_product',
      'stripe_delete_product',
      'stripe_list_products',
      'stripe_search_products',
      // Prices
      'stripe_create_price',
      'stripe_retrieve_price',
      'stripe_update_price',
      'stripe_list_prices',
      'stripe_search_prices',
      // Events
      'stripe_retrieve_event',
      'stripe_list_events',
    ],
    config: {
      tool: (params) => {
        return `stripe_${params.operation}`
      },
      params: (params) => {
        const {
          operation,
          apiKey,
          address,
          metadata,
          items,
          images,
          recurring,
          cancel_at_period_end,
          auto_advance,
          capture,
          active,
          prorate,
          invoice_now,
          paid_out_of_band,
          ...rest
        } = params

        // Parse JSON fields
        let parsedAddress: any | undefined
        let parsedMetadata: any | undefined
        let parsedItems: any | undefined
        let parsedImages: any | undefined
        let parsedRecurring: any | undefined

        try {
          if (address) parsedAddress = JSON.parse(address)
          if (metadata) parsedMetadata = JSON.parse(metadata)
          if (items) parsedItems = JSON.parse(items)
          if (images) parsedImages = JSON.parse(images)
          if (recurring) parsedRecurring = JSON.parse(recurring)
        } catch (error: any) {
          throw new Error(`Invalid JSON input: ${error.message}`)
        }

        // Convert string booleans to actual booleans
        const parsedBooleans: Record<string, boolean | undefined> = {}
        if (cancel_at_period_end !== undefined)
          parsedBooleans.cancel_at_period_end = cancel_at_period_end === 'true'
        if (auto_advance !== undefined) parsedBooleans.auto_advance = auto_advance === 'true'
        if (capture !== undefined) parsedBooleans.capture = capture === 'true'
        if (active !== undefined) parsedBooleans.active = active === 'true'
        if (prorate !== undefined) parsedBooleans.prorate = prorate === 'true'
        if (invoice_now !== undefined) parsedBooleans.invoice_now = invoice_now === 'true'
        if (paid_out_of_band !== undefined)
          parsedBooleans.paid_out_of_band = paid_out_of_band === 'true'

        return {
          apiKey,
          ...rest,
          ...(parsedAddress && { address: parsedAddress }),
          ...(parsedMetadata && { metadata: parsedMetadata }),
          ...(parsedItems && { items: parsedItems }),
          ...(parsedImages && { images: parsedImages }),
          ...(parsedRecurring && { recurring: parsedRecurring }),
          ...parsedBooleans,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Stripe secret API key' },
    // Common inputs
    id: { type: 'string', description: 'Resource ID' },
    amount: { type: 'number', description: 'Amount in cents' },
    currency: { type: 'string', description: 'Three-letter ISO currency code' },
    description: { type: 'string', description: 'Description of the resource' },
    metadata: { type: 'json', description: 'Set of key-value pairs' },
    // Customer inputs
    customer: { type: 'string', description: 'Customer ID' },
    email: { type: 'string', description: 'Customer email address' },
    name: { type: 'string', description: 'Customer or product name' },
    phone: { type: 'string', description: 'Customer phone number' },
    address: { type: 'json', description: 'Customer address object' },
    // Payment inputs
    payment_method: { type: 'string', description: 'Payment method ID' },
    source: { type: 'string', description: 'Payment source' },
    receipt_email: { type: 'string', description: 'Email for receipt' },
    // Subscription inputs
    items: { type: 'json', description: 'Subscription items array' },
    trial_period_days: { type: 'number', description: 'Trial period in days' },
    cancel_at_period_end: { type: 'boolean', description: 'Cancel at period end' },
    prorate: { type: 'boolean', description: 'Prorate cancellation' },
    invoice_now: { type: 'boolean', description: 'Invoice immediately' },
    // Invoice inputs
    collection_method: { type: 'string', description: 'Collection method' },
    auto_advance: { type: 'boolean', description: 'Auto-finalize invoice' },
    paid_out_of_band: { type: 'boolean', description: 'Paid outside Stripe' },
    // Charge inputs
    capture: { type: 'boolean', description: 'Capture immediately' },
    amount_to_capture: { type: 'number', description: 'Amount to capture in cents' },
    cancellation_reason: { type: 'string', description: 'Cancellation reason' },
    // Product inputs
    active: { type: 'boolean', description: 'Whether resource is active' },
    images: { type: 'json', description: 'Product images array' },
    // Price inputs
    product: { type: 'string', description: 'Product ID' },
    unit_amount: { type: 'number', description: 'Unit amount in cents' },
    recurring: { type: 'json', description: 'Recurring billing configuration' },
    // List/Search inputs
    limit: { type: 'number', description: 'Maximum results to return' },
    query: { type: 'string', description: 'Search query' },
    status: { type: 'string', description: 'Status filter' },
    type: { type: 'string', description: 'Event type filter' },
  },
  outputs: {
    // Payment Intent outputs
    payment_intent: { type: 'json', description: 'Payment intent object' },
    payment_intents: { type: 'json', description: 'Array of payment intents' },
    // Customer outputs
    customer: { type: 'json', description: 'Customer object' },
    customers: { type: 'json', description: 'Array of customers' },
    // Subscription outputs
    subscription: { type: 'json', description: 'Subscription object' },
    subscriptions: { type: 'json', description: 'Array of subscriptions' },
    // Invoice outputs
    invoice: { type: 'json', description: 'Invoice object' },
    invoices: { type: 'json', description: 'Array of invoices' },
    // Charge outputs
    charge: { type: 'json', description: 'Charge object' },
    charges: { type: 'json', description: 'Array of charges' },
    // Product outputs
    product: { type: 'json', description: 'Product object' },
    products: { type: 'json', description: 'Array of products' },
    // Price outputs
    price: { type: 'json', description: 'Price object' },
    prices: { type: 'json', description: 'Array of prices' },
    // Event outputs
    event: { type: 'json', description: 'Event object' },
    events: { type: 'json', description: 'Array of events' },
    // Common outputs
    metadata: { type: 'json', description: 'Operation metadata' },
    deleted: { type: 'boolean', description: 'Whether resource was deleted' },
  },
  triggers: {
    enabled: true,
    available: ['stripe_webhook'],
  },
}
