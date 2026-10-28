import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { SIM_DOCS_URL } from '@sim/utils/site'
import { z } from 'zod'
import {
  describeOperation,
  describeOperationOutput,
  OPERATION_DOMAINS,
  resolveOperation,
  searchOperations,
  searchOperationsOutput,
  TOOL_NAMES,
} from '@/lib/api/mcp/catalog'
import {
  dispatchMcpOperation,
  type McpDispatchContext,
  type McpOperationCall,
} from '@/lib/api/mcp/dispatch'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { structuredToolResult, toolError } from '@/lib/mcp/tool-result'

const logger = createLogger('SimMcpServer')

const DESCRIPTION =
  'Lets an agent work in Sim, the AI workspace for building, deploying, and managing AI agents: search the Sim API, then read or change workspaces, workflows and their runs, tables, knowledge bases, files, logs, credentials, and deployments.'

const INSTRUCTIONS = `Sim is the AI workspace where teams build, deploy, and manage AI agents. This server exposes the full Sim API: workspaces, workflows and their runs, tables, knowledge bases, files, logs, credentials, deployments, and more.

1. Find an operation with search_operations (keywords, optionally a domain).
2. Read its input schemas with describe_operation.
3. Run it with the tool search_operations names: call_read_operation for operations that only read, call_write_operation for everything else.

Most operations take a workspaceId; listWorkspaces returns the workspaces you can use. Put path parameters in params, query-string values in query, and the JSON request body in body. Responses use the Sim API envelope ({ "data": ... }); list operations page with limit and cursor. Streaming options are not supported over MCP.`

const operationName = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .describe('Operation name from search_operations, e.g. "listTables".')

const searchInput = z
  .object({
    query: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe(
        'Keywords matched against operation names, summaries, and paths, e.g. "table rows".'
      ),
    domain: z
      .enum(OPERATION_DOMAINS)
      .optional()
      .describe(
        'API area to search or list, such as tables, workflows, or knowledge. Omit to search every area.'
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe(
        'How many matching operations to return, best match first. When total in the result is larger, narrow the query or domain.'
      ),
  })
  .strict()

const describeInput = z.object({ operation: operationName }).strict()

/** Shared because a read is not always a GET: searching and querying post their filter as JSON. */
const callInput = z
  .object({
    operation: operationName,
    params: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Values for the bracketed segments of the operation’s path, by name, e.g. { "tableId": "..." }. IDs come from list operations such as listTables.'
      ),
    query: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe(
        'Query-string values by name, as the query schema from describe_operation lists them, e.g. { "limit": 50 } or the cursor from the previous page.'
      ),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Headers the operation’s describe_operation schema lists, such as upload-token. Sim sets authentication and content headers itself.'
      ),
    body: z
      .record(z.string(), z.unknown())
      .meta({ additionalProperties: true })
      .optional()
      .describe(
        'JSON request body matching the body schema from describe_operation. Omit it when the operation takes no body.'
      ),
  })
  .strict()

/**
 * The Sim MCP server for one HTTP request. A request owns its server, so no
 * credential outlives the request that presented it.
 *
 * Four tools cover the whole v2 API instead of one tool per operation: a
 * catalog of 200-odd tools would overflow most clients' tool limits and spend
 * the model's context on schemas it never uses. Reads and writes are separate
 * tools so a client can approve reads once and still confirm every change.
 */
export function createSimMcpServer(context: Omit<McpDispatchContext, 'signal'>): McpServer {
  const baseUrl = getBaseUrl()
  const server = new McpServer(
    {
      name: 'Sim',
      title: 'Sim',
      version: '1.0.0',
      description: DESCRIPTION,
      websiteUrl: `${SIM_DOCS_URL}/mcp/overview`,
      icons: [
        {
          src: `${baseUrl}/favicon/android-chrome-512x512.png`,
          mimeType: 'image/png',
          sizes: ['512x512'],
        },
        {
          src: `${baseUrl}/favicon/android-chrome-192x192.png`,
          mimeType: 'image/png',
          sizes: ['192x192'],
        },
      ],
    },
    { instructions: INSTRUCTIONS }
  )

  async function call(
    tool: 'read' | 'write',
    { operation, ...input }: Omit<McpOperationCall, 'operation'> & { operation: string },
    toolSignal: AbortSignal
  ): Promise<CallToolResult> {
    const resolved = await resolveOperation(operation, tool)
    if ('error' in resolved) return toolError(resolved.error)
    const signal = AbortSignal.any([context.inbound.signal, toolSignal])
    try {
      return await dispatchMcpOperation(
        { ...input, operation: resolved.operation },
        { ...context, signal }
      )
    } catch (error) {
      if (signal.aborted) return toolError('The operation was cancelled.')
      logger.error('Sim MCP operation failed', { operation, error })
      return toolError('Unable to complete this operation. Please try again.')
    }
  }

  server.registerTool(
    'search_operations',
    {
      title: 'Search operations',
      description:
        'Find Sim API operations by keyword or domain. Returns how many match and, best match first, each operation’s name, HTTP method, path, summary, and the tool that runs it. Call without a query to list a domain.',
      inputSchema: searchInput,
      outputSchema: searchOperationsOutput,
      annotations: {
        title: 'Search operations',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => structuredToolResult(await searchOperations(input))
  )

  server.registerTool(
    'describe_operation',
    {
      title: 'Describe operation',
      description:
        'Get what is needed to call one operation: its HTTP method, path, summary, longer description when it has one, the tool that runs it, whether it refuses workspace API keys, and the JSON Schema of its path parameters, query, body, and headers. Read it before calling an operation for the first time.',
      inputSchema: describeInput,
      outputSchema: describeOperationOutput,
      annotations: {
        title: 'Describe operation',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ operation }) => {
      const resolved = await resolveOperation(operation, 'any')
      return 'error' in resolved
        ? toolError(resolved.error)
        : structuredToolResult(await describeOperation(resolved.operation))
    }
  )

  server.registerTool(
    TOOL_NAMES.read,
    {
      title: 'Read from Sim',
      description:
        'Run a Sim API operation that only reads, such as listWorkspaces, listTables, queryRows, or getWorkflowRun. search_operations says which tool runs each operation.',
      inputSchema: callInput,
      annotations: {
        title: 'Read from Sim',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input, extra) => call('read', input, extra.signal)
  )

  server.registerTool(
    TOOL_NAMES.write,
    {
      title: 'Write to Sim',
      description:
        'Run a Sim API operation that needs write access: one that creates, changes, runs, or deletes something, or reaches out to another service, such as createTable, executeWorkflow, or deleteFile. Changes apply immediately, with no preview or undo. A workflow run executes its blocks, which can call external services and use credits, so confirm deletions and runs with the user first.',
      inputSchema: callInput,
      annotations: {
        title: 'Write to Sim',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, extra) => call('write', input, extra.signal)
  )

  return server
}
