import { z } from 'zod'
import { mcpAuthTypeSchema, mcpServerSchema, mcpTransportSchema } from '@/lib/api/contracts/mcp'
import {
  booleanQueryFlagSchema,
  noInputSchema,
  nonEmptyIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'

/**
 * v2 MCP server contracts.
 *
 * The routes are thin wrappers over `lib/mcp/orchestration`, but the public
 * contract deliberately departs from the internal `/api/mcp/servers` shape in
 * four places, each closing a hole that is merely awkward in a browser session
 * and unsafe over an API key:
 *
 * 1. `headers` is write-only. The internal list returns the header map verbatim,
 *    which is where callers put `Authorization: Bearer …`; reusing that shape
 *    here would turn a read-scoped key into a token-exfiltration primitive. The
 *    public read exposes `hasHeaders` and `headerNames` only.
 * 2. `url` must be a real absolute `http(s)` URL — the internal body accepts any
 *    string (or none at all).
 * 3. `url` may not carry a `{{ENV_VAR}}` template. `lib/mcp/domain-check` skips
 *    both the domain allowlist and the SSRF resolve for templated hostnames,
 *    deferring validation to call time; over an API key that is a stored SSRF
 *    path.
 * 4. Bodies are strict. An unrecognized field is a caller mistake, not something
 *    to silently pass through to storage.
 */

/** A `{{ENV_VAR}}` reference anywhere in a URL defers domain/SSRF validation to call time. */
function hasEnvVarTemplate(value: string): boolean {
  return createEnvVarPattern().test(value)
}

const v2McpServerUrlSchema = z
  .string({ error: 'url is required' })
  .min(1, 'url is required')
  .max(2048, 'url must be at most 2048 characters')
  .refine((value) => !hasEnvVarTemplate(value), {
    error: 'url must not contain {{ENV_VAR}} references on the public API',
  })
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol
        return protocol === 'http:' || protocol === 'https:'
      } catch {
        return false
      }
    },
    { error: 'url must be an absolute http or https URL' }
  )
  .describe(
    'Absolute HTTP or HTTPS endpoint URL without `{{ENV_VAR}}` references. It determines server identity and is immutable: delete and recreate the server to change endpoints.'
  )

const v2McpServerHeadersSchema = z.record(
  z.string().min(1, 'Header names cannot be empty'),
  z.string().describe('Header value sent to the MCP server.')
)

/**
 * Public MCP server projection.
 *
 * The field schemas are picked from {@link mcpServerSchema} so the legacy-row
 * tolerance (`.catch()` on the free-text `transport`/`authType`/
 * `connection_status` columns) is shared with the internal surface. The pick is
 * re-wrapped in a plain object so the result strips unknown keys instead of
 * passing them through — that strip is what keeps `headers` and
 * `oauthClientSecret` out of the response when a whole row is handed to it.
 */
