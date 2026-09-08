import { z } from 'zod'
import {
  noInputSchema,
  nonEmptyIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 workflow-MCP server contracts.
 *
 * A *workflow* MCP server is one Sim publishes: a workspace groups deployed
 * workflows under it, and an outside MCP client calls them as tools. That is the
 * opposite direction from `/api/v2/mcp-servers`, which registers external
 * servers Sim consumes. The two resources share nothing but a protocol name and
 * live on separate paths for exactly that reason — overloading one path would
 * make `DELETE /mcp-servers/{mcpServerId}` mean "stop calling out" or "stop serving"
 * depending on which table the id happened to be in.
 *
 * Every operation here denies workspace API keys: publishing a workflow for
 * execution by an outside agent is an authority grant that needs an accountable
 * human.
 */

export const V2_WORKFLOW_MCP_SERVER_NAME_MAX = 255
export const V2_WORKFLOW_MCP_SERVER_DESCRIPTION_MAX = 2000
export const V2_WORKFLOW_MCP_TOOL_NAME_MAX = 128
export const V2_WORKFLOW_MCP_TOOL_DESCRIPTION_MAX = 2000

/**
 * Mirrors `MAX_MCP_PARAMETER_DESCRIPTION_OVERRIDES` in
 * `lib/mcp/application/workflow-deployments.ts`, which rejects a longer array as
 * a domain validation error. Bounding it at the contract too turns that into a
 * `400` naming the field rather than a domain refusal the caller has to read.
 */
export const V2_WORKFLOW_MCP_PARAMETER_DESCRIPTIONS_MAX = 100

export const v2WorkflowMcpServerParamsSchema = z
  .object({
    serverId: nonEmptyIdSchema.describe('Unique workflow-MCP server identifier.'),
  })
  .meta({
    id: 'WorkflowMcpServerParams',
    title: 'Workflow MCP server path parameters',
    description: 'Workflow-MCP server selected by the request path.',
  })
export type V2WorkflowMcpServerParams = z.output<typeof v2WorkflowMcpServerParamsSchema>

export const v2WorkflowMcpToolParamsSchema = v2WorkflowMcpServerParamsSchema
  .extend({
    workflowId: workflowIdSchema.describe('Workflow published as a tool on this server.'),
  })
  .meta({
    id: 'WorkflowMcpToolParams',
    title: 'Workflow MCP tool path parameters',
    description:
      'Server and workflow selected by the request path. A workflow appears at most once per server, so the pair identifies the tool.',
  })
export type V2WorkflowMcpToolParams = z.output<typeof v2WorkflowMcpToolParamsSchema>

export const v2WorkflowMcpServerSchema = z
  .object({
    id: z.string().describe('Unique workflow-MCP server identifier.'),
    name: z.string().describe('Server display name, shown to connecting MCP clients.'),
    description: z.string().nullable().describe('Optional server description, or null when unset.'),
    isPublic: z.boolean().describe('Whether the server answers MCP clients without a Sim API key.'),
    mcpServerUrl: z
      .string()
      .describe('Endpoint an MCP client connects to. Published here so callers never build it.')
      .meta({ examples: ['https://www.sim.ai/api/mcp/serve/wfmcp_01J8ZK3QW4M6X2R9T7B5C0V2'] }),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when the server was created.')
      .meta({ format: 'date-time' }),
    updatedAt: z
      .string()
      .describe('ISO 8601 timestamp when the server was last modified.')
      .meta({ format: 'date-time' }),
  })
  .meta({
    id: 'WorkflowMcpServer',
    title: 'Workflow MCP server',
    description: 'A workspace-published MCP server exposing deployed workflows as tools.',
  })
export type V2WorkflowMcpServer = z.output<typeof v2WorkflowMcpServerSchema>

/**
 * A server as the list publishes it: the resource plus the tool inventory it
 * exposes. The single-resource writes do not carry the inventory, because a
 * create or a rename does not read it and reporting a count the write did not
 * observe would be a lie the caller cannot detect.
 */
export const v2WorkflowMcpServerListItemSchema = v2WorkflowMcpServerSchema
  .extend({
    toolCount: z.number().int().nonnegative().describe('Number of workflows published as tools.'),
    toolNames: z
      .array(z.string())
      .describe('Tool names this server publishes, alphabetically ordered.'),
  })
  .meta({
    id: 'WorkflowMcpServerListItem',
    title: 'Workflow MCP server list item',
    description: 'A published MCP server together with the tool names it exposes.',
  })
export type V2WorkflowMcpServerListItem = z.output<typeof v2WorkflowMcpServerListItemSchema>

export const v2WorkflowMcpServerSortFields = ['name', 'createdAt', 'updatedAt'] as const
export type V2WorkflowMcpServerSortBy = (typeof v2WorkflowMcpServerSortFields)[number]

export const v2ListWorkflowMcpServersQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose published MCP servers to list.'),
    ...v2SortFields(v2WorkflowMcpServerSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
    ...v2PaginationFields({ description: 'Maximum workflow-MCP servers to return per page.' }),
  })
  .strict()
  .meta({
    id: 'ListWorkflowMcpServersQuery',
    title: 'List workflow MCP servers query',
    description: 'Workspace scope, ordering, and pagination for published MCP servers.',
  })
