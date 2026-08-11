import { v2ListCredentialsContract } from '@/lib/api/contracts/v2/credentials'
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
  v2UpdateMcpServerContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import {
  documentedSchema,
  ERROR_RESPONSES,
  type ErrorResponseId,
  RATE_LIMIT_HEADERS,
  V2_API_KEY_SECURITY,
  V2_API_KEY_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  WORKSPACE_API_KEY_DENIED,
  WORKSPACE_ERRORS,
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
  v2ListSkillsContract,
  v2UpdateSkillContract,
} from '@/lib/api/contracts/v2/skills'
import {
  v2GetWorkspaceContract,
  v2ListWorkspaceMembersContract,
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

const SECRET_EXAMPLE = {
  name: 'STRIPE_API_KEY',
  scope: 'workspace',
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

const routes = [
  defineOpenApiRoute(
    v2GetWorkspaceContract,
    resourceOperation('Workspaces', {
      operationId: 'getWorkspace',
      summary: 'Get Workspace',
      description:
        'Return public metadata for one accessible workspace. Governance identities, billing identities, and internal membership identifiers are intentionally omitted.',
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
      success: { description: 'Public workspace metadata.' },
    }),
    {
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
        'List MCP servers registered in a workspace. Request-header values and OAuth client secrets are never returned. The bounded workspace set uses the standard cursor envelope with `nextCursor` always null; there is no second page to fetch.',
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
      success: { description: 'MCP servers registered in the workspace.' },
    }),
    {
      query: documentedSchema(
        v2ListMcpServersContract.query,
        'ListMcpServersQuery',
        'List MCP servers query',
        'Workspace, search, and sorting controls for MCP servers.'
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
        'Register an MCP server in a workspace. The endpoint URL determines server identity, must be absolute HTTP or HTTPS, and cannot contain environment-variable references. Header values and OAuth client secrets are write-only. `transport`, `timeout`, `retries`, and `enabled` are applied server-side when omitted; the effective values are in the response.',
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict'],
      success: { description: 'The MCP server was registered.' },
    }),
    {
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
        [{ data: MCP_SERVER_EXAMPLE }]
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
        'Update the supplied MCP server fields. The URL is immutable because it determines server identity; delete and recreate the server to change endpoints. Two fields do not follow the omitted-fields-are-retained rule. `headers` is replaced wholesale rather than merged: sending it drops every stored header it does not repeat, and the only way to keep a header is to resend it. Changing `oauthClientId`, or sending `oauthClientSecret` as null or a new value, revokes the stored OAuth grant and forces reauthorization; switching away from OAuth authentication revokes it too.',
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
      success: { description: 'The updated MCP server.' },
    }),
    {
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
    v2ListSkillsContract,
    resourceOperation('Skills', {
      operationId: 'listSkills',
      summary: 'List Skills',
      description:
        'List workspace and built-in skills. Built-ins are marked read-only. The list omits skill bodies and uses the standard cursor envelope with `nextCursor` always null, so there is no second page to fetch; fetch one skill to read its content.',
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
      description:
        'Create one skill in a workspace. Its kebab-case name must be unique and cannot be reserved by a built-in skill. Note that a workspace API key may create a skill but may not later update or delete it.',
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict'],
      success: { description: 'The skill was created.' },
    }),
    {
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict'],
      success: { description: 'The updated skill.' },
    }),
    {
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
    v2ListCustomToolsContract,
    resourceOperation('Custom Tools', {
      operationId: 'listCustomTools',
      summary: 'List Custom Tools',
      description:
        'List code-backed custom tools defined in a workspace. Legacy personal tools are excluded. The bounded workspace set uses the standard cursor envelope with `nextCursor` always null; there is no second page to fetch.',
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict'],
      success: { description: 'The custom tool was created.' },
    }),
    {
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict'],
      success: { description: 'The updated custom tool.' },
    }),
    {
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
        'List OAuth and service-account connections visible to the caller. Secret material is never returned. Credential mutations and single-resource reads are intentionally not exposed. The bounded set uses the standard cursor envelope with `nextCursor` always null; there is no second page to fetch.',
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
    v2ListSecretsContract,
    resourceOperation('Secrets', {
      operationId: 'listSecrets',
      summary: 'List Secrets',
      description: `List workspace and caller-owned personal secret metadata. Only names, scope, role, and timestamps are returned; secret values are never read or returned. The bounded set uses the standard cursor envelope with \`nextCursor\` always null; there is no second page to fetch. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
      success: {
        byStatus: {
          200: { description: 'The existing secret value was replaced.' },
          201: { description: 'The secret was created.' },
        },
      },
    }),
    {
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
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
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
      description: 'List OAuth and service-account connections without secret material.',
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
  errorResponses: ERROR_RESPONSES,
  routes,
})