export const v2McpServerSchema = z
  .object({
    ...mcpServerSchema.pick({
      id: true,
      name: true,
      description: true,
      transport: true,
      authType: true,
      url: true,
      timeout: true,
      retries: true,
      enabled: true,
      connectionStatus: true,
      lastError: true,
      toolCount: true,
      lastToolsRefresh: true,
      lastConnected: true,
      createdAt: true,
      updatedAt: true,
      oauthClientId: true,
    }).shape,
    id: mcpServerSchema.shape.id.describe(
      'Unique server identifier derived from the workspace and endpoint URL.'
    ),
    name: mcpServerSchema.shape.name.describe('Server display name.'),
    description: mcpServerSchema.shape.description.describe('Optional server description.'),
    transport: mcpServerSchema.shape.transport.describe(
      'Transport used to communicate with the server.'
    ),
    authType: mcpServerSchema.shape.authType.describe('Authentication method used by the server.'),
    url: mcpServerSchema.shape.url.describe('Server endpoint URL.'),
    timeout: mcpServerSchema.shape.timeout.describe('Per-request timeout in milliseconds.'),
    retries: mcpServerSchema.shape.retries.describe('Number of retries attempted per request.'),
    enabled: mcpServerSchema.shape.enabled.describe(
      'Whether the server tools are available to workflows.'
    ),
    /**
     * These three are written only by a real discovery. Registration's one
     * outbound touch is the auth-type probe, which classifies the endpoint and
     * never records a connection, so registration leaves all three at their
     * defaults rather than asserting a connection nothing has verified.
     */
    connectionStatus: mcpServerSchema.shape.connectionStatus.describe(
      'Result of the most recent connection attempt. Registration and re-registration establish no connection — the auth-type probe they may send does not count as one — so a server begins, and returns to, `disconnected` until a tool discovery runs.'
    ),
    lastError: mcpServerSchema.shape.lastError.describe(
      'Message from the most recent failed connection, or null when absent. A re-registration clears it, since the configuration it described no longer applies.'
    ),
    toolCount: mcpServerSchema.shape.toolCount.describe(
      'Number of tools discovered on the server.'
    ),
    lastToolsRefresh: mcpServerSchema.shape.lastToolsRefresh.describe(
      'ISO 8601 timestamp of the most recent tool-list refresh.'
    ),
    lastConnected: mcpServerSchema.shape.lastConnected.describe(
      'ISO 8601 timestamp of the most recent successful connection. Absent until the server completes one; registering a server does not set it.'
    ),
    createdAt: mcpServerSchema.shape.createdAt.describe(
      'ISO 8601 timestamp when the server was registered.'
    ),
    updatedAt: mcpServerSchema.shape.updatedAt.describe(
      'ISO 8601 timestamp when the server was last updated.'
    ),
    oauthClientId: mcpServerSchema.shape.oauthClientId.describe(
      'Pre-registered OAuth client identifier, when configured.'
    ),
    /** Whether any request headers are configured. Values are never returned. */
    hasHeaders: z.boolean().describe('Whether any request headers are configured.'),
    /** Names of the configured request headers. Values are never returned. */
    headerNames: z
      .array(z.string().describe('Configured header name.'))
      .describe('Names of configured request headers. Header values are never returned.'),
    hasOauthClientSecret: z
      .boolean()
      .describe('Whether an OAuth client secret is stored. The value is never returned.'),
  })
  .meta({
    id: 'V2McpServer',
    title: 'MCP server',
    description: 'Public MCP server configuration without write-only credential values.',
  })
export type V2McpServer = z.output<typeof v2McpServerSchema>

/** Delete acknowledgement — the id of the server that was deleted. */
export const v2McpServerDeleteDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted MCP server.'),
    deleted: z.literal(true).describe('Whether the server was deleted.'),
  })
  .meta({
    id: 'V2McpServerDeleteData',
    title: 'Delete MCP server data',
    description: 'MCP server deletion acknowledgement.',
  })
export type V2McpServerDeleteData = z.output<typeof v2McpServerDeleteDataSchema>

export const v2McpServerParamsSchema = z.object({
  mcpServerId: nonEmptyIdSchema.describe('Unique MCP server identifier.'),
})
export type V2McpServerParams = z.output<typeof v2McpServerParamsSchema>

export const v2McpServerWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the MCP server.'),
  })
  .strict()
export type V2McpServerWorkspaceQuery = z.output<typeof v2McpServerWorkspaceQuerySchema>

export const v2McpServerSortFields = ['name', 'createdAt', 'updatedAt'] as const

export type V2McpServerSortBy = (typeof v2McpServerSortFields)[number]