export type V2ListWorkflowMcpServersQuery = z.output<typeof v2ListWorkflowMcpServersQuerySchema>

export const v2CreateWorkflowMcpServerBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to publish the server.'),
    name: z
      .string({ error: 'name is required' })
      .trim()
      .min(1, 'name cannot be empty')
      .max(
        V2_WORKFLOW_MCP_SERVER_NAME_MAX,
        `name must be at most ${V2_WORKFLOW_MCP_SERVER_NAME_MAX} characters`
      )
      .describe('Server display name, shown to connecting MCP clients.'),
    description: z
      .string()
      .trim()
      .max(
        V2_WORKFLOW_MCP_SERVER_DESCRIPTION_MAX,
        `description must be at most ${V2_WORKFLOW_MCP_SERVER_DESCRIPTION_MAX} characters`
      )
      .optional()
      .describe('Optional server description.'),
    isPublic: z
      .boolean()
      .optional()
      .describe(
        'Whether the server answers MCP clients without a Sim API key. Defaults to false — a public server executes the workflows it publishes for anyone holding its URL.'
      )
      .meta({ default: false }),
    workflowIds: z
      .array(workflowIdSchema)
      .max(
        V2_WORKFLOW_MCP_PARAMETER_DESCRIPTIONS_MAX,
        `workflowIds must contain at most ${V2_WORKFLOW_MCP_PARAMETER_DESCRIPTIONS_MAX} entries`
      )
      .optional()
      .describe('Deployed workflows to publish as tools on the new server.'),
  })
  .strict()
  .meta({
    id: 'CreateWorkflowMcpServerRequest',
    title: 'Create workflow MCP server request',
    description: 'A new workspace-published MCP server and the workflows it exposes.',
    examples: [
      {
        workspaceId: '9f4c2a10-3b7e-4d58-8f6a-2c1d0e5b7a94',
        name: 'Support agents',
        workflowIds: ['3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'],
      },
    ],
  })
export type V2CreateWorkflowMcpServerBody = z.input<typeof v2CreateWorkflowMcpServerBodySchema>

/**
 * Merge-patch shaped: an omitted key is unchanged, and `description: null`
 * clears the description. At least one key is required, so a body that would
 * change nothing is a `400` rather than a `200` that did nothing.
 */
export const v2UpdateWorkflowMcpServerBodySchema = z
  .object({
    name: v2CreateWorkflowMcpServerBodySchema.shape.name.optional(),
    description: z
      .string()
      .trim()
      .max(
        V2_WORKFLOW_MCP_SERVER_DESCRIPTION_MAX,
        `description must be at most ${V2_WORKFLOW_MCP_SERVER_DESCRIPTION_MAX} characters`
      )
      .nullable()
      .optional()
      .describe('New server description, or null to clear it.'),
    isPublic: z
      .boolean()
      .optional()
      .describe('Whether the server answers MCP clients without a Sim API key.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.name === undefined && body.description === undefined && body.isPublic === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'At least one of name, description, or isPublic must be provided',
      })
    }
  })
  .meta({
    id: 'UpdateWorkflowMcpServerRequest',
    title: 'Update workflow MCP server request',
    description: 'Merge-patch body for a published MCP server.',
    examples: [{ isPublic: true }],
  })
