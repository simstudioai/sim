import { v2MetaOperations } from '@/lib/api/application/operations'
import {
  v2ExecuteToolContract,
  v2GetBlockContract,
  v2GetToolContract,
  v2ListBlocksContract,
  v2ListConnectorTypesContract,
  v2ListToolsContract,
} from '@/lib/api/contracts/v2/catalog'
import {
  v2CreateCredentialConnectionContract,
  v2CreateServiceAccountCredentialContract,
  v2DeleteCredentialContract,
  v2ListCredentialProvidersContract,
  v2ListCredentialsContract,
  v2UpdateCredentialContract,
} from '@/lib/api/contracts/v2/credentials'
import {
  v2CreateCustomToolContract,
  v2DeleteCustomToolContract,
  v2GetCustomToolContract,
  v2ListCustomToolsContract,
  v2UpdateCustomToolContract,
} from '@/lib/api/contracts/v2/custom-tools'
import {
  v2CreateMcpServerContract,
  v2DeleteMcpServerContract,
  v2GetMcpServerContract,
  v2ListMcpServersContract,
  v2ListMcpServerToolsContract,
  v2UpdateMcpServerContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import { v2GetMetaContract } from '@/lib/api/contracts/v2/meta'
import {
  documentedSchema,
  type ErrorResponseId,
  FULL_SET_LIST,
  HEAD_MIRRORS_GET,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  V2_AUTH_SECURITY,
  V2_AUTH_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  WORKSPACE_API_KEY_DENIED,
  withErrorExamples,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2CreateSandboxContract,
  v2DeleteSandboxContract,
  v2GetSandboxContract,
  v2ListSandboxesContract,
  v2UpdateSandboxContract,
} from '@/lib/api/contracts/v2/sandboxes'
import {
  v2DeleteSecretContract,
  v2ListSecretsContract,
  v2SetSecretContract,
} from '@/lib/api/contracts/v2/secrets'
import {
  v2CreateSkillContract,
  v2DeleteSkillContract,
  v2GetSkillContract,
  v2GrantSkillEditorContract,
  v2ListSkillEditorsContract,
  v2ListSkillsContract,
  v2RevokeSkillEditorContract,
  v2UpdateSkillContract,
} from '@/lib/api/contracts/v2/skills'
import {
  v2CreateWorkflowMcpServerContract,
  v2DeleteWorkflowMcpServerContract,
  v2DeployWorkflowMcpToolContract,
  v2GetWorkflowMcpServerContract,
  v2ListWorkflowMcpServersContract,
  v2ListWorkflowMcpToolsContract,
  v2UndeployWorkflowMcpToolContract,
  v2UpdateWorkflowMcpServerContract,
} from '@/lib/api/contracts/v2/workflow-mcp-servers'
import {
  v2GetWorkspaceContract,
  v2ListWorkspaceMembersContract,
  v2ListWorkspacesContract,
} from '@/lib/api/contracts/v2/workspaces'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
} from '@/lib/api/openapi/types'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { customToolOperations } from '@/lib/custom-tools/application/operations'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'
import { secretOperations } from '@/lib/secrets/application/operations'
import { skillOperations } from '@/lib/skills/application/operations'
import { toolExecutionOperations } from '@/lib/tool-execution/application/operations'
import { workspaceOperations } from '@/lib/workspaces/application/operations'

const BLOCK_SUMMARY_EXAMPLE = {
  id: 'slack',
  name: 'Slack',
  description: 'Send messages and read channels in Slack.',
  category: 'tools',
  integrationType: 'communication',
  source: 'builtin',
  authMode: 'oauth',
  triggerAllowed: true,
  triggerCapable: true,
  triggerIds: ['slack_webhook'],
  toolIds: ['slack_message', 'slack_canvas_read'],
  operationIds: ['send', 'read'],
  preview: false,
  docsLink: 'https://docs.sim.ai/tools/slack',
  tags: ['messaging'],
} as const

const BLOCK_DETAIL_EXAMPLE = {
  ...BLOCK_SUMMARY_EXAMPLE,
  inputSchema: [
    {
      id: 'operation',
      type: 'dropdown',
      title: 'Operation',
      required: true,
      options: [
        { id: 'send', label: 'Send message' },
        { id: 'read', label: 'Read messages' },
      ],
    },
  ],
  operationInputSchema: {
    send: [{ id: 'text', type: 'long-input', title: 'Message', required: true }],
  },
  inputDefinitions: {
    channel: { type: 'string', description: 'Channel to post into.' },
  },
  operations: {
    send: {
      toolId: 'slack_message',
      toolName: 'Slack Send Message',
      description: 'Send a message to a Slack channel.',
      inputs: { text: { type: 'string', required: true, description: 'Message body.' } },
      outputs: { ts: { type: 'string', description: 'Message timestamp.' } },
      inputSchema: [{ id: 'text', type: 'long-input', title: 'Message', required: true }],
    },
  },
  tools: [
    {
      id: 'slack_message',
      name: 'Slack Send Message',
      description: 'Send a message to a Slack channel.',
      version: '1.0.0',
      hostedApiKey: 'none',
      oauth: { required: true, provider: 'slack', requiredScopes: ['chat:write'] },
      params: { text: { type: 'string', required: true, description: 'Message body.' } },
      outputs: { ts: { type: 'string', description: 'Message timestamp.' } },
    },
  ],
  triggers: [
    {
      id: 'slack_webhook',
      outputs: { text: { type: 'string', description: 'Message text.' } },
      configFields: {
        channels: { type: 'short-input', required: false, title: 'Channels' },
      },
    },
  ],
  outputs: { ts: { type: 'string', description: 'Message timestamp.' } },
} as const

const CONNECTOR_TYPE_EXAMPLE = {
  connectorType: 'google_drive',
  name: 'Google Drive',
  description: 'Sync documents from a Google Drive folder.',
  version: '1.0.0',
  auth: {
    mode: 'oauth',
    provider: 'google-drive',
    requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
  },
  configFields: [
    {
      id: 'folderSelector',
      title: 'Folder',
      type: 'selector',
      selectorKey: 'google-drive-folder',
      mimeType: 'application/vnd.google-apps.folder',
      mode: 'basic',
      canonicalParamId: 'folderId',
      required: true,
    },
    {
      id: 'manualFolderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Enter the folder ID',
      mode: 'advanced',
      canonicalParamId: 'folderId',
    },
  ],
  supportsIncrementalSync: true,
  tagDefinitions: [{ id: 'owner', displayName: 'Owner', fieldType: 'text' }],
} as const

/**
 * `GET /api/v2/meta` resolves no workspace and no resource, so it cannot emit
 * the `403` every workspace-scoped operation can, nor a `404`. A documented
 * status an operation cannot emit is worse than none.
 */
const META_ERRORS = [
  'BadRequest',
  'Unauthorized',
  'RateLimited',
  'InternalError',
  'ServiceUnavailable',
] as const satisfies readonly ErrorResponseId[]

const TOOL_SUMMARY_EXAMPLE = {
  id: 'slack_message',
  name: 'Slack Send Message',
  description: 'Send a message to a Slack channel.',
  version: '1.0.0',
  hostedApiKey: 'none',
  oauth: { required: true, provider: 'slack', requiredScopes: ['chat:write'] },
} as const

const TOOL_EXECUTION_EXAMPLE = {
  toolId: 'slack_message',
  status: 'succeeded',
  output: { ts: '1718191234.004500' },
  error: null,
} as const

const SANDBOX_ADMIN_PLAN_NOTE =
  'Requires a workspace admin on Max or Enterprise; lower plans return `403` with `error.details.code: WORKSPACE_PLAN_CAPABILITY_REQUIRED`.'
const SANDBOX_BUILD_BUDGET_NOTE =
  'Creates and updates share a write budget; bursts return `429` with `Retry-After`.'

const TOOL_DETAIL_EXAMPLE = {
  ...TOOL_SUMMARY_EXAMPLE,
  params: {
    channel: { type: 'string', required: true, description: 'Channel ID to post into.' },
    text: { type: 'string', required: true, description: 'Message body.' },
  },
  outputs: { ts: { type: 'string', description: 'Message timestamp.' } },
} as const

const WORKFLOW_MCP_SERVER_EXAMPLE = {
  id: 'wfmcp_01J8ZK3QW4M6X2R9T7B5C0V2',
  name: 'Support agents',
  description: 'Ticket triage and escalation workflows.',
  isPublic: false,
  mcpServerUrl: 'https://www.sim.ai/api/mcp/serve/wfmcp_01J8ZK3QW4M6X2R9T7B5C0V2',
  createdAt: '2026-06-12T10:30:00.000Z',
  updatedAt: '2026-06-12T10:30:00.000Z',
} as const

const WORKFLOW_MCP_SERVER_LIST_EXAMPLE = {
  ...WORKFLOW_MCP_SERVER_EXAMPLE,
  toolCount: 1,
  toolNames: ['triage_ticket'],
} as const

