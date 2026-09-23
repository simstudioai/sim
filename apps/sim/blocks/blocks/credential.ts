import { CredentialIcon } from '@/components/icons'
import { CREDENTIAL_GROUP_EVENT_TRIGGER_ID } from '@/lib/credential-groups/trigger-constants'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const ORGANIZATION_OPERATIONS = [
  'find_organization_account',
  'list_organization_accounts',
  'find_organization_mcp_connection',
  'list_organization_mcp_connections',
  'list_credential_group_api_keys',
]
const ORGANIZATION_LIST_OPERATIONS = [
  'list_organization_accounts',
  'list_organization_mcp_connections',
  'list_credential_group_api_keys',
]
const OAUTH_FIND_OPERATIONS = ['select', 'find_organization_account']
const MCP_OPERATIONS = ['find_organization_mcp_connection', 'list_organization_mcp_connections']

export const CredentialBlock: BlockConfig = {
  type: 'credential',
  name: 'Credential',
  description:
    'Select credentials or find Credential Group accounts, MCP connections, and API keys',
  longDescription:
    'Select workspace OAuth credentials or find and list Credential Group accounts in an allowed workspace. List Credential Group Accounts discovers connected accounts by provider, with an optional enrollment email filter. List Credential Group API Keys returns submitted key references by name and email. Pass one reference to Get Credential Group API Key, then use its apiKey output in a tool or HTTP header. Only active, accessible credentials are returned. Results are paginated using hasMore and nextCursor. Manage invitations in organization settings.',
  bestPractices: `
  - Use "Select Credential" to define an OAuth credential once and reference <CredentialBlock.credentialId> in multiple downstream blocks instead of repeating credential IDs.
  - Use "List Credentials" with a ForEach loop to iterate over all OAuth accounts (e.g. all Gmail accounts).
  - Use the Provider filter to narrow results to specific services (e.g. Gmail, Slack).
  - Use "List Credential Group Accounts" with Providers selected and Email blank to discover all accessible accounts for those integrations.
  - Organization lists return one page at a time. While hasMore is true, pass nextCursor as Cursor with the same filters to get every matching account.
  - "Find Credential Group Account" requires an exact enrollment email and provider, and fails unless exactly one active account matches.
  - List operations return metadata and credential references. Get Credential Group API Key resolves one key with secret provenance before returning its apiKey output.
  - Key name, Email, and API Key Credential ID accept dynamic references. Use <GetKey.apiKey> directly in a downstream API-key field; no environment variable needs to be created.
  - To switch credentials across environments, replace the single Credential block rather than updating every downstream block.
  `,
  docsLink: 'https://docs.sim.ai/workflows/blocks/credential',
  bgColor: '#6366F1',
  icon: CredentialIcon,
  canvasPresentation: {
    defaultTitle: 'Credential',
    sentences: {
      byOperation: {
        list_credential_group_api_keys: [
          'List Credential Group API keys',
          { text: 'named', field: 'keyName' },
          { text: 'for', field: 'email' },
        ],
        get_credential_group_api_key: [
          { text: 'Get Credential Group API key', field: 'apiKeyCredentialId', core: true },
        ],
        select: ['Select an OAuth credential'],
        list: ['List OAuth credentials', { text: 'for', field: 'providerFilter' }],
        find_organization_account: [
          'Find Credential Group account',
          { text: 'for', field: 'email' },
        ],
        list_organization_accounts: [
          'List Credential Group accounts',
          { text: 'from', field: 'organizationProviders' },
          { text: 'for', field: 'email' },
        ],
        find_organization_mcp_connection: [
          'Find Credential Group MCP connection',
          { text: 'for', field: 'email' },
        ],
        list_organization_mcp_connections: [
          'List Credential Group MCP connections',
          { text: 'for', field: 'email' },
        ],
      },
    },
  },
  category: 'blocks',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Select Credential', id: 'select' },
        { label: 'List Credentials', id: 'list' },
        { label: 'Find Credential Group Account', id: 'find_organization_account' },
        { label: 'List Credential Group Accounts', id: 'list_organization_accounts' },
        { label: 'Find Credential Group MCP Connection', id: 'find_organization_mcp_connection' },
        { label: 'List Credential Group MCP Connections', id: 'list_organization_mcp_connections' },
        { label: 'List Credential Group API Keys', id: 'list_credential_group_api_keys' },
        { label: 'Get Credential Group API Key', id: 'get_credential_group_api_key' },
      ],
      value: () => 'select',
    },
    {
      id: 'keyName',
      title: 'Key name',
      type: 'short-input',
      placeholder: 'Exa API key — leave empty for all key names',
      condition: { field: 'operation', value: 'list_credential_group_api_keys' },
    },
    {
      id: 'apiKeyCredentialId',
      title: 'API Key Credential ID',
      type: 'short-input',
      placeholder: 'Credential ID from List Credential Group API Keys',
      required: true,
      condition: { field: 'operation', value: 'get_credential_group_api_key' },
    },
    {
      id: 'providerFilter',
      title: 'Provider',
      type: 'dropdown',
      selectorKey: 'workspace.credentialProviders',
      multiSelect: true,
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'credential',
      title: 'Credential',
      type: 'oauth-input',
      required: { field: 'operation', value: 'select' },
      mode: 'basic',
      placeholder: 'Select a credential',
      canonicalParamId: 'credentialId',
      condition: { field: 'operation', value: 'select' },
    },
    {
      id: 'manualCredential',
      title: 'Credential ID',
      type: 'short-input',
      required: { field: 'operation', value: 'select' },
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      canonicalParamId: 'credentialId',
      condition: { field: 'operation', value: 'select' },
    },
    {
      id: 'organizationProvider',
      title: 'Provider',
      type: 'dropdown',
      selectorKey: 'workspace.credentialGroupProviders',
      condition: { field: 'operation', value: 'find_organization_account' },
      required: true,
    },
    {
      id: 'organizationProviders',
      title: 'Providers',
      type: 'dropdown',
      placeholder: 'All allowed providers',
      emptyIsValid: true,
      multiSelect: true,
      selectorKey: 'workspace.credentialGroupProviders',
      condition: { field: 'operation', value: 'list_organization_accounts' },
    },
    {
      id: 'mcpProvider',
      title: 'MCP provider',
      type: 'dropdown',
      selectorKey: 'workspace.organizationMcpProviders',
      condition: { field: 'operation', value: MCP_OPERATIONS },
      required: { field: 'operation', value: 'find_organization_mcp_connection' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Optional for lists; exact enrollment email',
      condition: { field: 'operation', value: ORGANIZATION_OPERATIONS },
      required: {
        field: 'operation',
        value: ['find_organization_account', 'find_organization_mcp_connection'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      value: () => '100',
      condition: { field: 'operation', value: ORGANIZATION_LIST_OPERATIONS },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Previous page nextCursor',
      condition: { field: 'operation', value: ORGANIZATION_LIST_OPERATIONS },
    },
    ...getTrigger(CREDENTIAL_GROUP_EVENT_TRIGGER_ID).subBlocks,
  ],
  triggers: { enabled: true, available: [CREDENTIAL_GROUP_EVENT_TRIGGER_ID] },
  tools: {
    access: [],
  },
  inputs: {
    keyName: {
      type: 'string',
      description: 'Optional API key request name; accepts dynamic references',
    },
    apiKeyCredentialId: {
      type: 'string',
      description: 'Explicit submitted API-key credential ID to retrieve',
    },
    operation: { type: 'string', description: 'Credential operation' },
    email: {
      type: 'string',
      description: 'Exact enrollment email; optional for lists, required for find operations',
    },
    organizationProvider: {
      type: 'string',
      description: 'Organization OAuth provider ID for an exact match',
    },
    organizationProviders: {
      type: 'json',
      description: 'Optional organization OAuth provider IDs',
    },
    mcpProvider: { type: 'string', description: 'Managed MCP provider ID' },
    limit: { type: 'number', description: 'Page size from 1 to 100' },
    cursor: { type: 'string', description: 'Previous page nextCursor' },
    credentialId: {
      type: 'string',
      description: 'The OAuth credential ID to resolve (select operation)',
    },
    providerFilter: {
      type: 'json',
      description:
        'Array of OAuth provider IDs to filter by (e.g. ["google-email", "slack"]). Leave empty to return all OAuth credentials.',
    },
  },
  outputs: {
    apiKeys: {
      type: 'json',
      description:
        'API key references with credentialId, optionId, name, and email; no secret values',
      condition: { field: 'operation', value: 'list_credential_group_api_keys' },
    },
    apiKey: {
      type: 'string',
      description:
        'Resolved API key protected by secret provenance; reference directly in a tool API-key field or HTTP header',
      condition: { field: 'operation', value: 'get_credential_group_api_key' },
    },
    name: {
      type: 'string',
      description: 'API key request name',
      condition: { field: 'operation', value: 'get_credential_group_api_key' },
    },
    optionId: {
      type: 'string',
      description: 'Stable API key request ID',
      condition: { field: 'operation', value: 'get_credential_group_api_key' },
    },
    credentialId: {
      type: 'string',
      description: "Credential ID — pipe into other blocks' credential fields",
      condition: {
        field: 'operation',
        value: [
          ...OAUTH_FIND_OPERATIONS,
          'find_organization_mcp_connection',
          'get_credential_group_api_key',
        ],
      },
    },
    displayName: {
      type: 'string',
      description: 'Human-readable name of the credential',
      condition: {
        field: 'operation',
        value: [...OAUTH_FIND_OPERATIONS, 'find_organization_mcp_connection'],
      },
    },
    providerId: {
      type: 'string',
      description: 'OAuth provider ID (e.g. google-email, slack)',
      condition: { field: 'operation', value: OAUTH_FIND_OPERATIONS },
    },
    credentials: {
      type: 'json',
      description:
        'OAuth credential objects with credentialId, displayName, and providerId. Organization accounts also include email (enrollment address), accountEmail (provider account address), providerSubjectId, and providerTenantId.',
      condition: { field: 'operation', value: ['list', 'list_organization_accounts'] },
    },
    emails: {
      type: 'json',
      description:
        'Provider account email addresses on this page, in the same order as credentials. Multiple accounts are preserved; follow nextCursor while hasMore is true for additional pages.',
      condition: { field: 'operation', value: 'list_organization_accounts' },
    },
    count: {
      type: 'number',
      description: 'Number of connections returned',
      condition: { field: 'operation', value: ['list', ...ORGANIZATION_LIST_OPERATIONS] },
    },
    email: {
      type: 'string',
      description: 'Enrollment email',
      condition: {
        field: 'operation',
        value: [
          'find_organization_account',
          'find_organization_mcp_connection',
          'get_credential_group_api_key',
        ],
      },
    },
    mcpServerId: {
      type: 'string',
      description: 'Shared MCP server configuration ID; use credentialId to select the account',
      condition: { field: 'operation', value: 'find_organization_mcp_connection' },
    },
    mcpServerName: {
      type: 'string',
      description: 'MCP server name',
      condition: { field: 'operation', value: 'find_organization_mcp_connection' },
    },
    toolNames: {
      type: 'json',
      description: 'Tools available to this connection',
      condition: { field: 'operation', value: 'find_organization_mcp_connection' },
    },
    mcpConnections: {
      type: 'json',
      description:
        'Managed MCP connections with credentialId, email, mcpServerId, mcpServerName, displayName, and toolNames',
      condition: { field: 'operation', value: 'list_organization_mcp_connections' },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page is available',
      condition: { field: 'operation', value: ORGANIZATION_LIST_OPERATIONS },
    },
    nextCursor: {
      type: 'string',
      description: 'Next page cursor, or null',
      condition: { field: 'operation', value: ORGANIZATION_LIST_OPERATIONS },
    },
  },
}
