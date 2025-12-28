import { PlaidIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GetTransactionsResponse } from '@/tools/plaid/types'

export const PlaidBlock: BlockConfig<GetTransactionsResponse> = {
  type: 'plaid',
  name: 'Plaid',
  description: 'Access banking data and transactions via Plaid',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrates Plaid banking services into the workflow. Access account balances, transactions, auth data for ACH transfers, and more. Securely connect to 10,000+ financial institutions.',
  docsLink: 'https://docs.sim.ai/tools/plaid',
  category: 'tools',
  bgColor: '#000000',
  icon: PlaidIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Link Token', id: 'create_link_token' },
        { label: 'Exchange Public Token', id: 'exchange_public_token' },
        { label: 'Get Accounts', id: 'get_accounts' },
        { label: 'Get Balance', id: 'get_balance' },
        { label: 'Get Transactions', id: 'get_transactions' },
        { label: 'Get Auth (ACH Numbers)', id: 'get_auth' },
      ],
      value: () => 'get_transactions',
    },
    {
      id: 'clientId',
      title: 'Plaid Client ID',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Plaid client ID',
      required: true,
    },
    {
      id: 'secret',
      title: 'Plaid Secret',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Plaid secret key',
      required: true,
    },
    // Access Token - REQUIRED for data retrieval operations
    {
      id: 'accessToken',
      title: 'Access Token',
      type: 'short-input',
      password: true,
      placeholder: 'Plaid access token from exchange',
      condition: {
        field: 'operation',
        value: ['get_accounts', 'get_balance', 'get_transactions', 'get_auth'],
      },
      required: true,
    },
    // Link Token creation fields
    {
      id: 'clientName',
      title: 'Client Name',
      type: 'short-input',
      placeholder: 'Your app name shown in Plaid Link',
      condition: {
        field: 'operation',
        value: 'create_link_token',
      },
      required: true,
    },
    {
      id: 'countryCodes',
      title: 'Country Codes (JSON Array)',
      type: 'code',
      placeholder: '["US", "CA", "GB"]',
      condition: {
        field: 'operation',
        value: 'create_link_token',
      },
      required: true,
    },
    {
      id: 'products',
      title: 'Products (JSON Array)',
      type: 'code',
      placeholder: '["transactions", "auth", "identity"]',
      condition: {
        field: 'operation',
        value: 'create_link_token',
      },
      required: true,
    },
    {
      id: 'user',
      title: 'User Object (JSON)',
      type: 'code',
      placeholder: '{"client_user_id": "user-123", "email_address": "user@example.com"}',
      condition: {
        field: 'operation',
        value: 'create_link_token',
      },
      required: true,
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en (default), es, fr, etc.',
      condition: {
        field: 'operation',
        value: 'create_link_token',
      },
    },
    {
      id: 'webhook',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'https://yourapp.com/plaid/webhook',
      condition: {
        field: 'operation',
        value: 'create_link_token',
      },
    },
    // Public Token Exchange
    {
      id: 'publicToken',
      title: 'Public Token',
      type: 'short-input',
      placeholder: 'Public token from Plaid Link',
      condition: {
        field: 'operation',
        value: 'exchange_public_token',
      },
      required: true,
    },
    // Transaction fields
    {
      id: 'startDate',
      title: 'Start Date (YYYY-MM-DD)',
      type: 'short-input',
      placeholder: 'e.g., 2024-01-01',
      condition: {
        field: 'operation',
        value: 'get_transactions',
      },
      required: true,
    },
    {
      id: 'endDate',
      title: 'End Date (YYYY-MM-DD)',
      type: 'short-input',
      placeholder: 'e.g., 2024-12-31',
      condition: {
        field: 'operation',
        value: 'get_transactions',
      },
      required: true,
    },
    {
      id: 'count',
      title: 'Count (Max Transactions)',
      type: 'short-input',
      placeholder: 'Max: 500 (default: 100)',
      condition: {
        field: 'operation',
        value: 'get_transactions',
      },
    },
    {
      id: 'offset',
      title: 'Offset (Pagination)',
      type: 'short-input',
      placeholder: 'Pagination offset (default: 0)',
      condition: {
        field: 'operation',
        value: 'get_transactions',
      },
    },
    // Account filtering
    {
      id: 'accountIds',
      title: 'Account IDs (JSON Array)',
      type: 'code',
      placeholder: '["acc_123", "acc_456"]',
      condition: {
        field: 'operation',
        value: ['get_accounts', 'get_balance', 'get_transactions', 'get_auth'],
      },
    },
  ],
  tools: {
    access: [
      'plaid_create_link_token',
      'plaid_exchange_public_token',
      'plaid_get_accounts',
      'plaid_get_balance',
      'plaid_get_transactions',
      'plaid_get_auth',
    ],
    config: {
      tool: (params) => {
        return `plaid_${params.operation}`
      },
      params: (params) => {
        const { operation, countryCodes, products, user, accountIds, ...rest } = params

        // Parse JSON fields
        let parsedCountryCodes: any | undefined
        let parsedProducts: any | undefined
        let parsedUser: any | undefined
        let parsedAccountIds: any | undefined

        try {
          if (countryCodes) parsedCountryCodes = JSON.parse(countryCodes)
          if (products) parsedProducts = JSON.parse(products)
          if (user) parsedUser = JSON.parse(user)
          if (accountIds) parsedAccountIds = JSON.parse(accountIds)
        } catch (error: any) {
          throw new Error(`Invalid JSON input: ${error.message}`)
        }

        return {
          ...rest,
          ...(parsedCountryCodes && { countryCodes: parsedCountryCodes }),
          ...(parsedProducts && { products: parsedProducts }),
          ...(parsedUser && { user: parsedUser }),
          ...(parsedAccountIds && { accountIds: parsedAccountIds }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    clientId: { type: 'string', description: 'Plaid client ID' },
    secret: { type: 'string', description: 'Plaid secret key' },
    accessToken: { type: 'string', description: 'Plaid access token' },
    // Link Token inputs
    clientName: { type: 'string', description: 'Application name shown in Plaid Link' },
    language: { type: 'string', description: 'Language code (e.g., en, es, fr)' },
    countryCodes: { type: 'json', description: 'Array of country codes' },
    products: { type: 'json', description: 'Array of Plaid products' },
    user: { type: 'json', description: 'User object with client_user_id' },
    webhook: { type: 'string', description: 'Webhook URL for notifications' },
    // Exchange inputs
    publicToken: { type: 'string', description: 'Public token from Plaid Link' },
    // Transaction inputs
    startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
    endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
    count: { type: 'number', description: 'Number of transactions to fetch' },
    offset: { type: 'number', description: 'Pagination offset' },
    // Account filtering
    accountIds: { type: 'json', description: 'Array of account IDs to filter' },
  },
  outputs: {
    // Link Token outputs
    linkToken: { type: 'json', description: 'Link token object' },
    // Access Token outputs
    accessToken: { type: 'json', description: 'Access token object' },
    // Account outputs
    accounts: { type: 'json', description: 'Array of account objects' },
    item: { type: 'json', description: 'Plaid item metadata' },
    // Transaction outputs
    transactions: { type: 'json', description: 'Array of transaction objects' },
    total_transactions: { type: 'number', description: 'Total transactions available' },
    // Auth outputs
    numbers: { type: 'json', description: 'Bank account and routing numbers' },
    // Common outputs
    metadata: { type: 'json', description: 'Operation metadata' },
  },
}