export const v2ListMcpServersQuerySchema = v2McpServerWorkspaceQuerySchema
  .extend({
    search: v2SearchSchema.describe('Case-insensitive substring match against the server name.'),
    ...v2SortFields(v2McpServerSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
    ...v2PaginationFields({ description: 'Maximum MCP servers to return per page.' }),
  })
  .strict()

export type V2ListMcpServersQuery = z.output<typeof v2ListMcpServersQuerySchema>

export const v2CreateMcpServerBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to register the server.'),
    name: z
      .string({ error: 'name is required' })
      .min(1, 'name is required')
      .max(255, 'name must be at most 255 characters')
      .describe('Server display name.'),
    description: z
      .string()
      .max(2000, 'description must be at most 2000 characters')
      .optional()
      .describe('Optional server description.'),
    transport: mcpTransportSchema
      .optional()
      .describe('Transport protocol. Defaults to `streamable-http` on creation.')
      .meta({ default: 'streamable-http' }),
    url: v2McpServerUrlSchema,
    /**
     * No published `default`: when the field is omitted the stored value is
     * detected, not defaulted, so a `default` here would be wrong on create and
     * — inherited by the `.partial()` update body — would make an SDK that
     * materializes JSON-Schema defaults revoke a stored OAuth grant on every
     * unrelated PATCH.
     */
    authType: mcpAuthTypeSchema
      .optional()
      .describe(
        'Authentication method. When omitted, and no `headers` are sent, registration probes the endpoint once to classify it, falling back to `headers` when the probe fails or the server does not advertise OAuth. A server publishing RFC 9728 metadata is therefore stored as `oauth`, and headers configured afterwards will not authenticate — send this field explicitly to pin the method.'
      ),
    /** Write-only. Reads expose `hasHeaders` and `headerNames` instead. */
    headers: v2McpServerHeadersSchema
      .optional()
      .describe(
        'Write-only request headers sent to the server. Replaced wholesale rather than merged on update: sending this field drops every stored header it does not repeat.'
      )
      .meta({ writeOnly: true }),
    timeout: z
      .number()
      .int('timeout must be an integer number of milliseconds')
      .min(1000, 'timeout must be at least 1000ms')
      .max(300000, 'timeout must be at most 300000ms')
      .optional()
      .describe('Per-request timeout in milliseconds. Defaults to 30000 on creation.')
      .meta({ default: 30_000 }),
    retries: z
      .number()
      .int('retries must be an integer')
      .min(0, 'retries cannot be negative')
      .max(10, 'retries must be at most 10')
      .optional()
      .describe('Number of retries per request. Defaults to 3 on creation.')
      .meta({ default: 3 }),
    enabled: z
      .boolean()
      .optional()
      .describe("Whether workflows can use the server's tools. Defaults to true on creation.")
      .meta({ default: true }),
    oauthClientId: z
      .string()
      .max(512, 'oauthClientId is too long')
      .nullable()
      .optional()
      .describe(
        'Pre-registered OAuth client identifier. Changing it on update revokes the stored OAuth grant and forces reauthorization.'
      ),
    /** Write-only. Reads expose `hasOauthClientSecret` instead. */
    oauthClientSecret: z
      .string()
      .max(2048, 'oauthClientSecret is too long')
      .nullable()
      .optional()
      .describe(
        'Write-only pre-registered OAuth client secret. Sending it on update as null or a new value revokes the stored OAuth grant and forces reauthorization, as does switching away from OAuth authentication.'
      )
      .meta({ writeOnly: true }),
  })
  .strict()
export type V2CreateMcpServerBody = z.input<typeof v2CreateMcpServerBodySchema>

/**
 * Update body. Every configuration field is optional; `workspaceId` stays
 * required so the request is tenant-scoped before the server id is resolved.
 */
export const v2UpdateMcpServerBodySchema = v2CreateMcpServerBodySchema
  .partial()
  .extend({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the MCP server.'),
    url: v2McpServerUrlSchema
      .optional()
      .describe(
        'Immutable server URL. When provided, it must equal the current URL; use delete and create to change endpoints.'
      ),
  })
  .strict()
export type V2UpdateMcpServerBody = z.input<typeof v2UpdateMcpServerBodySchema>

