import { SquareIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SquareResponse } from '@/tools/square/types'

export const SquareBlock: BlockConfig<SquareResponse> = {
  type: 'square',
  name: 'Square',
  description: 'Process payments and manage Square commerce data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Square into the workflow. Take and refund payments, manage customers, build catalog items and images, create and search orders, and issue invoices. Authenticate with a Square access token (personal access token).',
  docsLink: 'https://docs.sim.ai/integrations/square',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  bgColor: '#000000',
  icon: SquareIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Payments
        { label: 'Create Payment', id: 'create_payment' },
        { label: 'Get Payment', id: 'get_payment' },
        { label: 'List Payments', id: 'list_payments' },
        { label: 'Cancel Payment', id: 'cancel_payment' },
        { label: 'Complete Payment', id: 'complete_payment' },
        // Refunds
        { label: 'Refund Payment', id: 'refund_payment' },
        { label: 'Get Refund', id: 'get_refund' },
        { label: 'List Refunds', id: 'list_refunds' },
        // Customers
        { label: 'Create Customer', id: 'create_customer' },
        { label: 'Get Customer', id: 'get_customer' },
        { label: 'List Customers', id: 'list_customers' },
        { label: 'Search Customers', id: 'search_customers' },
        { label: 'Update Customer', id: 'update_customer' },
        { label: 'Delete Customer', id: 'delete_customer' },
        // Locations
        { label: 'List Locations', id: 'list_locations' },
        { label: 'Get Location', id: 'get_location' },
        // Orders
        { label: 'Create Order', id: 'create_order' },
        { label: 'Get Order', id: 'get_order' },
        { label: 'Search Orders', id: 'search_orders' },
        { label: 'Pay Order', id: 'pay_order' },
        // Invoices
        { label: 'Create Invoice', id: 'create_invoice' },
        { label: 'Get Invoice', id: 'get_invoice' },
        { label: 'List Invoices', id: 'list_invoices' },
        { label: 'Search Invoices', id: 'search_invoices' },
        { label: 'Publish Invoice', id: 'publish_invoice' },
        { label: 'Cancel Invoice', id: 'cancel_invoice' },
        { label: 'Delete Invoice', id: 'delete_invoice' },
        // Catalog
        { label: 'Upsert Catalog Object', id: 'upsert_catalog_object' },
        { label: 'Get Catalog Object', id: 'get_catalog_object' },
        { label: 'List Catalog', id: 'list_catalog' },
        { label: 'Search Catalog Objects', id: 'search_catalog_objects' },
        { label: 'Create Catalog Image', id: 'create_catalog_image' },
        { label: 'Delete Catalog Object', id: 'delete_catalog_object' },
        // Inventory
        { label: 'Batch Retrieve Inventory Counts', id: 'batch_retrieve_inventory_counts' },
      ],
      value: () => 'create_payment',
    },
    {
      id: 'apiKey',
      title: 'Square Access Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Square access token',
      required: true,
    },

    // Payments
    {
      id: 'sourceId',
      title: 'Source ID',
      type: 'short-input',
      placeholder: 'Card nonce, card-on-file ID, or wallet token',
      condition: { field: 'operation', value: 'create_payment' },
      required: { field: 'operation', value: 'create_payment' },
    },
    {
      id: 'paymentId',
      title: 'Payment ID',
      type: 'short-input',
      placeholder: 'Square payment ID',
      condition: {
        field: 'operation',
        value: ['get_payment', 'refund_payment', 'cancel_payment', 'complete_payment'],
      },
      required: {
        field: 'operation',
        value: ['get_payment', 'refund_payment', 'cancel_payment', 'complete_payment'],
      },
    },
    {
      id: 'refundId',
      title: 'Refund ID',
      type: 'short-input',
      placeholder: 'Square refund ID',
      condition: { field: 'operation', value: 'get_refund' },
      required: { field: 'operation', value: 'get_refund' },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Filter by status (e.g. COMPLETED)',
      condition: { field: 'operation', value: 'list_refunds' },
      mode: 'advanced',
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: 'Smallest denomination (e.g. 1000 for $10.00)',
      condition: { field: 'operation', value: ['create_payment', 'refund_payment'] },
      required: { field: 'operation', value: ['create_payment', 'refund_payment'] },
    },
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'ISO 4217 code (e.g. USD)',
      condition: { field: 'operation', value: ['create_payment', 'refund_payment'] },
      required: { field: 'operation', value: ['create_payment', 'refund_payment'] },
    },
    {
      id: 'reason',
      title: 'Refund Reason',
      type: 'short-input',
      placeholder: 'Reason for the refund',
      condition: { field: 'operation', value: 'refund_payment' },
    },
    {
      id: 'versionToken',
      title: 'Version Token',
      type: 'short-input',
      placeholder: 'Optional version token for concurrency control',
      condition: { field: 'operation', value: 'complete_payment' },
      mode: 'advanced',
    },
    {
      id: 'autocomplete',
      title: 'Capture Immediately',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'create_payment' },
      mode: 'advanced',
    },
    {
      id: 'beginTime',
      title: 'Begin Time',
      type: 'short-input',
      placeholder: 'RFC 3339 timestamp',
      condition: { field: 'operation', value: ['list_payments', 'list_refunds'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an RFC 3339 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'RFC 3339 timestamp',
      condition: { field: 'operation', value: ['list_payments', 'list_refunds'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an RFC 3339 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },

    // Customers
    {
      id: 'customerId',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'Square customer ID',
      condition: {
        field: 'operation',
        value: ['create_payment', 'get_customer', 'update_customer', 'delete_customer'],
      },
      required: {
        field: 'operation',
        value: ['get_customer', 'update_customer', 'delete_customer'],
      },
    },
    {
      id: 'givenName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Customer first name',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
    },
    {
      id: 'familyName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Customer last name',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
    },
    {
      id: 'companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Customer business name',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
      mode: 'advanced',
    },
    {
      id: 'nickname',
      title: 'Nickname',
      type: 'short-input',
      placeholder: 'Customer nickname',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
      mode: 'advanced',
    },
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'customer@example.com',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+15551234567',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
      mode: 'advanced',
    },
    {
      id: 'birthday',
      title: 'Birthday',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD or MM-DD',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
      mode: 'advanced',
    },
    {
      id: 'address',
      title: 'Address (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{"address_line_1": "123 Main St", "locality": "New York", "country": "US"}',
      condition: { field: 'operation', value: ['create_customer', 'update_customer'] },
      mode: 'advanced',
    },
    {
      id: 'sortField',
      title: 'Sort Field',
      type: 'dropdown',
      options: [
        { label: 'Default', id: 'DEFAULT' },
        { label: 'Created At', id: 'CREATED_AT' },
      ],
      condition: { field: 'operation', value: 'list_customers' },
      mode: 'advanced',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'ASC' },
        { label: 'Descending', id: 'DESC' },
      ],
      condition: { field: 'operation', value: 'list_customers' },
      mode: 'advanced',
    },

    // Shared note / reference (payments + customers)
    {
      id: 'note',
      title: 'Note',
      type: 'long-input',
      placeholder: 'Optional note',
      condition: {
        field: 'operation',
        value: ['create_payment', 'create_customer', 'update_customer'],
      },
      mode: 'advanced',
    },
    {
      id: 'referenceId',
      title: 'Reference ID',
      type: 'short-input',
      placeholder: 'Optional external reference',
      condition: {
        field: 'operation',
        value: ['create_payment', 'create_customer', 'update_customer'],
      },
      mode: 'advanced',
    },

    // Search query — shared across the three search operations. The placeholder
    // stays schema-neutral (each endpoint expects a different query shape) and
    // the examples for each are spelled out in the wand prompt.
    {
      id: 'query',
      title: 'Query (JSON)',
      type: 'code',
      language: 'json',
      placeholder: 'Square search query JSON for the selected operation',
      condition: {
        field: 'operation',
        value: ['search_customers', 'search_orders', 'search_catalog_objects'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Square search query JSON object for the selected operation. For Search Customers use a filter like {"filter":{"email_address":{"exact":"a@b.com"}}}; for Search Orders use {"filter":{"state_filter":{"states":["OPEN"]}}}; for Search Catalog Objects use {"text_query":{"keywords":["coffee"]}}. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },

    // Orders
    {
      id: 'order',
      title: 'Order (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{"location_id": "L123", "line_items": [{"name": "Coffee", "quantity": "1", "base_price_money": {"amount": 250, "currency": "USD"}}]}',
      condition: { field: 'operation', value: 'create_order' },
      required: { field: 'operation', value: 'create_order' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Square order JSON object with a location_id and line_items. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'orderId',
      title: 'Order ID',
      type: 'short-input',
      placeholder: 'Square order ID',
      condition: { field: 'operation', value: ['create_payment', 'get_order', 'pay_order'] },
      required: { field: 'operation', value: ['get_order', 'pay_order'] },
    },
    {
      id: 'paymentIds',
      title: 'Payment IDs (JSON Array)',
      type: 'code',
      language: 'json',
      placeholder: '["paymentId1", "paymentId2"]',
      condition: { field: 'operation', value: 'pay_order' },
      mode: 'advanced',
    },
    {
      id: 'orderVersion',
      title: 'Order Version',
      type: 'short-input',
      placeholder: 'Current order version',
      condition: { field: 'operation', value: 'pay_order' },
      mode: 'advanced',
    },
    {
      id: 'locationIds',
      title: 'Location IDs (JSON Array)',
      type: 'code',
      language: 'json',
      placeholder: '["L123", "L456"]',
      condition: {
        field: 'operation',
        value: ['search_orders', 'batch_retrieve_inventory_counts'],
      },
      required: { field: 'operation', value: 'search_orders' },
    },

    // Invoices
    {
      id: 'invoice',
      title: 'Invoice (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{"location_id": "L123", "order_id": "O123", "primary_recipient": {"customer_id": "C123"}, "payment_requests": [{"request_type": "BALANCE"}]}',
      condition: { field: 'operation', value: 'create_invoice' },
      required: { field: 'operation', value: 'create_invoice' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Square invoice JSON object with location_id, order_id, primary_recipient, and payment_requests. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'invoiceId',
      title: 'Invoice ID',
      type: 'short-input',
      placeholder: 'Square invoice ID',
      condition: {
        field: 'operation',
        value: ['get_invoice', 'publish_invoice', 'cancel_invoice', 'delete_invoice'],
      },
      required: {
        field: 'operation',
        value: ['get_invoice', 'publish_invoice', 'cancel_invoice', 'delete_invoice'],
      },
    },
    {
      id: 'version',
      title: 'Invoice Version',
      type: 'short-input',
      placeholder: 'Current invoice version (e.g. 0)',
      condition: {
        field: 'operation',
        value: ['publish_invoice', 'cancel_invoice', 'delete_invoice'],
      },
      required: { field: 'operation', value: ['publish_invoice', 'cancel_invoice'] },
    },

    // Catalog
    {
      id: 'object',
      title: 'Catalog Object (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{"type": "ITEM", "id": "#Coffee", "item_data": {"name": "Coffee"}}',
      condition: { field: 'operation', value: 'upsert_catalog_object' },
      required: { field: 'operation', value: 'upsert_catalog_object' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Square catalog object JSON for upsert. Use a temporary id like "#Name" for new objects. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'objectId',
      title: 'Catalog Object ID',
      type: 'short-input',
      placeholder: 'Square catalog object ID',
      condition: {
        field: 'operation',
        value: ['get_catalog_object', 'create_catalog_image', 'delete_catalog_object'],
      },
      required: { field: 'operation', value: ['get_catalog_object', 'delete_catalog_object'] },
    },
    {
      id: 'catalogObjectIds',
      title: 'Catalog Object IDs (JSON Array)',
      type: 'code',
      language: 'json',
      placeholder: '["variationId1", "variationId2"]',
      condition: { field: 'operation', value: 'batch_retrieve_inventory_counts' },
      mode: 'advanced',
    },
    {
      id: 'states',
      title: 'Inventory States (JSON Array)',
      type: 'code',
      language: 'json',
      placeholder: '["IN_STOCK", "SOLD"]',
      condition: { field: 'operation', value: 'batch_retrieve_inventory_counts' },
      mode: 'advanced',
    },
    {
      id: 'updatedAfter',
      title: 'Updated After',
      type: 'short-input',
      placeholder: 'RFC 3339 timestamp',
      condition: { field: 'operation', value: 'batch_retrieve_inventory_counts' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an RFC 3339 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'includeRelatedObjects',
      title: 'Include Related Objects',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'get_catalog_object' },
      mode: 'advanced',
    },
    {
      id: 'types',
      title: 'Types',
      type: 'short-input',
      placeholder: 'Comma-separated (e.g. ITEM,CATEGORY)',
      condition: { field: 'operation', value: 'list_catalog' },
      mode: 'advanced',
    },
    {
      id: 'objectTypes',
      title: 'Object Types (JSON Array)',
      type: 'code',
      language: 'json',
      placeholder: '["ITEM", "CATEGORY"]',
      condition: { field: 'operation', value: 'search_catalog_objects' },
      mode: 'advanced',
    },

    // Catalog image upload (file)
    {
      id: 'uploadFile',
      title: 'Image File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload an image',
      acceptedTypes: 'image/*',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: 'create_catalog_image' },
      required: { field: 'operation', value: 'create_catalog_image' },
    },
    {
      id: 'fileRef',
      title: 'Image File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference an image from previous blocks',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_catalog_image' },
      required: { field: 'operation', value: 'create_catalog_image' },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional filename override',
      condition: { field: 'operation', value: 'create_catalog_image' },
      mode: 'advanced',
    },
    {
      id: 'caption',
      title: 'Caption',
      type: 'short-input',
      placeholder: 'Image caption (alt text)',
      condition: { field: 'operation', value: 'create_catalog_image' },
    },

    // Shared pagination (list / search)
    {
      id: 'locationId',
      title: 'Location ID',
      type: 'short-input',
      placeholder: 'Square location ID',
      condition: {
        field: 'operation',
        value: [
          'create_payment',
          'list_payments',
          'list_invoices',
          'search_invoices',
          'list_refunds',
          'get_location',
        ],
      },
      required: { field: 'operation', value: ['list_invoices', 'search_invoices', 'get_location'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results per page',
      condition: {
        field: 'operation',
        value: [
          'list_payments',
          'list_refunds',
          'list_customers',
          'search_customers',
          'search_orders',
          'list_invoices',
          'search_invoices',
          'search_catalog_objects',
          'batch_retrieve_inventory_counts',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous response',
      condition: {
        field: 'operation',
        value: [
          'list_payments',
          'list_refunds',
          'list_customers',
          'search_customers',
          'search_orders',
          'list_invoices',
          'search_invoices',
          'search_catalog_objects',
          'list_catalog',
          'batch_retrieve_inventory_counts',
        ],
      },
      mode: 'advanced',
    },

    // Idempotency (create-style operations)
    {
      id: 'idempotencyKey',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'Optional unique key (auto-generated if omitted)',
      condition: {
        field: 'operation',
        value: [
          'create_payment',
          'refund_payment',
          'create_customer',
          'create_order',
          'pay_order',
          'create_invoice',
          'publish_invoice',
          'upsert_catalog_object',
          'create_catalog_image',
        ],
      },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'square_create_payment',
      'square_get_payment',
      'square_list_payments',
      'square_cancel_payment',
      'square_complete_payment',
      'square_refund_payment',
      'square_get_refund',
      'square_list_refunds',
      'square_create_customer',
      'square_get_customer',
      'square_list_customers',
      'square_search_customers',
      'square_update_customer',
      'square_delete_customer',
      'square_list_locations',
      'square_get_location',
      'square_create_order',
      'square_get_order',
      'square_search_orders',
      'square_pay_order',
      'square_create_invoice',
      'square_get_invoice',
      'square_list_invoices',
      'square_search_invoices',
      'square_publish_invoice',
      'square_cancel_invoice',
      'square_delete_invoice',
      'square_upsert_catalog_object',
      'square_get_catalog_object',
      'square_list_catalog',
      'square_search_catalog_objects',
      'square_create_catalog_image',
      'square_delete_catalog_object',
      'square_batch_retrieve_inventory_counts',
    ],
    config: {
      tool: (params) => `square_${params.operation}`,
      params: (params) => {
        const {
          operation,
          address,
          query,
          order,
          invoice,
          object,
          locationIds,
          objectTypes,
          paymentIds,
          catalogObjectIds,
          states,
          amount,
          limit,
          version,
          orderVersion,
          autocomplete,
          includeRelatedObjects,
          ...rest
        } = params

        // The basic/advanced image inputs are collapsed into the canonical `file`
        // param before this runs, so normalize from params.file.
        const normalizedFile = normalizeFileInput(params.file, { single: true })

        // Parse a JSON-typed input, naming the field in any error so the user
        // knows exactly which input to fix, and validating the parsed shape so a
        // valid-but-wrong-type value (e.g. a string where an array is expected)
        // fails locally instead of as a confusing Square API error.
        const parseJsonField = (
          value: unknown,
          field: string,
          expected: 'object' | 'array'
        ): unknown => {
          if (value === undefined || value === null || value === '') return undefined
          let parsed: unknown = value
          if (typeof value === 'string') {
            try {
              parsed = JSON.parse(value)
            } catch (error) {
              throw new Error(
                `Invalid JSON in "${field}": ${error instanceof Error ? error.message : 'unknown error'}`
              )
            }
          }
          if (expected === 'array' && !Array.isArray(parsed)) {
            throw new Error(`"${field}" must be a JSON array`)
          }
          if (
            expected === 'object' &&
            (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
          ) {
            throw new Error(`"${field}" must be a JSON object`)
          }
          return parsed
        }

        const parsedAddress = parseJsonField(address, 'address', 'object')
        const parsedQuery = parseJsonField(query, 'query', 'object')
        const parsedOrder = parseJsonField(order, 'order', 'object')
        const parsedInvoice = parseJsonField(invoice, 'invoice', 'object')
        const parsedObject = parseJsonField(object, 'object', 'object')
        const parsedLocationIds = parseJsonField(locationIds, 'locationIds', 'array')
        const parsedObjectTypes = parseJsonField(objectTypes, 'objectTypes', 'array')
        const parsedPaymentIds = parseJsonField(paymentIds, 'paymentIds', 'array')
        const parsedCatalogObjectIds = parseJsonField(catalogObjectIds, 'catalogObjectIds', 'array')
        const parsedStates = parseJsonField(states, 'states', 'array')

        // Coerce a numeric input, failing locally with a clear message rather than
        // forwarding NaN to Square when the value is non-numeric.
        const coerceNumber = (value: unknown, field: string): number | undefined => {
          if (value === undefined || value === null || value === '') return undefined
          const num = Number(value)
          if (!Number.isFinite(num)) {
            throw new Error(`"${field}" must be a valid number`)
          }
          return num
        }

        // Accept both the dropdown's string values and real booleans (which can
        // arrive via connected blocks or templated inputs).
        const coerceBoolean = (value: unknown): boolean => value === true || value === 'true'

        const coercedAmount = coerceNumber(amount, 'amount')
        const coercedLimit = coerceNumber(limit, 'limit')
        const coercedVersion = coerceNumber(version, 'version')
        const coercedOrderVersion = coerceNumber(orderVersion, 'orderVersion')

        return {
          ...rest,
          ...(normalizedFile && { file: normalizedFile }),
          ...(parsedAddress !== undefined && { address: parsedAddress }),
          ...(parsedQuery !== undefined && { query: parsedQuery }),
          ...(parsedOrder !== undefined && { order: parsedOrder }),
          ...(parsedInvoice !== undefined && { invoice: parsedInvoice }),
          ...(parsedObject !== undefined && { object: parsedObject }),
          ...(parsedLocationIds !== undefined && { locationIds: parsedLocationIds }),
          ...(parsedObjectTypes !== undefined && { objectTypes: parsedObjectTypes }),
          ...(parsedPaymentIds !== undefined && { paymentIds: parsedPaymentIds }),
          ...(parsedCatalogObjectIds !== undefined && { catalogObjectIds: parsedCatalogObjectIds }),
          ...(parsedStates !== undefined && { states: parsedStates }),
          ...(coercedAmount !== undefined && { amount: coercedAmount }),
          ...(coercedLimit !== undefined && { limit: coercedLimit }),
          ...(coercedVersion !== undefined && { version: coercedVersion }),
          ...(coercedOrderVersion !== undefined && { orderVersion: coercedOrderVersion }),
          ...(autocomplete !== undefined && { autocomplete: coerceBoolean(autocomplete) }),
          ...(includeRelatedObjects !== undefined && {
            includeRelatedObjects: coerceBoolean(includeRelatedObjects),
          }),
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Square access token' },
    sourceId: { type: 'string', description: 'Payment source ID' },
    paymentId: { type: 'string', description: 'Payment ID' },
    refundId: { type: 'string', description: 'Refund ID' },
    status: { type: 'string', description: 'Status filter' },
    amount: { type: 'number', description: 'Amount in smallest currency denomination' },
    currency: { type: 'string', description: 'ISO 4217 currency code' },
    reason: { type: 'string', description: 'Refund reason' },
    versionToken: { type: 'string', description: 'Version token for payment concurrency control' },
    autocomplete: { type: 'boolean', description: 'Capture payment immediately' },
    beginTime: { type: 'string', description: 'Start of the reporting period (RFC 3339)' },
    endTime: { type: 'string', description: 'End of the reporting period (RFC 3339)' },
    customerId: { type: 'string', description: 'Customer ID' },
    givenName: { type: 'string', description: 'Customer first name' },
    familyName: { type: 'string', description: 'Customer last name' },
    companyName: { type: 'string', description: 'Customer company name' },
    nickname: { type: 'string', description: 'Customer nickname' },
    emailAddress: { type: 'string', description: 'Customer email address' },
    phoneNumber: { type: 'string', description: 'Customer phone number' },
    birthday: { type: 'string', description: 'Customer birthday (YYYY-MM-DD or MM-DD)' },
    address: { type: 'json', description: 'Customer address object' },
    note: { type: 'string', description: 'Note' },
    referenceId: { type: 'string', description: 'External reference ID' },
    sortField: { type: 'string', description: 'Field to sort by' },
    sortOrder: { type: 'string', description: 'Sort order (ASC or DESC)' },
    query: { type: 'json', description: 'Search query object' },
    order: { type: 'json', description: 'Order object' },
    orderId: { type: 'string', description: 'Order ID' },
    orderVersion: { type: 'number', description: 'Order version for payment' },
    paymentIds: { type: 'json', description: 'Array of payment IDs to apply to an order' },
    locationIds: { type: 'json', description: 'Array of location IDs' },
    invoice: { type: 'json', description: 'Invoice object' },
    invoiceId: { type: 'string', description: 'Invoice ID' },
    version: { type: 'number', description: 'Invoice version' },
    object: { type: 'json', description: 'Catalog object' },
    objectId: { type: 'string', description: 'Catalog object ID' },
    includeRelatedObjects: { type: 'boolean', description: 'Include related catalog objects' },
    types: { type: 'string', description: 'Comma-separated catalog object types' },
    objectTypes: { type: 'json', description: 'Array of catalog object types to search' },
    catalogObjectIds: { type: 'json', description: 'Array of catalog object IDs for inventory' },
    states: { type: 'json', description: 'Array of inventory states to filter by' },
    updatedAfter: {
      type: 'string',
      description: 'Only return inventory counts updated after this time',
    },
    file: { type: 'json', description: 'Image file to upload (canonical param)' },
    fileName: { type: 'string', description: 'Filename override for the image' },
    caption: { type: 'string', description: 'Image caption' },
    locationId: { type: 'string', description: 'Location ID' },
    limit: { type: 'number', description: 'Maximum results to return' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    idempotencyKey: { type: 'string', description: 'Idempotency key' },
  },

  outputs: {
    payment: { type: 'json', description: 'Payment object' },
    payments: { type: 'json', description: 'Array of payment objects' },
    refund: { type: 'json', description: 'Refund object' },
    refunds: { type: 'json', description: 'Array of refund objects' },
    customer: { type: 'json', description: 'Customer object' },
    customers: { type: 'json', description: 'Array of customer objects' },
    location: { type: 'json', description: 'Location object' },
    locations: { type: 'json', description: 'Array of location objects' },
    order: { type: 'json', description: 'Order object' },
    orders: { type: 'json', description: 'Array of order objects' },
    invoice: { type: 'json', description: 'Invoice object' },
    invoices: { type: 'json', description: 'Array of invoice objects' },
    object: { type: 'json', description: 'Catalog object' },
    objects: { type: 'json', description: 'Array of catalog objects' },
    counts: { type: 'json', description: 'Array of inventory count objects' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    deleted_object_ids: { type: 'json', description: 'IDs of deleted catalog objects' },
    deleted_at: { type: 'string', description: 'Timestamp when deletion occurred' },
    id: { type: 'string', description: 'ID of the affected resource' },
    metadata: { type: 'json', description: 'Operation summary metadata' },
  },
}

export const SquareBlockMeta = {
  tags: ['payments', 'subscriptions', 'automation'],
  url: 'https://squareup.com',
  templates: [
    {
      icon: SquareIcon,
      title: 'Daily sales summary',
      prompt:
        'Build a scheduled daily workflow that lists Square payments from the previous day across all locations, totals gross sales, refunds, and net revenue, writes the figures to a table for historical tracking, and posts a Slack summary with day-over-day trends.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting', 'founder'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SquareIcon,
      title: 'Refund pattern monitor',
      prompt:
        'Create a scheduled weekly workflow that lists Square payments and their refunds, classifies each refund by reason and location, flags any location with an unusually high refund rate, and emails finance a narrative report with recommended actions.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SquareIcon,
      title: 'New customer welcome',
      prompt:
        'Build a workflow that takes a new Square customer, creates a welcome email tailored to their purchase, adds them to an onboarding tracking table, and posts a notification to the customer success Slack channel.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['gmail', 'slack'],
    },
    {
      icon: SquareIcon,
      title: 'Invoice chase automation',
      prompt:
        'Create a scheduled workflow that lists Square invoices for a location, finds those that are unpaid past their due date, sends a polite reminder email per customer, and logs every chase action to a collections table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SquareIcon,
      title: 'Catalog image enrichment',
      prompt:
        'Build a workflow that lists Square catalog items missing images, generates a product image for each one, uploads it as a catalog image attached to the item, and writes a report of which items were updated.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'automation'],
    },
    {
      icon: SquareIcon,
      title: 'Low-stock reorder alerts',
      prompt:
        'Create a scheduled workflow that lists the Square catalog, identifies items flagged as low or out of stock, drafts a reorder summary grouped by supplier, and posts it to a Slack purchasing channel with the items and quantities to reorder.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'operations'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SquareIcon,
      title: 'Customer purchase history lookup',
      prompt:
        'Build a workflow that searches Square customers by email, pulls their orders and payments, summarizes lifetime spend and most-purchased items, and returns a concise profile the support team can use during a conversation.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'take-payment',
      description: 'Take a Square payment from a payment source and confirm the result.',
      content:
        '# Take Payment\n\nCharge a customer using Square.\n\n## Steps\n1. Run Create Payment with the source ID (card nonce or card on file), the amount in the smallest denomination, and the currency.\n2. Optionally attach a customer ID, location ID, or order ID.\n3. Confirm the result with Get Payment if you need the latest status.\n\n## Output\nReturn the payment ID, status (APPROVED, COMPLETED, or FAILED), and the amount charged. If a refund is needed, run Refund Payment with the payment ID.',
    },
    {
      name: 'issue-and-publish-invoice',
      description: 'Create a Square invoice for an order and publish it to the customer.',
      content:
        '# Issue And Publish Invoice\n\nBill a customer with a Square invoice.\n\n## Steps\n1. Make sure an order exists (use Create Order if needed) and you have the customer ID.\n2. Run Create Invoice with an invoice object referencing the location, order, primary recipient (customer), and payment requests. Note the returned invoice ID and version.\n3. Run Publish Invoice with that invoice ID and version to send it to the customer.\n4. Track payment with Get Invoice.\n\n## Output\nReturn the invoice ID, status, and the public URL where the customer can pay.',
    },
    {
      name: 'manage-catalog-item',
      description: 'Create or update a Square catalog item and attach an image to it.',
      content:
        '# Manage Catalog Item\n\nBuild out the Square catalog.\n\n## Steps\n1. Run Upsert Catalog Object with an ITEM object (use a temporary id like "#Name" for new items). Capture the returned object ID.\n2. To add a picture, run Create Catalog Image with the image file and the object ID to attach it to the item.\n3. Verify with Get Catalog Object or Search Catalog Objects.\n\n## Output\nReturn the catalog object ID, type, and version, plus the image object ID when an image was attached.',
    },
    {
      name: 'find-customer-activity',
      description: 'Look up a Square customer and summarize their orders and payments.',
      content:
        '# Find Customer Activity\n\nBuild a purchase history view for one customer.\n\n## Steps\n1. Run Search Customers (by email or phone) or Get Customer to identify the customer and their ID.\n2. Run Search Orders across the relevant locations filtered to that customer.\n3. Run List Payments and match payments to the customer for a full financial picture.\n\n## Output\nReturn the customer ID and email plus a summary of their orders and payments: total spend, number of orders, and any refunds.',
    },
  ],
} as const satisfies BlockMeta
