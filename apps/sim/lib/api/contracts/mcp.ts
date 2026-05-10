import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import type { McpToolSchema, McpToolSchemaProperty } from '@/lib/mcp/types'

const dateStringSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string()
)

const optionalStringFromNullableSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional()
)

const optionalDateStringFromNullableSchema = z.preprocess((value) => {
  if (value instanceof Date) return value.toISOString()
  return value === null ? undefined : value
}, z.string().optional())

const optionalNumberFromNullableSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.number().optional()
)

const optionalConnectionStatusFromNullableSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.enum(['connected', 'disconnected', 'error']).optional()
)

const optionalHeadersFromNullableSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.record(z.string(), z.string()).optional()
)

export const mcpTransportSchema = z.enum(['streamable-http'])

export const mcpServerStatusConfigSchema = z
  .object({
    consecutiveFailures: z.number().default(0),
    lastSuccessfulDiscovery: z.string().nullable().default(null),
  })
  .passthrough()

export const mcpToolSchemaPropertySchema: z.ZodType<McpToolSchemaProperty> = z.lazy(() =>
  z
    .object({
      type: z.union([z.string(), z.array(z.string())]).optional(),
      description: z.string().optional(),
      items: mcpToolSchemaPropertySchema.optional(),
      properties: z.record(z.string(), mcpToolSchemaPropertySchema).optional(),
      required: z.array(z.string()).optional(),
      enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      default: z.unknown().optional(),
    })
    .passthrough()
)

export const mcpToolInputSchema: z.ZodType<McpToolSchema> = z
  .object({
    type: z.literal('object'),
    properties: z.record(z.string(), mcpToolSchemaPropertySchema).optional(),
    required: z.array(z.string()).optional(),
    description: z.string().optional(),
  })
  .passthrough()

export const mcpToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: mcpToolInputSchema,
  serverId: z.string(),
  serverName: z.string(),
})

export const storedMcpToolSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  serverId: z.string(),
  serverUrl: z.string().optional(),
  toolName: z.string(),
  schema: mcpToolInputSchema.optional(),
})

export const mcpServerSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    description: optionalStringFromNullableSchema,
    transport: mcpTransportSchema,
    url: optionalStringFromNullableSchema,
    timeout: optionalNumberFromNullableSchema,
    retries: optionalNumberFromNullableSchema,
    headers: optionalHeadersFromNullableSchema,
    enabled: z.boolean(),
    connectionStatus: optionalConnectionStatusFromNullableSchema,
    lastError: z.string().nullable().optional(),
    statusConfig: z.preprocess(
      (value) => (value === null ? undefined : value),
      mcpServerStatusConfigSchema.optional()
    ),
    toolCount: optionalNumberFromNullableSchema,
    lastToolsRefresh: optionalDateStringFromNullableSchema,
    lastConnected: optionalDateStringFromNullableSchema,
    createdAt: dateStringSchema,
    updatedAt: dateStringSchema,
    deletedAt: optionalDateStringFromNullableSchema,
  })
  .passthrough()
export type McpServer = z.output<typeof mcpServerSchema>

export const mcpWorkspaceQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const mcpServerIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const createMcpServerBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    transport: mcpTransportSchema,
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
    retries: z.number().optional(),
    enabled: z.boolean().optional(),
    source: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough()

export const updateMcpServerBodySchema = createMcpServerBodySchema.partial()

export const deleteMcpServerQuerySchema = mcpWorkspaceQuerySchema.extend({
  serverId: z.string().min(1),
  source: z.string().optional(),
})

export const deleteMcpServerByQuerySchema = z.object({
  serverId: z.string().optional(),
  source: z.string().optional(),
})

export const discoverMcpToolsQuerySchema = mcpWorkspaceQuerySchema.extend({
  serverId: z.string().optional(),
  refresh: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .optional(),
})

export const refreshMcpToolsBodySchema = z.object({
  serverIds: z.array(z.string()),
})

export const mcpEventsQuerySchema = z.object({
  workspaceId: z.string().min(1).nullable(),
})

export const mcpServeRouteParamsSchema = z.object({
  serverId: z.string().min(1),
})

export const mcpToolDiscoveryQuerySchema = z.object({
  serverId: z.string().optional(),
  refresh: z.string().optional(),
})

