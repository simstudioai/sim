import {
  v2CreateCredentialConnectionContract,
  v2CreateServiceAccountCredentialContract,
  v2DeleteCredentialContract,
  v2ListCredentialProvidersContract,
  v2ListCredentialsContract,
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
import {
  documentedSchema,
  type ErrorResponseId,
  FULL_SET_LIST,
  HEAD_MIRRORS_GET,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  V2_API_KEY_SECURITY,
  V2_API_KEY_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  WORKSPACE_API_KEY_DENIED,
  withErrorExamples,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
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
  v2GetWorkspaceContract,
  v2ListWorkspaceMembersContract,
  v2ListWorkspacesContract,
} from '@/lib/api/contracts/v2/workspaces'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
} from '@/lib/api/openapi/types'

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
  role: 'admin',
  createdAt: '2026-06-01T09:14:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
} as const

type ResourceTag =
  | 'Workspaces'
  | 'MCP Servers'
  | 'Skills'
  | 'Custom Tools'
  | 'Credentials'
  | 'Secrets'

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
      operationId: 'listWorkspaces',
      summary: 'List Workspaces',
      description:
        'List active workspaces available to the API key with opaque cursor pagination. A personal API key sees every accessible workspace that permits personal API keys; a workspace API key sees only its bound workspace.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Public metadata for workspaces available to the API key.' },
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
        'Public metadata for workspaces available to the API key.',
        [{ data: [WORKSPACE_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceContract,
    resourceOperation('Workspaces', {
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
      operationId: 'listMcpServers',
      summary: 'List MCP Servers',
      description:
        'List MCP servers registered in a workspace. Request-header values and OAuth client secrets are never returned. The discovery fields stay at their registration defaults until `GET /api/v2/mcp-servers/{id}/tools` runs a discovery.',
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
      operationId: 'createMcpServer',
      summary: 'Create MCP Server',
      description:
        'Register an MCP server in a workspace. The endpoint URL is the server identity, so a URL already registered here is a `409` — reconfigure that server with `PATCH /api/v2/mcp-servers/{id}` instead. Registration never connects to the endpoint: the server comes back `disconnected` and stays unavailable until `GET /api/v2/mcp-servers/{id}/tools` succeeds.',
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
      operationId: 'listMcpServerTools',
      summary: 'List MCP Server Tools',
      description: `Connect to a registered MCP server and return the tools it exposes. This read has side effects: it opens a live connection to the third-party server and writes \`connectionStatus\`, \`toolCount\`, \`lastError\`, and \`lastToolsRefresh\`. ${HEAD_MIRRORS_GET} Discovery is bounded at 1,000 tools and 5 MB of tool payload per server. ${FULL_SET_LIST} An unreachable, slow, or cooling-down server is a \`503\`; a stored OAuth grant that no longer works is a \`409\` with \`error.details.code\` \`MCP_SERVER_REAUTHORIZATION_REQUIRED\`, which only a human reauthorizing in Sim can clear. ${WORKSPACE_API_KEY_DENIED}`,
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
    v2ListCredentialsContract,
    resourceOperation('Credentials', {
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
      operationId: 'createCredentialConnection',
      summary: 'Create Credential Connection',
      description: `Create a short-lived browser URL for connecting an OAuth provider or reconnecting an existing OAuth credential. Open the URL in a browser, sign in as the personal API-key owner, complete provider authorization, then refresh the credentials list. ${WORKSPACE_API_KEY_DENIED}`,
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
      operationId: 'listSecrets',
      summary: 'List Secrets',
      description: `List workspace and caller-owned personal secret metadata with opaque cursor pagination. Only names, scope, role, and timestamps are returned; secret values are never returned. ${WORKSPACE_API_KEY_DENIED}`,
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
        'Secret metadata visible to the caller without stored values.',
        [{ data: [SECRET_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2SetSecretContract,
    resourceOperation('Secrets', {
      operationId: 'setSecret',
      summary: 'Set Secret',
      description: `Create or replace a workspace or caller-owned personal secret. The value is encrypted at rest, is write-only, and is never included in the response. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: {
        byStatus: {
          200: { description: 'The existing secret value was replaced.' },
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
        'Ownership scope and write-only value for the secret.',
        [
          {
            workspaceId: WORKSPACE_ID,
            scope: SECRET_EXAMPLE.scope,
            value: 'YOUR_SECRET_VALUE',
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
] as const

const routes = declaredRoutes.map(withRequestBodyErrors)

export const resourcesOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-resources.json',
  info: {
    title: 'Sim API v2 — Workspace Resources',
    description:
      'Version 2 of the Sim REST API for workspace metadata, members, MCP servers, skills, custom tools, credentials, and write-only secrets.',
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
      name: 'Credentials',
      description:
        'Discover providers, create service-account credentials, connect or reconnect OAuth accounts, disconnect credentials, and list connections without secret material.',
    },
    {
      name: 'Secrets',
      description: 'Set and manage write-only workspace and personal secret values.',
    },
  ],
  security: V2_API_KEY_SECURITY,
  securitySchemes: V2_API_KEY_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: withErrorExamples({
    Conflict: { message: 'API key name already exists' },
  }),
  routes,
})