export type V2UpdateWorkflowMcpServerBody = z.input<typeof v2UpdateWorkflowMcpServerBodySchema>

export const v2DeleteWorkflowMcpServerDataSchema = z
  .object({
    id: z.string().describe('Identifier of the unpublished server.'),
    deleted: z.literal(true).describe('Whether the server was unpublished.'),
  })
  .meta({
    id: 'DeleteWorkflowMcpServerResult',
    title: 'Delete workflow MCP server result',
    description: 'Unpublish acknowledgement.',
  })
export type V2DeleteWorkflowMcpServerData = z.output<typeof v2DeleteWorkflowMcpServerDataSchema>

export const v2WorkflowMcpToolSchema = z
  .object({
    id: z.string().describe('Unique tool identifier.'),
    serverId: z.string().describe('Server that publishes this tool.'),
    workflowId: z.string().describe('Workflow this tool executes.'),
    toolName: z
      .string()
      .describe(
        'Name an MCP client calls. Derived from the supplied name or the workflow name, normalized to the MCP tool-name grammar.'
      ),
    toolDescription: z.string().nullable().describe('Description shown to MCP clients.'),
    mcpServerUrl: z.string().describe('Endpoint an MCP client connects to.'),
    apiEndpoint: z.string().describe('Sim execution endpoint this tool calls through.'),
    updated: z
      .boolean()
      .describe(
        'False when the workflow was newly published on this server, true when an existing tool was replaced. Publishing is idempotent per workflow, so a repeat call answers 200 with true rather than conflicting.'
      ),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when the tool was created.')
      .meta({ format: 'date-time' }),
    updatedAt: z
      .string()
      .describe('ISO 8601 timestamp when the tool was last modified.')
      .meta({ format: 'date-time' }),
  })
  .meta({
    id: 'WorkflowMcpTool',
    title: 'Workflow MCP tool',
    description: 'A deployed workflow published as a tool on a workflow-MCP server.',
  })
export type V2WorkflowMcpTool = z.output<typeof v2WorkflowMcpToolSchema>

export const v2DeployWorkflowMcpToolBodySchema = z
  .object({
    workflowId: workflowIdSchema.describe(
      'Deployed workflow to publish. The workflow must already be deployed.'
    ),
    toolName: z
      .string()
      .trim()
      .min(1, 'toolName cannot be empty')
      .max(
        V2_WORKFLOW_MCP_TOOL_NAME_MAX,
        `toolName must be at most ${V2_WORKFLOW_MCP_TOOL_NAME_MAX} characters`
      )
      .optional()
      .describe(
        'Name MCP clients call. Normalized to the MCP tool-name grammar, and derived from the workflow name when omitted.'
      ),
    toolDescription: z
      .string()
      .trim()
      .max(
        V2_WORKFLOW_MCP_TOOL_DESCRIPTION_MAX,
        `toolDescription must be at most ${V2_WORKFLOW_MCP_TOOL_DESCRIPTION_MAX} characters`
      )
      .optional()
      .describe('Description shown to MCP clients. Derived from the workflow name when omitted.'),
    parameterDescriptions: z
      .array(
        z
          .object({
            name: z
              .string()
              .trim()
              .min(1, 'parameterDescriptions[].name cannot be empty')
              .describe('Input field of the deployed workflow to describe.'),
            description: z
              .string()
              .trim()
              .min(1, 'parameterDescriptions[].description cannot be empty')
              .max(
                V2_WORKFLOW_MCP_TOOL_DESCRIPTION_MAX,
                `parameterDescriptions[].description must be at most ${V2_WORKFLOW_MCP_TOOL_DESCRIPTION_MAX} characters`
              )
              .describe('Text MCP clients see for that field.'),
          })
          .strict()
      )
      .max(
        V2_WORKFLOW_MCP_PARAMETER_DESCRIPTIONS_MAX,
        `parameterDescriptions must contain at most ${V2_WORKFLOW_MCP_PARAMETER_DESCRIPTIONS_MAX} entries`
      )
      .optional()
      .describe(
        'Per-field description overrides applied to the schema generated from the deployed workflow inputs. A name matching no input field is ignored.'
      ),
  })
  .strict()
  .meta({
    id: 'DeployWorkflowMcpToolRequest',
    title: 'Publish workflow as MCP tool request',
    description: 'The workflow to publish and the tool metadata MCP clients see.',
    examples: [{ workflowId: '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36', toolName: 'triage_ticket' }],
  })