const WORKFLOW_MCP_TOOL_EXAMPLE = {
  id: 'wfmcptool_01J8ZK3QW4M6X2R9T7B5C0V3',
  serverId: WORKFLOW_MCP_SERVER_EXAMPLE.id,
  workflowId: '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36',
  toolName: 'triage_ticket',
  toolDescription: 'Execute Ticket triage workflow',
  mcpServerUrl: WORKFLOW_MCP_SERVER_EXAMPLE.mcpServerUrl,
  apiEndpoint: 'https://www.sim.ai/api/v2/workflows/3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36/execute',
  updated: false,
  createdAt: '2026-06-12T10:30:00.000Z',
  updatedAt: '2026-06-12T10:30:00.000Z',
} as const

/** The publish example as a read returns it: `updated` is a publish outcome, not a field of the tool. */
function omitUpdated({ updated: _updated, ...tool }: typeof WORKFLOW_MCP_TOOL_EXAMPLE) {
  return tool
}

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'

const WORKSPACE_EXAMPLE = {
  id: WORKSPACE_ID,
  name: 'Engineering',
  color: '#33C482',
  logoUrl: null,
  memberCount: 14,
  createdAt: '2026-01-15T10:30:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
} as const

const WORKSPACE_MEMBER_EXAMPLE = {
  email: 'jane@example.com',
  name: 'Jane Smith',
  image: null,
  role: 'admin',
  isExternal: false,
  joinedAt: '2026-01-15T10:30:00.000Z',
} as const

const MCP_SERVER_EXAMPLE = {
  id: 'mcp-3f7a9c21',
  name: 'Docs server',
  description: 'Internal documentation tools',
  transport: 'streamable-http',
  authType: 'headers',
  url: 'https://mcp.example.com/sse',
  timeout: 30_000,
  retries: 3,
  enabled: true,
  connectionStatus: 'connected',
  lastError: null,
  toolCount: 7,
  lastToolsRefresh: '2026-06-20T14:02:11.000Z',
  lastConnected: '2026-06-20T14:02:11.000Z',
  createdAt: '2026-06-01T09:14:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
  hasHeaders: true,
  headerNames: ['Authorization'],
  hasOauthClientSecret: false,
} as const

/**
 * What registration actually returns, as distinct from {@link MCP_SERVER_EXAMPLE},
 * which shows a server a discovery has already reached. Reusing the discovered
 * example on the create response advertised a connection the call does not make.
 */
const MCP_SERVER_REGISTERED_EXAMPLE = (() => {
  const { lastToolsRefresh: _refresh, lastConnected: _connected, ...rest } = MCP_SERVER_EXAMPLE
  return { ...rest, connectionStatus: 'disconnected', toolCount: 0 } as const
})()

const MCP_TOOL_EXAMPLE = {
  name: 'search_docs',
  description: 'Search the internal documentation',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search terms' } },
    required: ['query'],
  },
  serverId: 'mcp-3f7a9c21',
  serverName: 'Docs server',
} as const

const SKILL_SUMMARY_EXAMPLE = {
  id: 'V1StGXR8Z5jdHi6BmyT',
  name: 'refund-policy',
  description: 'How support should handle refund requests',
  readOnly: false,
  createdAt: '2026-06-01T09:14:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
} as const

const SKILL_EXAMPLE = {
  ...SKILL_SUMMARY_EXAMPLE,
  content: '# Refund policy\n\nAlways check the order date first.',
} as const

const SKILL_EDITOR_EXAMPLE = {
  email: 'jane@example.com',
  name: 'Jane Smith',
  image: null,
  isWorkspaceAdmin: false,
} as const

const CUSTOM_TOOL_DECLARATION_EXAMPLE = {
  type: 'function',
  function: {
    name: 'lookup_order',
    description: 'Look up an order by id',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
  },
} as const

const CUSTOM_TOOL_EXAMPLE = {
  id: 'V1StGXR8Z5jdHi6BmyT',
  title: 'lookup_order',
  schema: CUSTOM_TOOL_DECLARATION_EXAMPLE,
  code: 'return { ok: true }',
  createdAt: '2026-06-01T09:14:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
} as const

/**
 * No managed CLI in the example: the catalog pins exact versions that rotate
 * with every upgrade, and an example naming one would break the spec check on
 * each bump.
 */
const SANDBOX_EXAMPLE = {
  id: 'V1StGXR8Z5jdHi6BmyT',
  name: 'data-tools',
  language: 'python',
  dependencies: ['pandas==2.2.2', 'requests'],
  cliTools: [],
  systemPackages: ['graphviz'],
  buildStatus: 'ready',
  errorCode: null,
  errorMessage: null,
  errorDetail: null,
  builtAt: '2026-06-20T14:05:40.000Z',
  createdAt: '2026-06-01T09:14:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
} as const

const CREDENTIAL_EXAMPLE = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  type: 'service_account',
  displayName: 'Zoom service account',
  description: null,
  providerId: 'zoom-service-account',
  accountId: null,
  hasServiceAccountKey: true,
  role: 'admin',
  createdAt: '2026-06-01T09:14:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
} as const

const CREDENTIAL_PROVIDER_EXAMPLE = {
  type: 'oauth',
  serviceId: 'salesforce',
  name: 'Salesforce',
  description: 'Connect to Salesforce CRM data and operations.',
  providerFamily: 'salesforce',
  available: true,
  supportsReconnect: true,
  fields: [],
  authorizationOptions: [
    { providerId: 'salesforce', label: 'Production' },
    { providerId: 'salesforce-sandbox', label: 'Sandbox' },
  ],
} as const

const SERVICE_ACCOUNT_PROVIDER_EXAMPLE = {
  type: 'service_account',
  serviceId: 'zoom-service-account',
  providerId: 'zoom-service-account',
  name: 'Zoom server-to-server app',
  description: 'Connect Zoom with a server-to-server app.',
  providerFamily: 'zoom',
  available: true,
  docsUrl: 'https://docs.sim.ai/integrations/zoom-service-account',
  requiresClientGeneratedCredentialId: false,
  fields: [
    {
      id: 'clientId',
      label: 'Client ID',
      placeholder: 'Paste the client ID',
      required: true,
      secret: false,
      multiline: false,
    },
    {
      id: 'clientSecret',
      label: 'Client secret',
      placeholder: 'Paste the client secret',
      required: true,
      secret: true,
      multiline: false,
    },
    {
      id: 'orgId',
      label: 'Account ID',
      placeholder: 'Paste the account ID',
      required: true,
      secret: false,
      multiline: false,
    },
  ],
} as const

const CREDENTIAL_CONNECTION_EXAMPLE = {
  authorizationUrl: 'https://www.sim.ai/api/auth/oauth2/authorize?draftId=draft-123',
  expiresAt: '2026-06-20T14:17:11.000Z',
} as const

const SECRET_EXAMPLE = {
  name: 'STRIPE_API_KEY',
  scope: 'workspace',
  description: 'Production billing key — rotate quarterly.',
  unredacted: false,
  role: 'admin',
  createdAt: '2026-06-01T09:14:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
} as const

const VISIBLE_SECRET_EXAMPLE = {
  name: 'STAGING_BASE_URL',
  scope: 'workspace',
  description: 'Staging environment base URL.',
  unredacted: true,
  role: 'member',
  createdAt: '2026-06-03T11:30:00.000Z',
  updatedAt: '2026-06-21T08:45:09.000Z',
  value: 'https://staging.example.com',
} as const

type ResourceTag =
  | 'Meta'
  | 'Workspaces'
  | 'MCP Servers'
  | 'Skills'
  | 'Custom Tools'
  | 'Sandboxes'
  | 'Credentials'
  | 'Secrets'
  | 'Catalog'

function resourceOperation(
  tag: ResourceTag,
  operation: Omit<OpenApiOperationMetadata, 'tags' | 'success' | 'errors'> & {
    errors: readonly ErrorResponseId[]
    success: OpenApiOperationMetadata['success']
  }
): OpenApiOperationMetadata {
  const success =
    'byStatus' in operation.success
      ? {
          byStatus: Object.fromEntries(
            Object.entries(operation.success.byStatus).map(([status, metadata]) => [
              status,
              {
                ...metadata,
                headers: [...(metadata.headers ?? []), ...RATE_LIMIT_HEADERS],
              },
            ])
          ),
        }
      : {
          ...operation.success,
          headers: [...(operation.success.headers ?? []), ...RATE_LIMIT_HEADERS],
        }
  return {
    ...operation,
    tags: [tag],
    success,
  }
}

