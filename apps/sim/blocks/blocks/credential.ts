import { CredentialIcon } from '@/components/icons'
import { CREDENTIAL_GROUP_EVENT_TRIGGER_ID } from '@/lib/credential-groups/trigger-constants'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const ORGANIZATION_OPERATIONS = [
  'find_organization_account',
  'list_organization_accounts',
  'find_organization_mcp_connection',
  'list_organization_mcp_connections',
]
const ORGANIZATION_LIST_OPERATIONS = [
  'list_organization_accounts',
  'list_organization_mcp_connections',
]
const OAUTH_FIND_OPERATIONS = ['select', 'find_organization_account']
const MCP_OPERATIONS = ['find_organization_mcp_connection', 'list_organization_mcp_connections']

export const CredentialBlock: BlockConfig = {
  type: 'credential',
  name: 'Credential',
  description: 'Select credentials or find organization accounts and MCP connections',
  longDescription:
    'Select workspace OAuth credentials or find and list organization accounts in an allowlisted workspace. Organization accounts are shared with every authorized workflow in that workspace. Returns credential references and account metadata. Manage invitations in organization settings.',
  bestPractices: `
  - Use "Select Credential" to define an OAuth credential once and reference <CredentialBlock.credentialId> in multiple downstream blocks instead of repeating credential IDs.
  - Use "List Credentials" with a ForEach loop to iterate over all OAuth accounts (e.g. all Gmail accounts).
  - Use the Provider filter to narrow results to specific services (e.g. Gmail, Slack).
  - The outputs are credential ID references, not secret values — they are safe to log and inspect.
  - To switch credentials across environments, replace the single Credential block rather than updating every downstream block.
  `,
  docsLink: 'https://docs.sim.ai/workflows/blocks/credential',
  bgColor: '#6366F1',
  icon: CredentialIcon,
  canvasPresentation: {
    defaultTitle: 'Credential',
    sentences: {
      byOperation: {
        select: ['Select an OAuth credential'],
        list: ['List OAuth credentials', { text: 'for', field: 'providerFilter' }],
        find_organization_account: ['Find organization account', { text: 'for', field: 'email' }],
        list_organization_accounts: ['List organization accounts', { text: 'for', field: 'email' }],
        find_organization_mcp_connection: [
          'Find organization MCP connection',
          { text: 'for', field: 'email' },
        ],
        list_organization_mcp_connections: [
          'List organization MCP connections',
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
        { label: 'Find Organization Account', id: 'find_organization_account' },
        { label: 'List Organization Accounts', id: 'list_organization_accounts' },
        { label: 'Find Organization MCP Connection', id: 'find_organization_mcp_connection' },
        { label: 'List Organization MCP Connections', id: 'list_organization_mcp_connections' },
      ],
      value: () => 'select',
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
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'person@example.com',
      condition: { field: 'operation', value: ORGANIZATION_OPERATIONS },
      required: {
        field: 'operation',
        value: ['find_organization_account', 'find_organization_mcp_connection'],
      },
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
    operation: { type: 'string', description: 'Credential operation' },
    email: { type: 'string', description: 'Enrollment email' },
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
    credentialId: {
      type: 'string',
      description: "Credential ID — pipe into other blocks' credential fields",
      condition: {
        field: 'operation',
        value: [...OAUTH_FIND_OPERATIONS, 'find_organization_mcp_connection'],
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
        'Array of OAuth credential objects, each with credentialId, displayName, and providerId',
      condition: { field: 'operation', value: ['list', 'list_organization_accounts'] },
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
        value: ['find_organization_account', 'find_organization_mcp_connection'],
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