export const mcpToolExecutionBodySchema = z
  .object({
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
    workflowId: z.string().optional(),
  })
  .passthrough()
export type McpToolExecutionBody = z.input<typeof mcpToolExecutionBodySchema>

export const mcpJsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .passthrough()

export const mcpJsonRpcNotificationSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .passthrough()

export const mcpJsonRpcMessageSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
  })
  .passthrough()

export const mcpRequestBodySchema = z.union([
  mcpJsonRpcMessageSchema,
  z.array(mcpJsonRpcMessageSchema),
])

export const mcpToolCallParamsSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const mcpServerTestBodySchema = z
  .object({
    name: z.string().min(1),
    transport: mcpTransportSchema,
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough()
export type McpServerTestBody = z.input<typeof mcpServerTestBodySchema>

export const mcpServerTestResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
  serverInfo: z
    .object({
      name: z.string(),
      version: z.string(),
    })
    .optional(),
  negotiatedVersion: z.string().optional(),
  supportedCapabilities: z.array(z.string()).optional(),
  toolCount: z.number().optional(),
  warnings: z.array(z.string()).optional(),
})
export type McpServerTestResult = z.output<typeof mcpServerTestResultSchema>

export const refreshMcpServerResultSchema = z.object({
  status: z.enum(['connected', 'disconnected', 'error']),
  toolCount: z.number(),
  lastConnected: z.string().nullable(),
  error: z.string().nullable(),
  workflowsUpdated: z.number(),
  updatedWorkflowIds: z.array(z.string()),
})
export type RefreshMcpServerResult = z.output<typeof refreshMcpServerResultSchema>

const mcpSuccessResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

export const listMcpServersContract = defineRouteContract({
  method: 'GET',
  path: '/api/mcp/servers',
  query: mcpWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(
      z.object({
        servers: z.array(mcpServerSchema),
      })
    ),
  },
})
export type ListMcpServersResponse = ContractJsonResponse<typeof listMcpServersContract>

export const createMcpServerContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/servers',
  body: createMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(
      z.object({
        serverId: z.string(),
        updated: z.boolean().optional(),
      })
    ),
  },
})

export const deleteMcpServerContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/mcp/servers',
  query: deleteMcpServerQuerySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(
      z.object({
        message: z.string(),
      })
    ),
  },
})

export const updateMcpServerContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/mcp/servers/[id]',
  params: mcpServerIdParamsSchema,
  query: mcpWorkspaceQuerySchema,
  body: updateMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(
      z.object({
        server: mcpServerSchema,
      })
    ),
  },
})

export const refreshMcpServerContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/servers/[id]/refresh',
  params: mcpServerIdParamsSchema,
  query: mcpWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(refreshMcpServerResultSchema),
  },
})

export const discoverMcpToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/mcp/tools/discover',
  query: discoverMcpToolsQuerySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(
      z.object({
        tools: z.array(mcpToolSchema),
        totalCount: z.number(),
        byServer: z.record(z.string(), z.number()),
      })
    ),
  },
})
export type DiscoverMcpToolsResponse = ContractJsonResponse<typeof discoverMcpToolsContract>

export const refreshMcpToolsContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/tools/discover',
  query: mcpWorkspaceQuerySchema,
  body: refreshMcpToolsBodySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(
      z.object({
        refreshed: z.array(z.object({ serverId: z.string(), toolCount: z.number() })),
        failed: z.array(z.object({ serverId: z.string(), error: z.string() })),
        summary: z.object({
          total: z.number(),
          successful: z.number(),
          failed: z.number(),
        }),
      })
    ),
  },
})

export const listStoredMcpToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/mcp/tools/stored',
  query: mcpWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(
      z.object({
        tools: z.array(storedMcpToolSchema),
      })
    ),
  },
})

export const testMcpServerConnectionContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/servers/test-connection',
  body: mcpServerTestBodySchema,
  response: {
    mode: 'json',
    schema: mcpSuccessResponseSchema(mcpServerTestResultSchema),
  },
})

export const getAllowedMcpDomainsContract = defineRouteContract({
  method: 'GET',
  path: '/api/settings/allowed-mcp-domains',
  response: {
    mode: 'json',
    schema: z.object({
      allowedMcpDomains: z.array(z.string()).nullable(),
    }),
  },
})