export type V2DeployWorkflowMcpToolBody = z.input<typeof v2DeployWorkflowMcpToolBodySchema>

export const v2UndeployWorkflowMcpToolDataSchema = z
  .object({
    id: z.string().describe('Identifier of the removed tool.'),
    serverId: z.string().describe('Server the tool was removed from.'),
    workflowId: z.string().describe('Workflow that is no longer published.'),
    deleted: z.literal(true).describe('Whether the tool was removed.'),
  })
  .meta({
    id: 'UndeployWorkflowMcpToolResult',
    title: 'Unpublish workflow MCP tool result',
    description: 'Tool removal acknowledgement.',
  })
export type V2UndeployWorkflowMcpToolData = z.output<typeof v2UndeployWorkflowMcpToolDataSchema>

export const v2ListWorkflowMcpServersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflow-mcp-servers',
  query: v2ListWorkflowMcpServersQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowMcpServerListItemSchema).extend({
      toolNamesTruncated: z
        .boolean()
        .describe(
          'Whether the page-wide tool-name limit left some inventories incomplete. Use List Workflow MCP Tools for one server and check its `truncated` flag before treating the inventory as complete. `nextCursor` paginates servers, not tool names.'
        ),
    }),
  },
})

export const v2CreateWorkflowMcpServerContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflow-mcp-servers',
  query: noInputSchema,
  body: v2CreateWorkflowMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowMcpServerSchema),
    /**
     * A created resource, like every other v2 collection `POST` that mints one.
     * Its sibling `POST /api/v2/mcp-servers` already answers `201`; publishing a
     * workflow as a tool below deliberately stays `200` because re-posting an
     * already-published workflow updates it rather than creating a second one.
     */
    status: 201,
  },
})

/**
 * A published tool as a read returns it.
 *
 * `updated` is omitted deliberately: it reports whether a *publish* replaced an
 * existing tool, which is a fact about that request, not about the tool.
 * Publishing it here would force every read to answer a question it cannot.
 */
export const v2WorkflowMcpToolListItemSchema = v2WorkflowMcpToolSchema
  .omit({ updated: true })
  .meta({
    id: 'WorkflowMcpToolListItem',
    title: 'Workflow MCP tool list item',
    description: 'A tool a server publishes, as returned by a read.',
  })
export type V2WorkflowMcpToolListItem = z.output<typeof v2WorkflowMcpToolListItemSchema>

export const v2GetWorkflowMcpServerContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflow-mcp-servers/[serverId]',
  query: noInputSchema,
  params: v2WorkflowMcpServerParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowMcpServerSchema),
  },
})

export const v2ListWorkflowMcpToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflow-mcp-servers/[serverId]/tools',
  query: noInputSchema,
  params: v2WorkflowMcpServerParamsSchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowMcpToolListItemSchema, { paged: false }).extend({
      truncated: z
        .boolean()
        .describe(
          'Whether the tool limit left this inventory incomplete. The list is unpaginated and `nextCursor` remains null even when truncated. Do not treat a truncated inventory as the complete set of published tools.'
        ),
    }),
  },
})

export const v2UpdateWorkflowMcpServerContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflow-mcp-servers/[serverId]',
  query: noInputSchema,
  params: v2WorkflowMcpServerParamsSchema,
  body: v2UpdateWorkflowMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowMcpServerSchema),
  },
})

export const v2DeleteWorkflowMcpServerContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflow-mcp-servers/[serverId]',
  query: noInputSchema,
  params: v2WorkflowMcpServerParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteWorkflowMcpServerDataSchema),
  },
})

export const v2DeployWorkflowMcpToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflow-mcp-servers/[serverId]/tools',
  query: noInputSchema,
  params: v2WorkflowMcpServerParamsSchema,
  body: v2DeployWorkflowMcpToolBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowMcpToolSchema),
  },
})

export const v2UndeployWorkflowMcpToolContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflow-mcp-servers/[serverId]/tools/[workflowId]',
  query: noInputSchema,
  params: v2WorkflowMcpToolParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UndeployWorkflowMcpToolDataSchema),
  },
})
