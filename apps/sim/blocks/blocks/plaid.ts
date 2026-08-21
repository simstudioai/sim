import { PlaidIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { PlaidResponse } from '@/tools/plaid/types'
import { toPlaidOptionalBoolean, toPlaidOptionalNumber } from '@/tools/plaid/utils'

type PlaidOperation =
  | 'sync_transactions'
  | 'get_accounts'
  | 'get_balances'
  | 'get_identity'
  | 'get_auth'
  | 'get_item'
  | 'search_institutions'
  | 'get_institution'

const ACCOUNT_FILTER_OPERATIONS = [
  'get_accounts',
  'get_balances',
  'get_identity',
] satisfies PlaidOperation[]

export const PlaidBlock: BlockConfig<PlaidResponse> = {
  type: 'plaid',
  name: 'Plaid',
  description: 'Read bank accounts, balances, transactions, and identity data via Plaid',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Connect a reusable Plaid Item credential to sync categorized transactions, list linked bank accounts, fetch balances and account numbers, retrieve account-holder identity, inspect Item health, and look up supported institutions.',
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
          {
            text: ', scoped to account',
            field: ['accountIdSelector', 'manualAccountId'],
          },
          { text: ', resuming from', field: 'cursor', after: 'cursor' },
          { text: ', up to', field: 'count', after: 'per page' },
        ],
        get_accounts: [
          'List linked bank accounts',
          { text: ', filtered to', field: ['accountIdsSelector', 'manualAccountIds'] },
        ],
        get_balances: [
          'Fetch real-time balances',
          { text: ', for accounts', field: ['accountIdsSelector', 'manualAccountIds'] },
        ],
        get_identity: [
          'Fetch account-holder identity',
          { text: ', for accounts', field: ['accountIdsSelector', 'manualAccountIds'] },
        ],
        get_auth: [
          'Fetch account and routing numbers',
          { text: ', for accounts', field: ['authAccountIdsSelector', 'manualAuthAccountIds'] },
        ],
        get_item: ['Fetch the linked Item and its health'],
        search_institutions: [
          { text: 'Search institutions for', field: 'query', core: true },
          { text: ', in', field: 'countryCodes' },
        ],
        get_institution: [
          {
            text: 'Fetch institution',
            field: ['institutionSelector', 'manualInstitutionId'],
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Plaid Item',
      type: 'oauth-input',
      serviceId: 'plaid',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Plaid Item credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Plaid Item',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      // Plaid's public tool contract deliberately keeps the explicit
      // `plaidCredentialId` name, while the canvas uses the conventional
      // `oauthCredential` canonical pair. Registering the derived tool field
      // here tells required-field analysis that the adapter supplies it; the
      // value itself is produced by tools.config.params below.
      id: 'plaidCredentialId',
      type: 'short-input',
      hidden: true,
      hideFromCopilot: true,
      paramVisibility: 'hidden',
    },
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
      ],
      value: () => 'sync_transactions',
    },
    {
      id: 'institutionSelector',
      title: 'Institution',
      type: 'project-selector',
      selectorKey: 'plaid.institutions',
      serviceId: 'plaid',
      canonicalParamId: 'institutionId',
      placeholder: 'Search Plaid institutions',
      dependsOn: ['credential', 'countryCodes'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: 'get_institution',
      },
      required: {
        field: 'operation',
        value: 'get_institution',
      },
    },
    {
      id: 'manualInstitutionId',
      title: 'Institution ID',
      type: 'short-input',
      canonicalParamId: 'institutionId',
      placeholder: 'e.g. ins_109508',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_institution' },
      required: { field: 'operation', value: 'get_institution' },
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
      value: () => 'US',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['search_institutions', 'get_institution'] satisfies PlaidOperation[],
      },
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
      id: 'accountIdsSelector',
      title: 'Accounts',
      type: 'project-selector',
      selectorKey: 'plaid.accounts',
      serviceId: 'plaid',
      canonicalParamId: 'accountIds',
      multiSelect: true,
      placeholder: 'Filter by linked accounts',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ACCOUNT_FILTER_OPERATIONS },
    },
    {
      id: 'manualAccountIds',
      title: 'Account IDs',
      type: 'short-input',
      canonicalParamId: 'accountIds',
      placeholder: 'Comma-separated account IDs (defaults to all)',
      mode: 'advanced',
      condition: { field: 'operation', value: ACCOUNT_FILTER_OPERATIONS },
    },
    {
      id: 'authAccountIdsSelector',
      title: 'Accounts',
      type: 'project-selector',
      selectorKey: 'plaid.accounts.auth',
      serviceId: 'plaid',
      canonicalParamId: 'authAccountIds',
      multiSelect: true,
      placeholder: 'Filter by Auth-eligible accounts',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'get_auth' },
    },
    {
      id: 'manualAuthAccountIds',
      title: 'Account IDs',
      type: 'short-input',
      canonicalParamId: 'authAccountIds',
      placeholder: 'Comma-separated Auth-eligible account IDs (defaults to all)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_auth' },
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
      id: 'accountIdSelector',
      title: 'Account',
      type: 'project-selector',
      selectorKey: 'plaid.accounts.transactions',
      serviceId: 'plaid',
      canonicalParamId: 'accountId',
      placeholder: 'Scope the sync to one account',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'sync_transactions' },
    },
    {
      id: 'manualAccountId',
      title: 'Account ID',
      type: 'short-input',
      canonicalParamId: 'accountId',
      placeholder: 'Scope the sync to one account ID',
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
    ],
    config: {
      tool: (params) => `plaid_${params.operation}`,
      params: (params) => {
        const { operation } = params
        const result: Record<string, unknown> = {
          // Generic tool execution treats a truthy oauthCredential as a request
          // to resolve an OAuth access token. Plaid's internal route owns its
          // credential authorization/decryption, so consume the canvas-only
          // canonical value while deriving the public Plaid tool parameter.
          oauthCredential: undefined,
          plaidCredentialId: params.oauthCredential,
        }

        switch (operation) {
          case 'sync_transactions': {
            if (params.cursor) result.cursor = params.cursor
            if (params.accountId) result.accountId = params.accountId
            const count = toPlaidOptionalNumber(params.count, 'Page Size', {
              integer: true,
              min: 1,
              max: 500,
            })
            if (count !== undefined) result.count = count
            const includeOriginal = toPlaidOptionalBoolean(
              params.includeOriginalDescription,
              'Include Original Description'
            )
            if (includeOriginal !== undefined) result.includeOriginalDescription = includeOriginal
            const daysRequested = toPlaidOptionalNumber(params.daysRequested, 'Days Requested', {
              integer: true,
              min: 1,
              max: 730,
            })
            if (daysRequested !== undefined) result.daysRequested = daysRequested
            break
          }
          case 'get_accounts':
          case 'get_identity':
            if (params.accountIds) result.accountIds = params.accountIds
            break
          case 'get_auth':
            if (params.authAccountIds) result.accountIds = params.authAccountIds
            break
          case 'get_balances':
            if (params.accountIds) result.accountIds = params.accountIds
            if (params.minLastUpdatedDatetime) {
              result.minLastUpdatedDatetime = params.minLastUpdatedDatetime
            }
            break
          case 'get_item':
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
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'ID of a preconnected reusable Plaid Item credential',
    },
    institutionId: { type: 'string', description: 'Plaid institution ID' },
    query: { type: 'string', description: 'Institution name to search for' },
    countryCodes: { type: 'string', description: 'Comma-separated Plaid-supported country codes' },
    products: { type: 'string', description: 'Comma-separated products institutions must support' },
    accountIds: { type: 'string', description: 'Comma-separated account IDs filter' },
    authAccountIds: { type: 'string', description: 'Comma-separated Auth-eligible account IDs' },
    accountId: {
      type: 'string',
      description: 'Single account ID to scope the transaction sync (and its cursor) to',
    },
    minLastUpdatedDatetime: {
      type: 'string',
      description: 'Oldest acceptable balance timestamp (ISO 8601)',
    },
    cursor: { type: 'string', description: 'Transaction sync cursor from a previous run' },
    count: { type: 'string', description: 'Transaction sync page size (Plaid requires 1-500)' },
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
        'Sensitive account and routing numbers grouped by scheme; hiddenFromDisplay suppresses only source-block log display',
      hiddenFromDisplay: true,
    },
    item: { type: 'json', description: 'Item metadata including institution and enabled products' },
    status: { type: 'json', description: 'Item health status and last webhook' },
    institutions: { type: 'json', description: 'Institutions matching the search' },
    institution: { type: 'json', description: 'Institution details' },
    requestId: { type: 'string', description: 'Plaid request ID for support and troubleshooting' },
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
      title: 'Plaid ACH payment setup',
      prompt:
        'Build an access-controlled workflow that checks account verification status, fetches account and routing numbers only for an eligible linked Plaid Item, and sends them only to an approved non-Plaid-partner payment processor. Do not route the values to an Agent or durable sink unless that transmission or retention is explicitly approved.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid identity check',
      prompt:
        'Build a workflow that compares the name, email, and address returned for a selected Plaid Item against a submitted customer record and routes mismatches for review.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid connection health monitor',
      prompt:
        'Build a scheduled workflow that checks a selected Plaid Item, inspects its error state and last successful update, looks up its institution, and posts a Slack alert when the connection needs the user to re-link.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PlaidIcon,
      title: 'Plaid bank coverage report',
      prompt:
        'Build a workflow that searches Plaid institutions for a supplied bank name and reports each match with its institution ID, supported products, countries, and OAuth requirement.',
      modules: ['workflows'],
      category: 'productivity',
      tags: ['automation'],
    },
  ],
} as const satisfies BlockMeta