/**
 * A tool's argument schema, as the MCP server reports it.
 *
 * Everything below the `object` wrapper is authored by the third-party server,
 * so it is published open (`catchall`) and passed through rather than
 * re-validated keyword by keyword — the same treatment the v2 custom-tool
 * declaration gives an OpenAI function's `parameters`. `type` can be pinned to
 * the literal because the MCP SDK's own `ListToolsResult` schema already rejects
 * a tool whose `inputSchema.type` is anything else, so a server cannot make this
 * response fail its own validation. `properties` and `required` are pinned on
 * the same ground, and the SDK is the stricter of the two on `properties`.
 *
 * The rule that keeps this safe is that a key may only be declared here when the
 * SDK declares it at least as tightly. `description` may not: the SDK's
 * `ToolSchema.inputSchema` does not declare it at all, so its own
 * `.catchall(z.unknown())` admits any value — including the JSON `null` a Python
 * server emits for an absent description. Declaring it `z.string().optional()`
 * made the builder's outbound `.parse()` throw on a payload the protocol
 * permits, and discovery answered a bare 500. It is left to the `catchall`
 * below, which publishes as `additionalProperties` and passes the value through
 * untouched.
 */
const v2McpToolInputSchema = z
  .object({
    type: z
      .literal('object')
      .describe('JSON Schema type of the argument object. MCP requires `object`.'),
    properties: z
      .record(z.string(), z.unknown().describe('Server-defined JSON Schema for one tool argument.'))
      .optional()
      .describe('Argument schemas keyed by argument name.'),
    required: z
      .array(z.string().describe('Name of a required argument.'))
      .optional()
      .describe('Names of the arguments the tool requires.'),
  })
  .catchall(z.unknown().describe('Additional JSON Schema keyword reported by the server.'))
  .describe("JSON Schema for the tool's arguments, as reported by the server.")

/** One tool exposed by a registered MCP server. */
export const v2McpToolSchema = z
  .object({
    name: z.string().describe('Tool name, as the MCP server reports it.'),
    description: z.string().optional().describe('Tool description reported by the server.'),
    inputSchema: v2McpToolInputSchema,
    serverId: z.string().describe('Identifier of the MCP server exposing the tool.'),
    serverName: z.string().describe('Display name of the MCP server exposing the tool.'),
  })
  .strict()
  .meta({
    id: 'V2McpTool',
    title: 'MCP tool',
    description: 'A tool exposed by a registered MCP server.',
  })
export type V2McpTool = z.output<typeof v2McpToolSchema>

export const v2ListMcpServerToolsQuerySchema = v2McpServerWorkspaceQuerySchema
  .extend({
    refresh: booleanQueryFlagSchema
      .optional()
      .default(false)
      .describe(
        "Refresh tools using your credentials. Otherwise results may reuse another workspace member's recent discovery and omit newly added tools."
      ),
  })
  .strict()
export type V2ListMcpServerToolsQuery = z.output<typeof v2ListMcpServerToolsQuerySchema>

/**
 * MCP server list, keyset-paginated over the active sort.
 *
 * Nothing caps how many servers a workspace may register, so the original
 * single-page shape was the one unbounded list on the v2 surface. Callers that
 * relied on reading every server from one response must now follow `nextCursor`.
 */
export const v2ListMcpServersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/mcp-servers',
  query: v2ListMcpServersQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2McpServerSchema),
  },
})

export const v2CreateMcpServerContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/mcp-servers',
  query: noInputSchema,
  body: v2CreateMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2McpServerSchema),
    status: 201,
  },
})

export const v2GetMcpServerContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/mcp-servers/[mcpServerId]',
  params: v2McpServerParamsSchema,
  query: v2McpServerWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2McpServerSchema),
  },
})

export const v2UpdateMcpServerContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/mcp-servers/[mcpServerId]',
  query: noInputSchema,
  params: v2McpServerParamsSchema,
  body: v2UpdateMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2McpServerSchema),
  },
})

export const v2DeleteMcpServerContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/mcp-servers/[mcpServerId]',
  params: v2McpServerParamsSchema,
  query: v2McpServerWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2McpServerDeleteDataSchema),
  },
})

/**
 * One server's tool inventory, returned as a single page (`nextCursor` is always
 * `null`). Unlike the server list, this set is bounded by construction: tool
 * discovery stops at 1,000 tools and 5 MB of tool payload per server no matter
 * what the upstream server reports, so there is no page for a cursor to name.
 */
export const v2ListMcpServerToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/mcp-servers/[mcpServerId]/tools',
  params: v2McpServerParamsSchema,
  query: v2ListMcpServerToolsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2McpToolSchema, { paged: false }),
  },
})