const declaredRoutes = [
  defineOpenApiRoute(
    v2ListWorkspacesContract,
    resourceOperation('Workspaces', {
      applicationOperation: workspaceOperations.listPublic,
      operationId: 'listWorkspaces',
      summary: 'List Workspaces',
      description:
        'List active workspaces available to the calling credential with opaque cursor pagination. A personal API key or OAuth token sees accessible workspaces that permit user-held API credentials; a workspace API key sees only its bound workspace.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Public metadata for workspaces available to the credential.' },
    }),
    {
      query: documentedSchema(
        v2ListWorkspacesContract.query,
        'ListWorkspacesQuery',
        'List workspaces query',
        'Sorting and pagination controls for accessible workspaces.'
      ),
      response: documentedSchema(
        v2ListWorkspacesContract.response.schema,
        'ListWorkspacesResponse',
        'List workspaces response',
        'Public metadata for workspaces available to the credential.',
        [{ data: [WORKSPACE_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceContract,
    resourceOperation('Workspaces', {
      applicationOperation: workspaceOperations.readPublicDetail,
      operationId: 'getWorkspace',
      summary: 'Get Workspace',
      description:
        'Return public metadata for one accessible workspace. Governance identities, billing identities, and internal membership identifiers are intentionally omitted.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Public workspace metadata.' },
    }),
    {
      query: v2GetWorkspaceContract.query,
      params: documentedSchema(
        v2GetWorkspaceContract.params,
        'GetWorkspaceParams',
        'Get workspace path parameters',
        'Workspace selected for retrieval.'
      ),
      response: documentedSchema(
        v2GetWorkspaceContract.response.schema,
        'GetWorkspaceResponse',
        'Get workspace response',
        'Public metadata for one workspace.',
        [{ data: WORKSPACE_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkspaceMembersContract,
    resourceOperation('Workspaces', {
      applicationOperation: workspaceOperations.listPublicMembers,
      operationId: 'listWorkspaceMembers',
      summary: 'List Workspace Members',
      description:
        "List the workspace's effective members ordered by email. Explicit workspace grants and inherited organization-administrator grants are merged; internal membership and billing identities are omitted.",
      errors: RESOURCE_ERRORS,
      success: { description: 'An email-ordered page of effective workspace members.' },
    }),
    {
      params: documentedSchema(
        v2ListWorkspaceMembersContract.params,
        'ListWorkspaceMembersParams',
        'List workspace members path parameters',
        'Workspace whose effective members should be listed.'
      ),
      query: documentedSchema(
        v2ListWorkspaceMembersContract.query,
        'ListWorkspaceMembersQuery',
        'List workspace members query',
        'Pagination controls for the member roster.'
      ),
      response: documentedSchema(
        v2ListWorkspaceMembersContract.response.schema,
        'ListWorkspaceMembersResponse',
        'List workspace members response',
        'A cursor-paginated page of effective workspace members.',
        [{ data: [WORKSPACE_MEMBER_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListMcpServersContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.list,
      operationId: 'listMcpServers',
      summary: 'List MCP Servers',
      description:
        'List MCP servers registered in a workspace. Request-header values and OAuth client secrets are never returned. The discovery fields stay at their registration defaults until `GET /api/v2/mcp-servers/{mcpServerId}/tools` runs a discovery.',
      errors: RESOURCE_ERRORS,
      success: { description: 'MCP servers registered in the workspace.' },
    }),
    {
      query: documentedSchema(
        v2ListMcpServersContract.query,
        'ListMcpServersQuery',
        'List MCP servers query',
        'Workspace, search, sorting, and pagination controls for MCP servers.'
      ),
      response: documentedSchema(
        v2ListMcpServersContract.response.schema,
        'ListMcpServersResponse',
        'List MCP servers response',
        'MCP servers registered in the workspace.',
        [{ data: [MCP_SERVER_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateMcpServerContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.create,
      operationId: 'createMcpServer',
      summary: 'Create MCP Server',
      description:
        'Register an MCP server in a workspace. The endpoint URL is the server identity, so a URL already registered here is a `409` — reconfigure that server with `PATCH /api/v2/mcp-servers/{mcpServerId}` instead. Registration never connects to the endpoint: the server comes back `disconnected` and stays unavailable until `GET /api/v2/mcp-servers/{mcpServerId}/tools` succeeds.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The MCP server was registered.' },
    }),
    {
      query: v2CreateMcpServerContract.query,
      body: documentedSchema(
        v2CreateMcpServerContract.body,
        'CreateMcpServerRequest',
        'Create MCP server request',
        'Configuration for a new MCP server.',
        [
          {
            workspaceId: WORKSPACE_ID,
            name: 'Docs server',
            url: 'https://mcp.example.com/sse',
            authType: 'headers',
            headers: { Authorization: 'Bearer YOUR_TOKEN' },
          },
        ]
      ),
      response: documentedSchema(
        v2CreateMcpServerContract.response.schema,
        'CreateMcpServerResponse',
        'Create MCP server response',
        'The registered MCP server without write-only credentials.',
        [{ data: MCP_SERVER_REGISTERED_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetMcpServerContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.read,
      operationId: 'getMcpServer',
      summary: 'Get MCP Server',
      description:
        'Fetch one MCP server by identifier. Request-header values and OAuth client secrets are never returned.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The MCP server.' },
    }),
    {
      params: documentedSchema(
        v2GetMcpServerContract.params,
        'GetMcpServerParams',
        'Get MCP server path parameters',
        'MCP server selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetMcpServerContract.query,
        'GetMcpServerQuery',
        'Get MCP server query',
        'Workspace scope for the MCP server.'
      ),
      response: documentedSchema(
        v2GetMcpServerContract.response.schema,
        'GetMcpServerResponse',
        'Get MCP server response',
        'One MCP server without write-only credentials.',
        [{ data: MCP_SERVER_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateMcpServerContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.update,
      operationId: 'updateMcpServer',
      summary: 'Update MCP Server',
      description:
        'Update the supplied MCP server fields. Omitted fields are retained, except where a field says otherwise. Any change that invalidates authentication revokes the stored OAuth grant, resets `connectionStatus` to `disconnected`, and clears `lastConnected` and `lastError`, so the server must be rediscovered.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The updated MCP server.' },
    }),
    {
      query: v2UpdateMcpServerContract.query,
      params: documentedSchema(
        v2UpdateMcpServerContract.params,
        'UpdateMcpServerParams',
        'Update MCP server path parameters',
        'MCP server selected for update.'
      ),
      body: documentedSchema(
        v2UpdateMcpServerContract.body,
        'UpdateMcpServerRequest',
        'Update MCP server request',
        'MCP server fields to change; omitted fields retain their stored values.',
        [{ workspaceId: WORKSPACE_ID, enabled: false }]
      ),
      response: documentedSchema(
        v2UpdateMcpServerContract.response.schema,
        'UpdateMcpServerResponse',
        'Update MCP server response',
        'The updated MCP server.',
        [{ data: { ...MCP_SERVER_EXAMPLE, enabled: false } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteMcpServerContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.delete,
      operationId: 'deleteMcpServer',
      summary: 'Delete MCP Server',
      description:
        "Remove an MCP server and revoke its OAuth tokens. Workflows retain blocks that referenced the server's tools, but those tools can no longer be called.",
      errors: RESOURCE_ERRORS,
      success: { description: 'The MCP server was deleted.' },
    }),
    {
      params: documentedSchema(
        v2DeleteMcpServerContract.params,
        'DeleteMcpServerParams',
        'Delete MCP server path parameters',
        'MCP server selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteMcpServerContract.query,
        'DeleteMcpServerQuery',
        'Delete MCP server query',
        'Workspace scope for the MCP server.'
      ),
      response: documentedSchema(
        v2DeleteMcpServerContract.response.schema,
        'DeleteMcpServerResponse',
        'Delete MCP server response',
        'Acknowledgement that the MCP server was deleted.',
        [{ data: { id: MCP_SERVER_EXAMPLE.id, deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListMcpServerToolsContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.discoverTools,
      operationId: 'listMcpServerTools',
      summary: 'List MCP Server Tools',
      description: `Return up to 1,000 tools and 5 MB with \`nextCursor: null\`, opening a connection and updating connection metadata. ${HEAD_MIRRORS_GET} Unavailable servers return \`503\`; invalid OAuth returns \`409\` with \`error.details.code: MCP_SERVER_REAUTHORIZATION_REQUIRED\` and requires human reauthorization. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Tools exposed by the MCP server.' },
    }),
    {
      params: documentedSchema(
        v2ListMcpServerToolsContract.params,
        'ListMcpServerToolsParams',
        'List MCP server tools path parameters',
        'MCP server whose tools should be listed.'
      ),
      query: documentedSchema(
        v2ListMcpServerToolsContract.query,
        'ListMcpServerToolsQuery',
        'List MCP server tools query',
        'Workspace scope and cache control for tool discovery.'
      ),
      response: documentedSchema(
        v2ListMcpServerToolsContract.response.schema,
        'ListMcpServerToolsResponse',
        'List MCP server tools response',
        'Tools exposed by the MCP server.',
        [{ data: [MCP_TOOL_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListSkillsContract,
    resourceOperation('Skills', {
      applicationOperation: skillOperations.list,
      operationId: 'listSkills',
      summary: 'List Skills',
      description:
        'List workspace and built-in skills with opaque cursor pagination. Built-ins are marked read-only. The list omits skill bodies; fetch one skill to read its content.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Skills available in the workspace.' },
    }),
    {
      query: documentedSchema(
        v2ListSkillsContract.query,
        'ListSkillsQuery',
        'List skills query',
        'Workspace, search, and sorting controls for skills.'
      ),
      response: documentedSchema(
        v2ListSkillsContract.response.schema,
        'ListSkillsResponse',
        'List skills response',
        'Skill summaries available in the workspace.',
        [{ data: [SKILL_SUMMARY_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateSkillContract,
    resourceOperation('Skills', {
      applicationOperation: skillOperations.create,
      operationId: 'createSkill',
      summary: 'Create Skill',
      description: `Create one skill in a workspace. Its kebab-case name must be unique and cannot be reserved by a built-in skill. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The skill was created.' },
    }),
    {
      query: v2CreateSkillContract.query,
      body: documentedSchema(
        v2CreateSkillContract.body,
        'CreateSkillRequest',
        'Create skill request',
        'Definition of a new skill.',
        [
          {
            workspaceId: WORKSPACE_ID,
            name: SKILL_EXAMPLE.name,
            description: SKILL_EXAMPLE.description,
            content: SKILL_EXAMPLE.content,
          },
        ]
      ),
      response: documentedSchema(
        v2CreateSkillContract.response.schema,
        'CreateSkillResponse',
        'Create skill response',
        'The created skill including its content.',
        [{ data: SKILL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSkillContract,
    resourceOperation('Skills', {
      applicationOperation: skillOperations.read,
      operationId: 'getSkill',
      summary: 'Get Skill',
      description:
        'Fetch one workspace or built-in skill, including its full content. Built-in skills are marked read-only.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The skill.' },
    }),
    {
      params: documentedSchema(
        v2GetSkillContract.params,
        'GetSkillParams',
        'Get skill path parameters',
        'Skill selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetSkillContract.query,
        'GetSkillQuery',
        'Get skill query',
        'Workspace scope for the skill.'
      ),
      response: documentedSchema(
        v2GetSkillContract.response.schema,
        'GetSkillResponse',
        'Get skill response',
        'One skill including its full content.',
        [{ data: SKILL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateSkillContract,
    resourceOperation('Skills', {
      applicationOperation: skillOperations.update,
      operationId: 'updateSkill',
      summary: 'Update Skill',
      description: `Update the supplied fields on a workspace skill. Omitted fields retain their stored values. Built-in skills are read-only. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated skill.' },
    }),
    {
      query: v2UpdateSkillContract.query,
      params: documentedSchema(
        v2UpdateSkillContract.params,
        'UpdateSkillParams',
        'Update skill path parameters',
        'Skill selected for update.'
      ),
      body: documentedSchema(
        v2UpdateSkillContract.body,
        'UpdateSkillRequest',
        'Update skill request',
        'Skill fields to change; at least one editable field is required.',
        [{ workspaceId: WORKSPACE_ID, description: 'Updated refund guidance' }]
      ),
      response: documentedSchema(
        v2UpdateSkillContract.response.schema,
        'UpdateSkillResponse',
        'Update skill response',
        'The updated skill including its full content.',
        [{ data: { ...SKILL_EXAMPLE, description: 'Updated refund guidance' } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteSkillContract,
    resourceOperation('Skills', {
      applicationOperation: skillOperations.delete,
      operationId: 'deleteSkill',
      summary: 'Delete Skill',
      description: `Delete a workspace skill. Built-in skills are read-only and cannot be deleted. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The skill was deleted.' },
    }),
    {
      params: documentedSchema(
        v2DeleteSkillContract.params,
        'DeleteSkillParams',
        'Delete skill path parameters',
        'Skill selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteSkillContract.query,
        'DeleteSkillQuery',
        'Delete skill query',
        'Workspace scope for the skill.'
      ),
      response: documentedSchema(
        v2DeleteSkillContract.response.schema,
        'DeleteSkillResponse',
        'Delete skill response',
        'Acknowledgement that the skill was deleted.',
        [{ data: { id: SKILL_EXAMPLE.id, deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListSkillEditorsContract,
    resourceOperation('Skills', {
      applicationOperation: skillOperations.listEditors,
      operationId: 'listSkillEditors',
      summary: 'List Skill Editors',
      description:
        'List explicit skill editors and workspace administrators with opaque cursor pagination. Internal user and membership identifiers are never returned.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Users who can edit the skill.' },
    }),
    {
      params: documentedSchema(
        v2ListSkillEditorsContract.params,
        'ListSkillEditorsParams',
        'List skill editors path parameters',
        'Skill whose editor roster should be listed.'
      ),
      query: documentedSchema(
        v2ListSkillEditorsContract.query,
        'ListSkillEditorsQuery',
        'List skill editors query',
        'Workspace, sorting, and pagination controls for the editor roster.'
      ),
      response: documentedSchema(
        v2ListSkillEditorsContract.response.schema,
        'ListSkillEditorsResponse',
        'List skill editors response',
        'Public identity fields for users who can edit the skill.',
        [{ data: [SKILL_EDITOR_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GrantSkillEditorContract,
    resourceOperation('Skills', {
      applicationOperation: skillOperations.grantEditor,
      operationId: 'grantSkillEditor',
      summary: 'Grant Skill Editor',
      description: `Grant editor access to a current workspace member by email. The caller must already be a skill editor or workspace administrator. Workspace administrators already have derived editor access and cannot receive an explicit grant. A retried existing grant returns 200; a newly created grant returns 201. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: {
        byStatus: {
          200: { description: 'The workspace member was already a skill editor.' },
          201: { description: 'The skill editor grant was created.' },
        },
      },
    }),
    {
      query: v2GrantSkillEditorContract.query,
      params: documentedSchema(
        v2GrantSkillEditorContract.params,
        'GrantSkillEditorParams',
        'Grant skill editor path parameters',
        'Skill whose editor roster should be changed.'
      ),
      body: documentedSchema(
        v2GrantSkillEditorContract.body,
        'GrantSkillEditorRequest',
        'Grant skill editor request',
        'Workspace scope and email of the member to grant.',
        [{ workspaceId: WORKSPACE_ID, email: SKILL_EDITOR_EXAMPLE.email }]
      ),
      response: documentedSchema(
        v2GrantSkillEditorContract.response.schema,
        'GrantSkillEditorResponse',
        'Grant skill editor response',
        'Public identity fields for the editor.',
        [{ data: SKILL_EDITOR_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RevokeSkillEditorContract,
    resourceOperation('Skills', {
      applicationOperation: skillOperations.revokeEditor,
      operationId: 'revokeSkillEditor',
      summary: 'Revoke Skill Editor',
      description: `Revoke an explicit editor grant by email. The caller must already be a skill editor or workspace administrator. Workspace administrators have derived access that cannot be revoked. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The explicit editor grant was revoked.' },
    }),
    {
      params: documentedSchema(
        v2RevokeSkillEditorContract.params,
        'RevokeSkillEditorParams',
        'Revoke skill editor path parameters',
        'Skill whose editor roster should be changed.'
      ),
      query: documentedSchema(
        v2RevokeSkillEditorContract.query,
        'RevokeSkillEditorQuery',
        'Revoke skill editor query',
        'Workspace scope and email whose explicit grant should be revoked.'
      ),
      response: documentedSchema(
        v2RevokeSkillEditorContract.response.schema,
        'RevokeSkillEditorResponse',
        'Revoke skill editor response',
        'Acknowledgement that the explicit editor grant was revoked.',
        [{ data: { email: SKILL_EDITOR_EXAMPLE.email, revoked: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListCustomToolsContract,
    resourceOperation('Custom Tools', {
      applicationOperation: customToolOperations.list,
      operationId: 'listCustomTools',
      summary: 'List Custom Tools',
      description:
        'List code-backed custom tools defined in a workspace, with opaque cursor pagination. Legacy personal tools are excluded.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Custom tools defined in the workspace.' },
    }),
    {
      query: documentedSchema(
        v2ListCustomToolsContract.query,
        'ListCustomToolsQuery',
        'List custom tools query',
        'Workspace, search, and sorting controls for custom tools.'
      ),
      response: documentedSchema(
        v2ListCustomToolsContract.response.schema,
        'ListCustomToolsResponse',
        'List custom tools response',
        'Custom tools defined in the workspace.',
        [{ data: [CUSTOM_TOOL_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateCustomToolContract,
    resourceOperation('Custom Tools', {
      applicationOperation: customToolOperations.create,
      operationId: 'createCustomTool',
      summary: 'Create Custom Tool',
      description:
        'Create a code-backed custom tool in a workspace. Its title must be unique because tools resolve by title at call time.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The custom tool was created.' },
    }),
    {
      query: v2CreateCustomToolContract.query,
      body: documentedSchema(
        v2CreateCustomToolContract.body,
        'CreateCustomToolRequest',
        'Create custom tool request',
        'Definition and implementation of a new custom tool.',
        [
          {
            workspaceId: WORKSPACE_ID,
            title: CUSTOM_TOOL_EXAMPLE.title,
            schema: CUSTOM_TOOL_EXAMPLE.schema,
            code: CUSTOM_TOOL_EXAMPLE.code,
          },
        ]
      ),
      response: documentedSchema(
        v2CreateCustomToolContract.response.schema,
        'CreateCustomToolResponse',
        'Create custom tool response',
        'The created custom tool.',
        [{ data: CUSTOM_TOOL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetCustomToolContract,
    resourceOperation('Custom Tools', {
      applicationOperation: customToolOperations.read,
      operationId: 'getCustomTool',
      summary: 'Get Custom Tool',
      description: 'Fetch one custom tool by identifier, scoped to its workspace.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The custom tool.' },
    }),
    {
      params: documentedSchema(
        v2GetCustomToolContract.params,
        'GetCustomToolParams',
        'Get custom tool path parameters',
        'Custom tool selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetCustomToolContract.query,
        'GetCustomToolQuery',
        'Get custom tool query',
        'Workspace scope for the custom tool.'
      ),
      response: documentedSchema(
        v2GetCustomToolContract.response.schema,
        'GetCustomToolResponse',
        'Get custom tool response',
        'One custom tool.',
        [{ data: CUSTOM_TOOL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateCustomToolContract,
    resourceOperation('Custom Tools', {
      applicationOperation: customToolOperations.update,
      operationId: 'updateCustomTool',
      summary: 'Update Custom Tool',
      description:
        'Update the supplied custom tool fields. Omitted fields retain their stored values, and titles must remain unique within the workspace.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated custom tool.' },
    }),
    {
      query: v2UpdateCustomToolContract.query,
      params: documentedSchema(
        v2UpdateCustomToolContract.params,
        'UpdateCustomToolParams',
        'Update custom tool path parameters',
        'Custom tool selected for update.'
      ),
      body: documentedSchema(
        v2UpdateCustomToolContract.body,
        'UpdateCustomToolRequest',
        'Update custom tool request',
        'Custom tool fields to change; at least one editable field is required.',
        [{ workspaceId: WORKSPACE_ID, code: 'return { ok: false }' }]
      ),
      response: documentedSchema(
        v2UpdateCustomToolContract.response.schema,
        'UpdateCustomToolResponse',
        'Update custom tool response',
        'The updated custom tool.',
        [{ data: { ...CUSTOM_TOOL_EXAMPLE, code: 'return { ok: false }' } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteCustomToolContract,
    resourceOperation('Custom Tools', {
      applicationOperation: customToolOperations.delete,
      operationId: 'deleteCustomTool',
      summary: 'Delete Custom Tool',
      description:
        'Delete a custom tool. Agent blocks retain their configuration but can no longer call the deleted tool.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The custom tool was deleted.' },
    }),
    {
      params: documentedSchema(
        v2DeleteCustomToolContract.params,
        'DeleteCustomToolParams',
        'Delete custom tool path parameters',
        'Custom tool selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteCustomToolContract.query,
        'DeleteCustomToolQuery',
        'Delete custom tool query',
        'Workspace scope for the custom tool.'
      ),
      response: documentedSchema(
        v2DeleteCustomToolContract.response.schema,
        'DeleteCustomToolResponse',
        'Delete custom tool response',
        'Acknowledgement that the custom tool was deleted.',
        [{ data: { id: CUSTOM_TOOL_EXAMPLE.id, deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListSandboxesContract,
    resourceOperation('Sandboxes', {
      applicationOperation: sandboxOperations.list,
      operationId: 'listSandboxes',
      summary: 'List Sandboxes',
      description:
        'List the sandboxes defined in a workspace, with opaque cursor pagination. A sandbox is a reusable dependency set — npm or PyPI packages, pinned managed CLIs, and Debian packages — that Function blocks execute against. Listing is not plan-gated, so a workspace that dropped below the Max tier still sees what it built.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Sandboxes defined in the workspace.' },
    }),
    {
      query: documentedSchema(
        v2ListSandboxesContract.query,
        'ListSandboxesQuery',
        'List sandboxes query',
        'Workspace, search, sorting, and paging controls for sandboxes.'
      ),
      response: documentedSchema(
        v2ListSandboxesContract.response.schema,
        'ListSandboxesResponse',
        'List sandboxes response',
        'Sandboxes defined in the workspace.',
        [{ data: [SANDBOX_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateSandboxContract,
    resourceOperation('Sandboxes', {
      applicationOperation: sandboxOperations.create,
      operationId: 'createSandbox',
      summary: 'Create Sandbox',
      description: `Create a uniquely named sandbox. Prebuild deployments schedule an image build reported by \`buildStatus\`; runtime-install deployments or empty specs report \`buildStatus: null\`. Invalid dependency or system-package entries return \`400\` with field details. ${SANDBOX_ADMIN_PLAN_NOTE} ${SANDBOX_BUILD_BUDGET_NOTE} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description:
          'The sandbox was created; a build is scheduled where the deployment prebuilds images.',
      },
    }),
    {
      query: v2CreateSandboxContract.query,
      body: documentedSchema(
        v2CreateSandboxContract.body,
        'CreateSandboxRequest',
        'Create sandbox request',
        'Name, language, and dependency set of a new sandbox.',
        [
          {
            workspaceId: WORKSPACE_ID,
            name: SANDBOX_EXAMPLE.name,
            language: SANDBOX_EXAMPLE.language,
            dependencies: SANDBOX_EXAMPLE.dependencies,
            systemPackages: SANDBOX_EXAMPLE.systemPackages,
          },
        ]
      ),
      response: documentedSchema(
        v2CreateSandboxContract.response.schema,
        'CreateSandboxResponse',
        'Create sandbox response',
        'The created sandbox. `buildStatus` is `pending` while an image builds and `null` where nothing is built.',
        [{ data: { ...SANDBOX_EXAMPLE, buildStatus: 'pending', builtAt: null } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSandboxContract,
    resourceOperation('Sandboxes', {
      applicationOperation: sandboxOperations.read,
      operationId: 'getSandbox',
      summary: 'Get Sandbox',
      description:
        'Fetch one sandbox by identifier, scoped to its workspace, including its current build state and any build failure.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The sandbox.' },
    }),
    {
      params: documentedSchema(
        v2GetSandboxContract.params,
        'GetSandboxParams',
        'Get sandbox path parameters',
        'Sandbox selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetSandboxContract.query,
        'GetSandboxQuery',
        'Get sandbox query',
        'Workspace scope for the sandbox.'
      ),
      response: documentedSchema(
        v2GetSandboxContract.response.schema,
        'GetSandboxResponse',
        'Get sandbox response',
        'One sandbox.',
        [{ data: SANDBOX_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateSandboxContract,
    resourceOperation('Sandboxes', {
      applicationOperation: sandboxOperations.update,
      operationId: 'updateSandbox',
      summary: 'Update Sandbox',
      description: `Update supplied fields; omissions preserve values, lists replace whole lists, and names remain unique. Prebuild deployments rebuild changed specs, while resending an unchanged failed spec retries it; runtime-install or empty specs report \`buildStatus: null\`. ${SANDBOX_ADMIN_PLAN_NOTE} ${SANDBOX_BUILD_BUDGET_NOTE} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated sandbox.' },
    }),
    {
      query: v2UpdateSandboxContract.query,
      params: documentedSchema(
        v2UpdateSandboxContract.params,
        'UpdateSandboxParams',
        'Update sandbox path parameters',
        'Sandbox selected for update.'
      ),
      body: documentedSchema(
        v2UpdateSandboxContract.body,
        'UpdateSandboxRequest',
        'Update sandbox request',
        'Sandbox fields to change; at least one editable field is required.',
        [{ workspaceId: WORKSPACE_ID, dependencies: ['pandas==2.2.2', 'requests', 'pyarrow'] }]
      ),
      response: documentedSchema(
        v2UpdateSandboxContract.response.schema,
        'UpdateSandboxResponse',
        'Update sandbox response',
        'The updated sandbox. `buildStatus` is `pending` while an image rebuilds and `null` where nothing is built.',
        [
          {
            data: {
              ...SANDBOX_EXAMPLE,
              dependencies: ['pandas==2.2.2', 'requests', 'pyarrow'],
              buildStatus: 'pending',
              builtAt: null,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteSandboxContract,
    resourceOperation('Sandboxes', {
      applicationOperation: sandboxOperations.delete,
      operationId: 'deleteSandbox',
      summary: 'Delete Sandbox',
      description: `Delete a sandbox. Function blocks still selecting it fail closed until reconfigured. A prebuilt image is released when no sandbox shares it; runtime-install and empty specs have no image to release. ${SANDBOX_ADMIN_PLAN_NOTE} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The sandbox was deleted.' },
    }),
    {
      params: documentedSchema(
        v2DeleteSandboxContract.params,
        'DeleteSandboxParams',
        'Delete sandbox path parameters',
        'Sandbox selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteSandboxContract.query,
        'DeleteSandboxQuery',
        'Delete sandbox query',
        'Workspace scope for the sandbox.'
      ),
      response: documentedSchema(
        v2DeleteSandboxContract.response.schema,
        'DeleteSandboxResponse',
        'Delete sandbox response',
        'Acknowledgement that the sandbox was deleted.',
        [{ data: { id: SANDBOX_EXAMPLE.id, deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListCredentialsContract,
    resourceOperation('Credentials', {
      applicationOperation: credentialOperations.listConnections,
      operationId: 'listCredentials',
      summary: 'List Credentials',
      description:
        'List OAuth and service-account connections visible to the caller. Secret material is never returned.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Credentials visible to the caller.' },
    }),
    {
      query: documentedSchema(
        v2ListCredentialsContract.query,
        'ListCredentialsQuery',
        'List credentials query',
        'Workspace, type, provider, search, and sorting controls for credentials.'
      ),
      response: documentedSchema(
        v2ListCredentialsContract.response.schema,
        'ListCredentialsResponse',
        'List credentials response',
        'Credential metadata visible to the caller.',
        [{ data: [CREDENTIAL_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListCredentialProvidersContract,
    resourceOperation('Credentials', {
      applicationOperation: credentialOperations.listProviders,
      operationId: 'listCredentialProviders',
      summary: 'List Credential Providers',
      description: `List catalogued OAuth and service-account connection methods and whether each is available to the caller in this workspace and deployment. Optionally search provider names with a case-insensitive substring match. OAuth authorization options contain the exact provider IDs accepted by the browser connection endpoint; service-account methods list the exact create-body fields and mark secret fields write-only. ${FULL_SET_LIST}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'Credential provider catalog with caller-specific availability.' },
    }),
    {
      query: documentedSchema(
        v2ListCredentialProvidersContract.query,
        'ListCredentialProvidersQuery',
        'List credential providers query',
        'Workspace and optional provider-name search used to filter caller-specific availability.'
      ),
      response: documentedSchema(
        v2ListCredentialProvidersContract.response.schema,
        'ListCredentialProvidersResponse',
        'List credential providers response',
        'OAuth and service-account connection methods.',
        [
          {
            data: [CREDENTIAL_PROVIDER_EXAMPLE, SERVICE_ACCOUNT_PROVIDER_EXAMPLE],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateServiceAccountCredentialContract,
    resourceOperation('Credentials', {
      applicationOperation: credentialOperations.createServiceAccount,
      operationId: 'createServiceAccountCredential',
      summary: 'Create Service-Account Credential',
      description: `Verify and store one service-account credential. Use provider discovery to select a service-account provider, then encode its required fields as the JSON object string in credentials. The credentials string is write-only and is never returned. A retried source match returns the existing credential with 200; a newly created credential returns 201. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        byStatus: {
          200: { description: 'An existing credential matched the verified source.' },
          201: { description: 'The service-account credential was created.' },
        },
      },
    }),
    {
      query: v2CreateServiceAccountCredentialContract.query,
      body: documentedSchema(
        v2CreateServiceAccountCredentialContract.body,
        'CreateServiceAccountCredentialRequest',
        'Create service-account credential request',
        'Provider identifier, optional display metadata, and a write-only JSON object string containing the fields declared by provider discovery.',
        [
          {
            workspaceId: WORKSPACE_ID,
            type: 'service_account',
            providerId: 'zoom-service-account',
            displayName: 'Zoom automation',
            credentials:
              '{"clientId":"YOUR_CLIENT_ID","clientSecret":"YOUR_CLIENT_SECRET","orgId":"YOUR_ACCOUNT_ID"}',
          },
        ]
      ),
      response: documentedSchema(
        v2CreateServiceAccountCredentialContract.response.schema,
        'CreateServiceAccountCredentialResponse',
        'Create service-account credential response',
        'Verified credential metadata without secret material.',
        [{ data: CREDENTIAL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateCredentialConnectionContract,
    resourceOperation('Credentials', {
      applicationOperation: credentialOperations.createConnection,
      operationId: 'createCredentialConnection',
      summary: 'Create Credential Connection',
      description: `Create a short-lived browser URL for connecting an OAuth provider or reconnecting an existing OAuth credential. Open the URL, sign in as the authenticated user, complete provider authorization, then refresh the credentials list. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'A short-lived browser authorization URL.' },
    }),
    {
      query: v2CreateCredentialConnectionContract.query,
      body: documentedSchema(
        v2CreateCredentialConnectionContract.body,
        'CreateCredentialConnectionBody',
        'Create credential connection body',
        'For a new connection, provide providerId and displayName. For a reconnect, provide only credentialId; the existing display name is preserved.'
      ),
      response: documentedSchema(
        v2CreateCredentialConnectionContract.response.schema,
        'CreateCredentialConnectionResponse',
        'Create credential connection response',
        'Short-lived Sim browser entrypoint and its expiry.',
        [{ data: CREDENTIAL_CONNECTION_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteCredentialContract,
    resourceOperation('Credentials', {
      applicationOperation: credentialOperations.delete,
      operationId: 'deleteCredential',
      summary: 'Disconnect Credential',
      description: `Disconnect an OAuth or service-account credential and clear its stored workflow, deployment, paused-run, knowledge-connector, and webhook references. Credential admin access is required. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The credential was disconnected.' },
    }),
    {
      params: documentedSchema(
        v2DeleteCredentialContract.params,
        'DeleteCredentialParams',
        'Disconnect credential path parameters',
        'Credential selected for disconnection.'
      ),
      query: documentedSchema(
        v2DeleteCredentialContract.query,
        'DeleteCredentialQuery',
        'Disconnect credential query',
        'Workspace expected to own the credential.'
      ),
      response: documentedSchema(
        v2DeleteCredentialContract.response.schema,
        'DeleteCredentialResponse',
        'Disconnect credential response',
        'Acknowledgement that the credential was disconnected.',
        [{ data: { id: CREDENTIAL_EXAMPLE.id, deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListSecretsContract,
    resourceOperation('Secrets', {
      applicationOperation: secretOperations.list,
      operationId: 'listSecrets',
      summary: 'List Secrets',
      description: `List workspace and caller-owned personal secret metadata with opaque cursor pagination. Rows for workspace secrets marked visible (unredacted) include the stored value; every other row is metadata-only and no other response ever carries a value. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'Secret metadata visible to the caller.' },
    }),
    {
      query: documentedSchema(
        v2ListSecretsContract.query,
        'ListSecretsQuery',
        'List secrets query',
        'Workspace, ownership scope, search, and sorting controls for secrets.'
      ),
      response: documentedSchema(
        v2ListSecretsContract.response.schema,
        'ListSecretsResponse',
        'List secrets response',
        'Secret metadata visible to the caller; visible (unredacted) workspace secrets carry their value.',
        [{ data: [SECRET_EXAMPLE, VISIBLE_SECRET_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2SetSecretContract,
    resourceOperation('Secrets', {
      applicationOperation: secretOperations.set,
      operationId: 'setSecret',
      summary: 'Set Secret',
      description: `Create or replace a workspace or personal secret. Values are encrypted at rest, write-only, and never returned. For an existing workspace secret, omit \`value\` to update only \`description\` or \`unredacted\`; the value remains untouched. This metadata-only form cannot create a secret and returns \`404\` when absent. Personal secrets always require \`value\`. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: {
        byStatus: {
          200: {
            description:
              'The existing secret value was replaced, or its metadata was updated in place.',
          },
          201: { description: 'The secret was created.' },
        },
      },
    }),
    {
      query: v2SetSecretContract.query,
      params: documentedSchema(
        v2SetSecretContract.params,
        'SetSecretParams',
        'Set secret path parameters',
        'Secret name selected for creation or replacement.'
      ),
      body: documentedSchema(
        v2SetSecretContract.body,
        'SetSecretRequest',
        'Set secret request',
        'Ownership scope and write-only value for the secret. A workspace secret may instead send description or unredacted alone, without a value.',
        [
          {
            workspaceId: WORKSPACE_ID,
            scope: SECRET_EXAMPLE.scope,
            value: 'YOUR_SECRET_VALUE',
          },
          {
            workspaceId: WORKSPACE_ID,
            scope: 'workspace',
            unredacted: false,
          },
        ]
      ),
      response: documentedSchema(
        v2SetSecretContract.response.schema,
        'SetSecretResponse',
        'Set secret response',
        'Metadata for the created or replaced secret without its value.',
        [{ data: SECRET_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteSecretContract,
    resourceOperation('Secrets', {
      applicationOperation: secretOperations.delete,
      operationId: 'deleteSecret',
      summary: 'Delete Secret',
      description: `Delete a workspace or caller-owned personal secret without reading or returning its stored value. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The secret was deleted.' },
    }),
    {
      params: documentedSchema(
        v2DeleteSecretContract.params,
        'DeleteSecretParams',
        'Delete secret path parameters',
        'Secret name selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteSecretContract.query,
        'DeleteSecretQuery',
        'Delete secret query',
        'Workspace and ownership scope for the secret.'
      ),
      response: documentedSchema(
        v2DeleteSecretContract.response.schema,
        'DeleteSecretResponse',
        'Delete secret response',
        'Acknowledgement that the secret was deleted.',
        [
          {
            data: {
              name: SECRET_EXAMPLE.name,
              scope: SECRET_EXAMPLE.scope,
              deleted: true,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetMetaContract,
    resourceOperation('Meta', {
      applicationOperation: v2MetaOperations.read,
      operationId: 'getApiMeta',
      summary: 'Get API Capabilities',
      description:
        'Report whether v2 is available, what kind of API credential is calling, and when it expires. Requires a valid API key or OAuth access token.',
      errors: META_ERRORS,
      success: { description: 'Availability and lifecycle facts about the calling credential.' },
    }),
    {
      query: v2GetMetaContract.query,
      response: documentedSchema(
        v2GetMetaContract.response.schema,
        'GetApiMetaResponse',
        'API capabilities response',
        'API availability, credential type, and expiry for the caller.',
        [{ data: { v2Enabled: true, keyType: 'personal', expiresAt: null } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkflowMcpServersContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.listWorkflowDeployments,
      operationId: 'listWorkflowMcpServers',
      summary: 'List Workflow MCP Servers',
      description: `List servers that publish deployed workflows to outside MCP clients; \`GET /api/v2/mcp-servers\` instead lists external servers Sim calls. Entries include client endpoints and tool names. A page shares a 2,000-name budget, so trailing servers may show partial inventories; read a server's tools endpoint for its full set. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'A page of published MCP servers.' },
    }),
    {
      query: v2ListWorkflowMcpServersContract.query,
      response: documentedSchema(
        v2ListWorkflowMcpServersContract.response.schema,
        'ListWorkflowMcpServersResponse',
        'List workflow MCP servers response',
        'A cursor-paginated page of published MCP servers.',
        [{ data: [WORKFLOW_MCP_SERVER_LIST_EXAMPLE], nextCursor: null, toolNamesTruncated: false }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateWorkflowMcpServerContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.createWorkflowDeploymentServer,
      operationId: 'createWorkflowMcpServer',
      summary: 'Create Workflow MCP Server',
      description: `Publish a new MCP server for a workspace, optionally seeding it with workflows to expose as tools. Every workflow named in \`workflowIds\` must already be deployed. Setting \`isPublic\` lets any MCP client holding the server URL execute the workflows it publishes without a Sim API key. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The published MCP server.' },
    }),
    {
      query: v2CreateWorkflowMcpServerContract.query,
      body: v2CreateWorkflowMcpServerContract.body,
      response: documentedSchema(
        v2CreateWorkflowMcpServerContract.response.schema,
        'CreateWorkflowMcpServerResponse',
        'Create workflow MCP server response',
        'The published MCP server.',
        [{ data: WORKFLOW_MCP_SERVER_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkflowMcpServerContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.readWorkflowDeploymentServer,
      operationId: 'getWorkflowMcpServer',
      summary: 'Get Workflow MCP Server',
      description: `Read one published MCP server. The list is the only other place this state is published, so a caller holding a server id would otherwise have to page the collection and filter client-side. The tools it publishes are on its \`tools\` sub-resource. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The MCP server.' },
    }),
    {
      query: v2GetWorkflowMcpServerContract.query,
      params: v2GetWorkflowMcpServerContract.params,
      response: documentedSchema(
        v2GetWorkflowMcpServerContract.response.schema,
        'GetWorkflowMcpServerResponse',
        'Get workflow MCP server response',
        'A single published MCP server.',
        [{ data: WORKFLOW_MCP_SERVER_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkflowMcpToolsContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.listWorkflowDeploymentTools,
      operationId: 'listWorkflowMcpTools',
      summary: 'List Workflow MCP Tools',
      description: `Every tool a server publishes, tool-name ordered. The server list reports tool *names* only, so this is where a caller reads the \`workflowId\` that \`DELETE /api/v2/workflow-mcp-servers/{serverId}/tools/{workflowId}\` addresses. Returned in one page rather than paged — so \`nextCursor\` is always null — and capped at 2,000 tools, which is far above any real server's inventory. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The tools this server publishes.' },
    }),
    {
      query: v2ListWorkflowMcpToolsContract.query,
      params: v2ListWorkflowMcpToolsContract.params,
      response: documentedSchema(
        v2ListWorkflowMcpToolsContract.response.schema,
        'ListWorkflowMcpToolsResponse',
        'List workflow MCP tools response',
        'The tools a published MCP server exposes.',
        [
          {
            data: [omitUpdated(WORKFLOW_MCP_TOOL_EXAMPLE)],
            nextCursor: null,
            truncated: false,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkflowMcpServerContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.updateWorkflowDeploymentServer,
      operationId: 'updateWorkflowMcpServer',
      summary: 'Update Workflow MCP Server',
      description: `Rename, re-describe, or change the public visibility of a published MCP server. Merge-patch shaped: an omitted key is unchanged and \`description: null\` clears the description. Publishing and unpublishing the workflows it serves are separate operations on its \`tools\` sub-resource. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated MCP server.' },
    }),
    {
      query: v2UpdateWorkflowMcpServerContract.query,
      params: v2UpdateWorkflowMcpServerContract.params,
      body: v2UpdateWorkflowMcpServerContract.body,
      response: documentedSchema(
        v2UpdateWorkflowMcpServerContract.response.schema,
        'UpdateWorkflowMcpServerResponse',
        'Update workflow MCP server response',
        'The updated MCP server.',
        [{ data: { ...WORKFLOW_MCP_SERVER_EXAMPLE, isPublic: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteWorkflowMcpServerContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.deleteWorkflowDeploymentServer,
      operationId: 'deleteWorkflowMcpServer',
      summary: 'Delete Workflow MCP Server',
      description: `Unpublish an MCP server. Every tool it served stops answering and connected clients lose the endpoint. The workflows themselves are untouched — their own deployments stay live and executable through the workflow API. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The MCP server was unpublished.' },
    }),
    {
      query: v2DeleteWorkflowMcpServerContract.query,
      params: v2DeleteWorkflowMcpServerContract.params,
      response: documentedSchema(
        v2DeleteWorkflowMcpServerContract.response.schema,
        'DeleteWorkflowMcpServerResponse',
        'Delete workflow MCP server response',
        'Acknowledgement that the MCP server was unpublished.',
        [{ data: { id: WORKFLOW_MCP_SERVER_EXAMPLE.id, deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeployWorkflowMcpToolContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.deployWorkflowTool,
      operationId: 'deployWorkflowMcpTool',
      summary: 'Publish Workflow As MCP Tool',
      description: `Publish a deployed workflow as a tool on an MCP server. The tool's input schema is generated from the deployed workflow's input format, so the workflow must already be deployed. Idempotent per workflow: a server carries at most one tool per workflow, so a repeat call replaces the existing tool and answers \`200\` with \`updated: true\` rather than conflicting. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The published tool.' },
    }),
    {
      query: v2DeployWorkflowMcpToolContract.query,
      params: v2DeployWorkflowMcpToolContract.params,
      body: v2DeployWorkflowMcpToolContract.body,
      response: documentedSchema(
        v2DeployWorkflowMcpToolContract.response.schema,
        'DeployWorkflowMcpToolResponse',
        'Publish workflow as MCP tool response',
        'The published tool.',
        [{ data: WORKFLOW_MCP_TOOL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UndeployWorkflowMcpToolContract,
    resourceOperation('MCP Servers', {
      applicationOperation: mcpServerOperations.undeployWorkflowTool,
      operationId: 'undeployWorkflowMcpTool',
      summary: 'Unpublish Workflow MCP Tool',
      description: `Remove a workflow from an MCP server. Addressed by workflow rather than by tool identifier, because a server carries at most one live tool per workflow. The workflow's own deployment is untouched. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The tool was removed.' },
    }),
    {
      query: v2UndeployWorkflowMcpToolContract.query,
      params: v2UndeployWorkflowMcpToolContract.params,
      response: documentedSchema(
        v2UndeployWorkflowMcpToolContract.response.schema,
        'UndeployWorkflowMcpToolResponse',
        'Unpublish workflow MCP tool response',
        'Acknowledgement that the tool was removed.',
        [
          {
            data: {
              id: WORKFLOW_MCP_TOOL_EXAMPLE.id,
              serverId: WORKFLOW_MCP_TOOL_EXAMPLE.serverId,
              workflowId: WORKFLOW_MCP_TOOL_EXAMPLE.workflowId,
              deleted: true,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateCredentialContract,
    resourceOperation('Credentials', {
      applicationOperation: credentialOperations.update,
      operationId: 'updateCredential',
      summary: 'Update Credential',
      description: `Rename a service-account credential or rotate its write-only secret fields. Omissions preserve values; \`description: null\` clears the description. Secret fields sent for another credential type return \`400\`. The provider verifies replacements before storage: rejection leaves the old secret intact and returns \`400\` with \`providerErrorCode\`; provider outages return \`503\`. The preserved credential ID keeps all references working. Credential admin access is required. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated credential without secret material.' },
    }),
    {
      params: documentedSchema(
        v2UpdateCredentialContract.params,
        'UpdateCredentialParams',
        'Update credential path parameters',
        'Credential selected for update.'
      ),
      query: documentedSchema(
        v2UpdateCredentialContract.query,
        'UpdateCredentialQuery',
        'Update credential query',
        'Workspace expected to own the credential.'
      ),
      body: documentedSchema(
        v2UpdateCredentialContract.body,
        'UpdateCredentialRequest',
        'Update credential request',
        'Replacement display metadata and the write-only fields declared by provider discovery.',
        [{ clientSecret: 'YOUR_ROTATED_CLIENT_SECRET' }]
      ),
      response: documentedSchema(
        v2UpdateCredentialContract.response.schema,
        'UpdateCredentialResponse',
        'Update credential response',
        'Updated credential metadata without secret material.',
        [{ data: CREDENTIAL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListBlocksContract,
    resourceOperation('Catalog', {
      applicationOperation: catalogOperations.listBlocks,
      operationId: 'listBlocks',
      summary: 'List Blocks',
      description:
        'List the blocks available in a workspace, built-in and workspace-deployed alike, discriminated by `source`. Availability is caller-specific: the workspace’s integration allowlist, the organization’s revealed preview blocks, and the deployment’s allowlist all narrow the result. Use `capability=trigger` for the blocks that can start a workflow. Summaries name their tools and operations by id — resolve one with Get Block or Get Tool.',
      errors: RESOURCE_ERRORS,
      success: { description: 'A page of blocks available in the workspace.' },
    }),
    {
      query: documentedSchema(
        v2ListBlocksContract.query,
        'ListBlocksQuery',
        'List blocks query',
        'Workspace scope, catalog filters, sort, and pagination.'
      ),
      response: documentedSchema(
        v2ListBlocksContract.response.schema,
        'ListBlocksResponse',
        'List blocks response',
        'Blocks available in the workspace.',
        [{ data: [BLOCK_SUMMARY_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetBlockContract,
    resourceOperation('Catalog', {
      applicationOperation: catalogOperations.readBlock,
      operationId: 'getBlock',
      summary: 'Get Block',
      description:
        'Read one block’s full configuration shape: its fields and their conditions, its operations with the tool each runs, every tool’s parameters and outputs, and its triggers. An unversioned base type resolves to the newest version this caller can see — `confluence` answers with `confluence_v2` — and the returned `id` is always the resolved one, matching Get Tool. A block this caller cannot see answers 404, identically to one that does not exist.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The block.' },
    }),
    {
      params: documentedSchema(
        v2GetBlockContract.params,
        'GetBlockParams',
        'Get block path parameters',
        'Block selected for retrieval. An unversioned base type resolves to the newest version.'
      ),
      query: documentedSchema(
        v2GetBlockContract.query,
        'GetBlockQuery',
        'Get block query',
        'Workspace whose availability rules are applied.'
      ),
      response: documentedSchema(
        v2GetBlockContract.response.schema,
        'GetBlockResponse',
        'Get block response',
        'One block with its fields, operations, tools, and triggers.',
        [{ data: BLOCK_DETAIL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListToolsContract,
    resourceOperation('Catalog', {
      applicationOperation: catalogOperations.listTools,
      operationId: 'listTools',
      summary: 'List Tools',
      description:
        'List the built-in tools available in a workspace. Built-in tools only: a workspace’s MCP tools are discovered per server on List MCP Server Tools, and its code-backed custom tools are on List Custom Tools. A tool is available when a block the caller can see exposes it, so the same allowlist and visibility rules as List Blocks apply.',
      errors: RESOURCE_ERRORS,
      success: { description: 'A page of built-in tools available in the workspace.' },
    }),
    {
      query: documentedSchema(
        v2ListToolsContract.query,
        'ListToolsQuery',
        'List tools query',
        'Workspace scope, tool filters, sort, and pagination.'
      ),
      response: documentedSchema(
        v2ListToolsContract.response.schema,
        'ListToolsResponse',
        'List tools response',
        'Built-in tools available in the workspace.',
        [{ data: [TOOL_SUMMARY_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetToolContract,
    resourceOperation('Catalog', {
      applicationOperation: catalogOperations.readTool,
      operationId: 'getTool',
      summary: 'Get Tool',
      description:
        'Read one built-in tool’s declared parameters and outputs. A name that is itself a registered id answers as that exact tool; a name that is not resolves to the newest version of its family. The returned `id` is always the one that answered, so a caller can see which version it got. A tool the workspace’s visible blocks do not expose answers `404`, identically to one that does not exist.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The tool.' },
    }),
    {
      params: documentedSchema(
        v2GetToolContract.params,
        'GetToolParams',
        'Get tool path parameters',
        'Tool selected for retrieval. An unversioned name resolves to the newest version.'
      ),
      query: documentedSchema(
        v2GetToolContract.query,
        'GetToolQuery',
        'Get tool query',
        'Workspace whose availability rules are applied.'
      ),
      response: documentedSchema(
        v2GetToolContract.response.schema,
        'GetToolResponse',
        'Get tool response',
        'One built-in tool with its parameters and outputs.',
        [{ data: TOOL_DETAIL_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ExecuteToolContract,
    resourceOperation('Catalog', {
      applicationOperation: toolExecutionOperations.execute,
      operationId: 'executeTool',
      summary: 'Run Tool',
      description: `Run a built-in tool using published parameter IDs. Sim resolves \`credentialId\`, hosted keys, and whole-value \`{{VAR_NAME}}\` references for \`user-only\` parameters; other values pass through verbatim. Third-party refusal returns \`200\` with \`status: "failed"\`; the error envelope covers API failures. Hidden or missing tools return \`404\`; disallowed integrations return \`403\` with \`error.details.code: INTEGRATION_NOT_ALLOWED\`. Hosted-key use is billed to the workspace. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The outcome of the tool call.' },
    }),
    {
      params: documentedSchema(
        v2ExecuteToolContract.params,
        'ExecuteToolParams',
        'Run tool path parameters',
        'Tool to run. An unversioned name resolves to the newest version visible in the workspace.'
      ),
      query: v2ExecuteToolContract.query,
      body: documentedSchema(
        v2ExecuteToolContract.body,
        'ExecuteToolRequest',
        'Run tool request',
        'Workspace, arguments, and the credential to authenticate with.',
        [
          {
            workspaceId: WORKSPACE_ID,
            input: { channel: 'C0123456789', text: 'Deploy finished.' },
            credentialId: 'cred_01J8ZK3QW4M6X2R9T7B5C0V2',
          },
        ]
      ),
      response: documentedSchema(
        v2ExecuteToolContract.response.schema,
        'ExecuteToolResponse',
        'Run tool response',
        'What the tool produced, or why it did not succeed.',
        [{ data: TOOL_EXECUTION_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListConnectorTypesContract,
    resourceOperation('Catalog', {
      applicationOperation: catalogOperations.listConnectorTypes,
      operationId: 'listConnectorTypes',
      summary: 'List Connector Types',
      description: `List connector types and accepted source configuration. A field with \`multi: true\` stores \`string[]\`. \`canonicalParamId\` links picker and manual fields that write the same key; send exactly one, keyed by \`canonicalParamId\` rather than its own \`id\`. ${FULL_SET_LIST}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The connector-type catalog.' },
    }),
    {
      query: documentedSchema(
        v2ListConnectorTypesContract.query,
        'ListConnectorTypesQuery',
        'List connector types query',
        'Workspace scope and optional connector-name search.'
      ),
      response: documentedSchema(
        v2ListConnectorTypesContract.response.schema,
        'ListConnectorTypesResponse',
        'List connector types response',
        'Knowledge-base connector types and their configuration fields.',
        [{ data: [CONNECTOR_TYPE_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
] as const

const routes = declaredRoutes.map(withRequestBodyErrors)

export const resourcesOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-resources.json',
  info: {
    title: 'Sim API v2 — Workspace Resources',
    description:
      'Version 2 of the Sim REST API for workspace metadata, members, MCP servers, skills, custom tools, sandboxes, credentials, write-only secrets, and the block, tool, and connector-type catalogs.',
    version: '2.0.0',
    contact: {
      name: 'Sim Support',
      email: 'help@sim.ai',
      url: 'https://www.sim.ai',
    },
    license: {
      name: 'Apache 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
    },
  },
  servers: [{ url: 'https://www.sim.ai', description: 'Production' }],
  tags: [
    {
      name: 'Meta',
      description: 'Discover what the calling API credential can reach.',
    },
    {
      name: 'Workspaces',
      description: 'Read workspace metadata and its effective member roster.',
    },
    {
      name: 'MCP Servers',
      description: 'Register and manage Model Context Protocol servers.',
    },
    {
      name: 'Skills',
      description: 'Create and manage reusable instruction documents for agents.',
    },
    {
      name: 'Custom Tools',
      description: 'Create and manage code-backed tools that agents can call.',
    },
    {
      name: 'Sandboxes',
      description:
        'Create and manage the reusable dependency sets that Function blocks execute against.',
    },
    {
      name: 'Credentials',
      description:
        'Discover providers, create service-account credentials, connect or reconnect OAuth accounts, disconnect credentials, and list connections without secret material.',
    },
    {
      name: 'Secrets',
      description: 'Set and manage write-only workspace and personal secret values.',
    },
    {
      name: 'Catalog',
      description: 'Discover the blocks, tools, and connector types this workspace can build with.',
    },
  ],
  security: V2_AUTH_SECURITY,
  securitySchemes: V2_AUTH_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  /**
   * Most `409`s in this document are name collisions, but MCP tool discovery
   * raises one for a stored OAuth grant that must be reauthorized, so the shared
   * example stays generic and each operation's description names its own cause.
   */
  errorResponses: withErrorExamples({
    Conflict: { message: 'The request conflicts with the current state of the resource' },
  }),
  routes,
})
