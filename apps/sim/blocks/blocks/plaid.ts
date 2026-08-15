import { PlaidIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { toOptionalBoolean, toOptionalFiniteNumber } from '@/blocks/utils'
import type { PlaidResponse } from '@/tools/plaid/types'

const ACCESS_TOKEN_OPERATIONS = [
  'sync_transactions',
  'get_accounts',
  'get_balances',
  'get_identity',
  'get_auth',
  'get_item',
]

const ACCOUNT_FILTER_OPERATIONS = ['get_accounts', 'get_balances', 'get_identity', 'get_auth']

export const PlaidBlock: BlockConfig<PlaidResponse> = {
  type: 'plaid',
  name: 'Plaid',
  description: 'Read bank accounts, balances, transactions, and identity data via Plaid',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrates Plaid into the workflow. Sync categorized transactions, list linked bank accounts with real-time balances, fetch verified account and routing numbers, retrieve account-holder identity, look up supported institutions, and manage Item tokens across the sandbox and production environments.',
  docsLink: 'https://docs.sim.ai/integrations/plaid',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  bgColor: '#111111',
  icon: PlaidIcon,
  canvasPresentation: {
    defaultTitle: 'Plaid',
    sentences: {
      byOperation: {
        sync_transactions: [
          'Sync transactions',
          { text: ', scoped to account', field: 'accountId' },
          { text: ', resuming from', field: 'cursor', after: 'cursor' },
          { text: ', up to', field: 'count', after: 'per page' },
        ],
        get_accounts: ['List linked bank accounts', { text: ', filtered to', field: 'accountIds' }],
        get_balances: ['Fetch real-time balances', { text: ', for accounts', field: 'accountIds' }],
        get_identity: [
          'Fetch account-holder identity',
          { text: ', for accounts', field: 'accountIds' },
        ],
        get_auth: [
          'Fetch account and routing numbers',
          { text: ', for accounts', field: 'accountIds' },
        ],
        get_item: ['Fetch the linked Item and its health'],
        search_institutions: [
          { text: 'Search institutions for', field: 'query', core: true },
          { text: ', in', field: 'countryCodes' },
        ],
        get_institution: [{ text: 'Fetch institution', field: 'institutionId', core: true }],
        exchange_public_token: ['Exchange a public token for an access token'],
        create_sandbox_public_token: [
          { text: 'Create a sandbox token for institution', field: 'institutionId', core: true },
          { text: ', with products', field: 'initialProducts' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Sync Transactions', id: 'sync_transactions' },
        { label: 'Get Accounts', id: 'get_accounts' },
        { label: 'Get Balances', id: 'get_balances' },
        { label: 'Get Identity', id: 'get_identity' },
        { label: 'Get Auth Numbers', id: 'get_auth' },
        { label: 'Get Item', id: 'get_item' },
        { label: 'Search Institutions', id: 'search_institutions' },
        { label: 'Get Institution', id: 'get_institution' },
        { label: 'Exchange Public Token', id: 'exchange_public_token' },
        { label: 'Create Sandbox Token', id: 'create_sandbox_public_token' },
      ],
      value: () => 'sync_transactions',
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'dropdown',
      options: [
        { label: 'Production', id: 'production' },
        { label: 'Sandbox', id: 'sandbox' },
      ],
      value: () => 'production',
      condition: { field: 'operation', value: 'create_sandbox_public_token', not: true },
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'Plaid client ID from the Dashboard',
      required: true,
    },
    {
      id: 'secret',
      title: 'Secret',
      type: 'short-input',
      password: true,
      placeholder: 'Plaid secret for the selected environment',
      required: true,
    },
    {
      id: 'accessToken',
      title: 'Access Token',
      type: 'short-input',
      password: true,
      placeholder: 'Access token for the linked Item',
      condition: { field: 'operation', value: ACCESS_TOKEN_OPERATIONS },
      required: { field: 'operation', value: ACCESS_TOKEN_OPERATIONS },
    },
    {
      id: 'publicToken',
      title: 'Public Token',
      type: 'short-input',
      password: true,
      placeholder: 'Public token from Plaid Link',
      condition: { field: 'operation', value: 'exchange_public_token' },
      required: { field: 'operation', value: 'exchange_public_token' },
    },
    {
      id: 'institutionId',
      title: 'Institution ID',
      type: 'short-input',
      placeholder: 'e.g. ins_109508',
      condition: {
        field: 'operation',
        value: ['get_institution', 'create_sandbox_public_token'],
      },
      required: {
        field: 'operation',
        value: ['get_institution', 'create_sandbox_public_token'],
      },
    },
    {
      id: 'initialProducts',
      title: 'Initial Products',
      type: 'short-input',
      placeholder: 'e.g. transactions,auth',
      condition: { field: 'operation', value: 'create_sandbox_public_token' },
      required: { field: 'operation', value: 'create_sandbox_public_token' },
    },
    {
      id: 'webhook',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'Webhook URL to set on the Item',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox_public_token' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Institution name, e.g. Chase',
      condition: { field: 'operation', value: 'search_institutions' },
      required: { field: 'operation', value: 'search_institutions' },
    },
    {
      id: 'countryCodes',
      title: 'Country Codes',
      type: 'short-input',
      placeholder: 'Comma-separated, defaults to US',
      mode: 'advanced',
      condition: { field: 'operation', value: ['search_institutions', 'get_institution'] },
    },
    {
      id: 'products',
      title: 'Required Products',
      type: 'short-input',
      placeholder: 'e.g. transactions,auth',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search_institutions' },
    },
    {
      id: 'accountIds',
      title: 'Account IDs',
      type: 'short-input',
      placeholder: 'Comma-separated account IDs (defaults to all)',
      mode: 'advanced',
      condition: { field: 'operation', value: ACCOUNT_FILTER_OPERATIONS },
    },
    {
      id: 'minLastUpdatedDatetime',
      title: 'Min Last Updated',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (Capital One only)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_balances' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp based on the user description. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous sync (omit for full history)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sync_transactions' },
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Scope the sync to a single account ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sync_transactions' },
    },
    {
      id: 'count',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '1-500, defaults to 100',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sync_transactions' },
    },
    {
      id: 'includeOriginalDescription',
      title: 'Include Original Description',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sync_transactions' },
    },
    {
      id: 'daysRequested',
      title: 'Days Requested',
      type: 'short-input',
      placeholder: '1-730, defaults to 90',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sync_transactions' },
    },
  ],
  tools: {
    access: [
      'plaid_sync_transactions',
      'plaid_get_accounts',
      'plaid_get_balances',
      'plaid_get_identity',
      'plaid_get_auth',
      'plaid_get_item',
      'plaid_search_institutions',
      'plaid_get_institution',
      'plaid_exchange_public_token',
      'plaid_create_sandbox_public_token',
    ],
    config: {
      tool: (params) => `plaid_${params.operation}`,
      params: (params) => {
        const { operation, clientId, secret } = params
        const result: Record<string, unknown> = { clientId, secret }
        if (operation !== 'create_sandbox_public_token') {
          result.environment = params.environment
        }

        switch (operation) {
          case 'sync_transactions': {
            result.accessToken = params.accessToken
            if (params.cursor) result.cursor = params.cursor
            if (params.accountId) result.accountId = params.accountId
            const count = toOptionalFiniteNumber(params.count, 'Page Size')
            if (count !== undefined) result.count = count
            const includeOriginal = toOptionalBoolean(params.includeOriginalDescription)
            if (includeOriginal !== undefined) result.includeOriginalDescription = includeOriginal
            const daysRequested = toOptionalFiniteNumber(params.daysRequested, 'Days Requested')
            if (daysRequested !== undefined) result.daysRequested = daysRequested
            break
          }
          case 'get_accounts':
          case 'get_identity':
          case 'get_auth':
            result.accessToken = params.accessToken
            if (params.accountIds) result.accountIds = params.accountIds
            break
          case 'get_balances':
            result.accessToken = params.accessToken
            if (params.accountIds) result.accountIds = params.accountIds
            if (params.minLastUpdatedDatetime) {
              result.minLastUpdatedDatetime = params.minLastUpdatedDatetime
            }
            break
          case 'get_item':
            result.accessToken = params.accessToken
            break
          case 'search_institutions':
            result.query = params.query
            if (params.countryCodes) result.countryCodes = params.countryCodes
            if (params.products) result.products = params.products
            break
          case 'get_institution':
            result.institutionId = params.institutionId
            if (params.countryCodes) result.countryCodes = params.countryCodes
            break
          case 'exchange_public_token':
            result.publicToken = params.publicToken
            break
          case 'create_sandbox_public_token':
            result.institutionId = params.institutionId
            result.initialProducts = params.initialProducts
            if (params.webhook) result.webhook = params.webhook
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    environment: { type: 'string', description: 'Plaid environment (production or sandbox)' },
    clientId: { type: 'string', description: 'Plaid client ID' },
    secret: { type: 'string', description: 'Plaid API secret' },
    accessToken: { type: 'string', description: 'Access token for the linked Item' },
    publicToken: { type: 'string', description: 'Public token from Plaid Link to exchange' },
    institutionId: { type: 'string', description: 'Plaid institution ID' },
    initialProducts: {
      type: 'string',
      description: 'Comma-separated products to enable on the sandbox Item',
    },
    webhook: { type: 'string', description: 'Webhook URL to set on the sandbox Item' },
    query: { type: 'string', description: 'Institution name to search for' },
    countryCodes: { type: 'string', description: 'Comma-separated ISO country codes' },
    products: { type: 'string', description: 'Comma-separated products institutions must support' },
    accountIds: { type: 'string', description: 'Comma-separated account IDs filter' },
    accountId: {
      type: 'string',
      description: 'Single account ID to scope the transaction sync (and its cursor) to',
    },
    minLastUpdatedDatetime: {
      type: 'string',
      description: 'Oldest acceptable balance timestamp (ISO 8601)',
    },
    cursor: { type: 'string', description: 'Transaction sync cursor from a previous run' },
    count: { type: 'string', description: 'Transaction sync page size (1-500)' },
    includeOriginalDescription: {
      type: 'boolean',
      description: 'Include the unmodified transaction description from the institution',
    },
    daysRequested: {
      type: 'string',
      description: 'Days of transaction history to request (1-730)',
    },
  },
  outputs: {
    added: { type: 'json', description: 'Transactions added since the sync cursor' },
    modified: { type: 'json', description: 'Transactions modified since the sync cursor' },
    removed: { type: 'json', description: 'Transactions removed since the sync cursor' },
    nextCursor: { type: 'string', description: 'Cursor for the next transaction sync call' },
    hasMore: { type: 'boolean', description: 'Whether more transaction updates are available' },
    updateStatus: { type: 'string', description: 'Transaction sync readiness status' },
    accounts: { type: 'json', description: 'Accounts with names, types, and balances' },
    count: { type: 'number', description: 'Number of records returned' },
    numbers: {
      type: 'json',
      description:
        'Verified account and routing numbers grouped by scheme (ach, eft, international, bacs)',
    },
    item: { type: 'json', description: 'Item metadata including institution and enabled products' },
    status: { type: 'json', description: 'Item health status and last webhook' },
    institutions: { type: 'json', description: 'Institutions matching the search' },
    institution: { type: 'json', description: 'Institution details' },
    accessToken: { type: 'string', description: 'Access token from the public token exchange' },
    itemId: { type: 'string', description: 'Item ID from the public token exchange' },
    publicToken: { type: 'string', description: 'Sandbox public token' },
  },
}

export const PlaidBlockMeta = {
  tags: ['payments'],
  url: 'https://plaid.com',
  templates: [
    {
      icon: PlaidIcon,
      title: 'Plaid spend digest',
      prompt:
        'Build a scheduled workflow that runs every morning, syncs new Plaid transactions since the stored cursor, summarizes spend by personal finance category, and posts the digest to a Slack channel.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid low-balance alert',
      prompt:
        'Build a scheduled workflow that checks real-time Plaid account balances every morning and emails the finance team when any available balance drops below a set threshold.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid transaction ledger',
      prompt:
        'Build a scheduled workflow that syncs Plaid transactions with the stored cursor, upserts added and modified transactions into a table keyed by transaction ID, deletes removed ones, and saves the new cursor for the next run.',
      modules: ['workflows', 'scheduled', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid account onboarding',
      prompt:
        'Build a workflow that takes a public token from Plaid Link, exchanges it for an access token, fetches the linked accounts and holder identity, and stores the new connection details in a table.',
      modules: ['workflows', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid ACH payment setup',
      prompt:
        'Build a workflow that fetches verified account and routing numbers for a linked Plaid Item and passes them directly to the payment step, storing only the account name and mask for reference.',
      modules: ['workflows', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid identity check',
      prompt:
        'Build an agent that verifies a customer by comparing the name, email, and address on their linked Plaid accounts against the customer record they submitted, and flags mismatches for review.',
      modules: ['agent'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid connection health monitor',
      prompt:
        'Build a scheduled workflow that checks each stored Plaid Item, inspects its error state and last successful update, and posts a Slack alert listing connections that need the user to re-link.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid bank coverage assistant',
      prompt:
        'Build an agent that answers which banks Plaid supports for a given product by searching institutions by name and reporting each match with its supported products and OAuth requirement.',
      modules: ['agent'],
      category: 'productivity',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'spending-summary',
      description: 'Summarize spend from Plaid transactions by category, merchant, and account.',
      content:
        '# Spending Summary\n\nBuild a clear picture of recent spend from Plaid transactions.\n\n## Steps\n1. Sync transactions with the stored cursor (omit it for full history) and loop while hasMore is true, carrying nextCursor forward. If Plaid returns TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION, discard the pages from this batch and restart the loop from the cursor the batch started with.\n2. Group added transactions by personal_finance_category.primary and merchant_name, totaling amounts (positive amounts are money out).\n3. Note pending transactions separately and apply any modified or removed entries to previously stored data.\n\n## Output\nReturn total spend for the period, a breakdown by category and merchant, the largest transactions, and the new cursor to store for the next run.',
    },
    {
      name: 'balance-check',
      description: 'Check real-time balances across linked Plaid accounts and flag low ones.',
      content:
        '# Balance Check\n\nGive a quick read on cash across linked bank accounts.\n\n## Steps\n1. Use Get Balances for a live fetch (it can take up to 30 seconds); fall back to Get Accounts for cached values when speed matters.\n2. For each account capture name, mask, type, subtype, and the available and current balances.\n3. Flag accounts whose available balance is below the requested threshold, and note accounts where available is null (institution does not report it).\n\n## Output\nReturn each account with its balances and currency, plus a flagged list of low-balance accounts.',
    },
    {
      name: 'link-bank-account',
      description: 'Exchange a Plaid Link public token and summarize the newly linked accounts.',
      content:
        '# Link a Bank Account\n\nTurn a Plaid Link handoff into a usable connection.\n\n## Steps\n1. Exchange the public token for an access token and item ID with Exchange Public Token.\n2. Use Get Item to confirm the institution and enabled products, then Get Accounts to list the linked accounts.\n3. Store the access token as a workspace environment secret — never in a table or plain text — since it grants ongoing access to the bank connection.\n\n## Output\nReturn the item ID, institution name, and each linked account with its name, mask, type, and balances. Remind the user the access token must be stored as a secret.',
    },
    {
      name: 'verify-account-holder',
      description: 'Compare Plaid identity data against a submitted customer record.',
      content:
        "# Verify Account Holder\n\nCheck that a bank account really belongs to the customer.\n\n## Steps\n1. Use Get Identity for the Item and collect each account's owners with their names, emails, phone numbers, and addresses.\n2. Compare the submitted customer name, email, and address against the owner data, allowing for common formatting differences.\n3. Treat multiple owners as a joint account: a match on any owner counts.\n\n## Output\nReturn a match verdict per field (name, email, address), the owner data used, and any mismatch that needs manual review.",
    },
    {
      name: 'ach-detail-collection',
      description: 'Fetch verified account and routing numbers for ACH payment setup.',
      content:
        '# ACH Detail Collection\n\nCollect verified bank details for payment initiation.\n\n## Steps\n1. Use Get Auth Numbers for the Item, optionally filtered to the chosen account ID.\n2. Check the verification_status on each account first: skip accounts with a failed or expired status, and surface pending ones for follow-up (null means the institution verified instantly).\n3. Read the numbers.ach entries for US accounts (account, routing, wire_routing, and is_tokenized_account_number for tokenized institutions like Chase); use eft, bacs, or international entries for non-US accounts.\n4. Pair each entry with its account name and mask from the accounts list so the right account is selected.\n\n## Output\nPass the verified numbers directly to the payment step and persist only the account name and mask for reference — do not store full account or routing numbers in tables, files, or logs.',
    },
    {
      name: 'connection-health-review',
      description: 'Check a Plaid Item for errors and stale data before relying on it.',
      content:
        '# Connection Health Review\n\nMake sure a bank connection is still working.\n\n## Steps\n1. Use Get Item and inspect item.error — null means healthy; ITEM_LOGIN_REQUIRED means the user must re-link through Plaid Link.\n2. Check status.transactions.last_successful_update and last_failed_update for staleness.\n3. Confirm the products you depend on appear in the enabled products list.\n\n## Output\nReturn a health verdict, the institution name, any error code with what it means, and when data was last successfully updated.',
    },
    {
      name: 'bank-coverage-check',
      description: 'Find out whether Plaid supports a bank and which products it offers.',
      content:
        "# Bank Coverage Check\n\nAnswer whether a bank works with Plaid before onboarding a user.\n\n## Steps\n1. Search institutions by name, filtered to the relevant country codes and required products.\n2. For an exact match, use Get Institution with its institution ID for full details.\n3. Note whether the institution uses OAuth (the user signs in on the bank's own page) and which products it supports.\n\n## Output\nReturn the matching institutions with their IDs, supported products, countries, and OAuth requirement.",
    },
  ],
} as const satisfies BlockMeta
