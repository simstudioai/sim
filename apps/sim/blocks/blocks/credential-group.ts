import { GridOffset } from '@sim/emcn/icons'
import { CREDENTIAL_GROUP_EVENT_TRIGGER_ID } from '@/lib/credential-groups/trigger-constants'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

interface CredentialGroupBlockOutput {
  success: boolean
  output: {
    credentials: Array<{
      credentialId: string
      email: string
      displayName: string
      providerId: string
      providerSubjectId: string
      providerTenantId: string | null
    }>
    mcpConnections: Array<{
      credentialId: string
      email: string
      displayName: string
      mcpServerId: string
      mcpServerName: string
      toolNames: string[]
    }>
    people: Array<{
      id: string
      email: string
      status: string
      expired: boolean
      invitedAt: string
      connections: Array<{ provider: string; status: string; count: number }>
    }>
    enrollmentId: string
    email: string
    status: string
    invitedAt: string
    expiresAt: string
    invitationLink: string
    count: number
    hasMore: boolean
    nextCursor: string | null
  }
}

const INVITE_OPERATIONS = ['send_invite', 'get_invite_link'] as const
const LIST_OPERATIONS = ['list_credentials', 'list_mcp_connections', 'list_people'] as const

export const CredentialGroupBlock: BlockConfig<CredentialGroupBlockOutput> = {
  type: 'credential_group',
  name: 'Connected Accounts (Legacy)',
  hideFromToolbar: true,
  description: 'Invite people and use connected accounts in this workspace',
  longDescription:
    'List usable managed credentials or MCP connections, inspect invited people, send an invitation, or generate an account-connection link in the current workspace. The block returns credential IDs and account metadata without exposing OAuth tokens.',
  bestPractices: `
  - "List Credentials" returns every active credential. Filter by email to select one enrolled person, by provider to select one account type, or by both for an exact match.
  - Provider blocks can use the current actor's enrolled credential by default. Using another enrollment requires an explicit workflow access grant.
  - With a workflow access grant, use "List Credentials" with a ForEach loop to run a provider block once for every connected account.
  - Continue with nextCursor until hasMore is false when a list operation returns multiple pages.
  - "List Credentials" returns active, usable credentials only. Reconnect-needed and revoked credentials are excluded.
  - "List MCP Connections" returns explicit managed MCP credential IDs and tool names. Pass one credentialId to an advanced MCP server tool.
  - Use "List People" to inspect invitation and connection progress without exposing credential secrets.
  - "Send Invite" sends one email. Use a loop when invitations should come from a dynamic list.
  - "Get Invite Link" issues a fresh seven-day bearer link without sending email. It invalidates the previous link for that email, so treat the output as a secret.
  `,
  docsLink: 'https://docs.sim.ai/workflows/blocks/credential-group',
  bgColor: '#8B5CF6',
  icon: GridOffset,
  canvasPresentation: {
    defaultTitle: 'Connected Accounts',
    sentences: {
      byOperation: {
        list_credentials: [
          'List connected accounts',
          { text: ', for', field: 'email' },
          { text: ', from', field: ['providerFilter', 'manualProviderIds'] },
          { text: ', up to', field: 'limit', after: 'accounts' },
        ],
        list_mcp_connections: [
          'List MCP connections',
          { text: ', for', field: 'email' },
          { text: ', on server', field: 'mcpServerId' },
          { text: ', up to', field: 'limit', after: 'connections' },
        ],
        send_invite: [{ text: 'Invite', field: 'email', core: true }],
        get_invite_link: [{ text: 'Get invite link for', field: 'email', core: true }],
        list_people: [
          'List invited people',
          { text: ', matching', field: 'email' },
          { text: ', with status', field: 'peopleStatuses' },
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
        { label: 'List Credentials', id: 'list_credentials' },
        { label: 'List MCP Connections', id: 'list_mcp_connections' },
        { label: 'Send Invite', id: 'send_invite' },
        { label: 'Get Invite Link', id: 'get_invite_link' },
        { label: 'List People', id: 'list_people' },
      ],
      value: () => 'list_credentials',
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      required: { field: 'operation', value: [...INVITE_OPERATIONS] },
      placeholder: 'person@example.com',
    },
    {
      id: 'providerFilter',
      title: 'Provider',
      type: 'dropdown',
      selectorKey: 'workspace.credentialGroupProviders',
      multiSelect: true,
      emptyIsValid: true,
      required: false,
      mode: 'basic',
      canonicalParamId: 'credentialProviderIds',
      condition: { field: 'operation', value: 'list_credentials' },
    },
    {
      id: 'manualProviderIds',
      title: 'Provider IDs',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      canonicalParamId: 'credentialProviderIds',
      placeholder: '["google-email", "slack"] — leave empty for all providers',
      condition: { field: 'operation', value: 'list_credentials' },
    },
    {
      id: 'mcpServerId',
      title: 'MCP Server ID',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'mcp-... — leave empty for all MCP servers',
      condition: { field: 'operation', value: 'list_mcp_connections' },
    },
    {
      id: 'peopleStatuses',
      title: 'Status',
      type: 'dropdown',
      multiSelect: true,
      emptyIsValid: true,
      options: [
        { label: 'Invited', id: 'invited' },
        { label: 'Delivery failed', id: 'delivery_failed' },
        { label: 'In progress', id: 'in_progress' },
        { label: 'Connected', id: 'completed' },
        { label: 'Revoked', id: 'revoked' },
      ],
      condition: { field: 'operation', value: 'list_people' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      value: () => '100',
      mode: 'advanced',
      placeholder: '1-100',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'nextCursor from a previous page',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    ...getTrigger(CREDENTIAL_GROUP_EVENT_TRIGGER_ID).subBlocks,
  ],
  tools: { access: [] },
  inputs: {
    operation: {
      type: 'string',
      description:
        "'list_credentials', 'list_mcp_connections', 'send_invite', 'get_invite_link', or 'list_people'",
    },
    email: {
      type: 'string',
      description: 'Recipient email for invites or an optional credential/people-list filter',
    },
    credentialProviderIds: {
      type: 'json',
      description: 'Optional OAuth provider IDs to include when listing credentials',
    },
    mcpServerId: {
      type: 'string',
      description: 'Optional root MCP server ID to include when listing MCP connections',
    },
    peopleStatuses: {
      type: 'json',
      description: 'Optional invitation statuses to include when listing people',
    },
    limit: { type: 'number', description: 'Maximum results per page (1-100)' },
    cursor: { type: 'string', description: 'nextCursor from a previous page' },
  },
  outputs: {
    credentials: {
      type: 'json',
      description:
        'Usable credential references (credentialId, email, displayName, providerId, providerSubjectId, providerTenantId)',
      condition: { field: 'operation', value: 'list_credentials' },
    },
    mcpConnections: {
      type: 'json',
      description:
        'Usable MCP connection references (credentialId, email, displayName, mcpServerId, mcpServerName, toolNames)',
      condition: { field: 'operation', value: 'list_mcp_connections' },
    },
    people: {
      type: 'json',
      description:
        'Invited people and current connection summaries (id, email, status, expired, invitedAt, connections)',
      condition: { field: 'operation', value: 'list_people' },
    },
    enrollmentId: {
      type: 'string',
      description: 'Enrollment ID created or refreshed by the invitation',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    email: {
      type: 'string',
      description: 'Normalized invitation recipient email',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    status: {
      type: 'string',
      description: 'Invitation status',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    invitedAt: {
      type: 'string',
      description: 'Invitation timestamp',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    expiresAt: {
      type: 'string',
      description: 'Invitation expiration timestamp',
      condition: { field: 'operation', value: [...INVITE_OPERATIONS] },
    },
    invitationLink: {
      type: 'string',
      description: 'Fresh bearer invitation link for the recipient',
      condition: { field: 'operation', value: 'get_invite_link' },
    },
    count: {
      type: 'number',
      description: 'Number of records returned',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page is available',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null on the last page',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
    },
  },
  triggers: {
    enabled: true,
    available: [CREDENTIAL_GROUP_EVENT_TRIGGER_ID],
  },
}
