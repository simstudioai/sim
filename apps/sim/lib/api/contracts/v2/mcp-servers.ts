import { z } from 'zod'
import { mcpAuthTypeSchema, mcpServerSchema, mcpTransportSchema } from '@/lib/api/contracts/mcp'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
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

const v2McpServerHeadersSchema = z.record(
  z.string().min(1, 'Header names cannot be empty'),
  z.string()
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
export const v2McpServerSchema = z.object({
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
  /** Whether any request headers are configured. Values are never returned. */
  hasHeaders: z.boolean(),
  /** Names of the configured request headers. Values are never returned. */
  headerNames: z.array(z.string()),
  hasOauthClientSecret: z.boolean(),
})
export type V2McpServer = z.output<typeof v2McpServerSchema>

/** `{ mcpServer }` payload for single-server reads and mutations. */
export const v2McpServerDataSchema = z.object({ mcpServer: v2McpServerSchema })
export type V2McpServerData = z.output<typeof v2McpServerDataSchema>

/** Delete acknowledgement — the id of the server that was deleted. */
export const v2McpServerDeleteDataSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})
export type V2McpServerDeleteData = z.output<typeof v2McpServerDeleteDataSchema>

export const v2McpServerParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type V2McpServerParams = z.output<typeof v2McpServerParamsSchema>

export const v2McpServerWorkspaceQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})
export type V2McpServerWorkspaceQuery = z.output<typeof v2McpServerWorkspaceQuerySchema>

export const v2McpServerSortFields = ['name', 'createdAt', 'updatedAt'] as const

export type V2McpServerSortBy = (typeof v2McpServerSortFields)[number]

export const v2ListMcpServersQuerySchema = v2McpServerWorkspaceQuerySchema.extend({
  search: v2SearchSchema,
  ...v2SortFields(v2McpServerSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
})

export type V2ListMcpServersQuery = z.output<typeof v2ListMcpServersQuerySchema>

export const v2CreateMcpServerBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z
      .string({ error: 'name is required' })
      .min(1, 'name is required')
      .max(255, 'name must be at most 255 characters'),
    description: z.string().max(2000, 'description must be at most 2000 characters').optional(),
    transport: mcpTransportSchema.optional(),
    url: v2McpServerUrlSchema,
    authType: mcpAuthTypeSchema.optional(),
    /** Write-only. Reads expose `hasHeaders` and `headerNames` instead. */
    headers: v2McpServerHeadersSchema.optional(),
    timeout: z
      .number()
      .int('timeout must be an integer number of milliseconds')
      .min(1000, 'timeout must be at least 1000ms')
      .max(300000, 'timeout must be at most 300000ms')
      .optional(),
    retries: z
      .number()
      .int('retries must be an integer')
      .min(0, 'retries cannot be negative')
      .max(10, 'retries must be at most 10')
      .optional(),
    enabled: z.boolean().optional(),
    oauthClientId: z.string().max(512, 'oauthClientId is too long').nullable().optional(),
    /** Write-only. Reads expose `hasOauthClientSecret` instead. */
    oauthClientSecret: z.string().max(2048, 'oauthClientSecret is too long').nullable().optional(),
  })
  .strict()
export type V2CreateMcpServerBody = z.input<typeof v2CreateMcpServerBodySchema>

/**
 * Update body. Every configuration field is optional; `workspaceId` stays
 * required so the request is tenant-scoped before the server id is resolved.
 */
export const v2UpdateMcpServerBodySchema = v2CreateMcpServerBodySchema
  .partial()
  .extend({ workspaceId: workspaceIdSchema })
  .strict()
export type V2UpdateMcpServerBody = z.input<typeof v2UpdateMcpServerBodySchema>

/**
 * MCP server list. The per-workspace set is small and bounded, so the full set
 * is returned as a single page (`nextCursor` is always `null`); the canonical
 * cursor envelope keeps the v2 list surface uniform.
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
  body: v2CreateMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2McpServerDataSchema),
  },
})

export const v2GetMcpServerContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/mcp-servers/[id]',
  params: v2McpServerParamsSchema,
  query: v2McpServerWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2McpServerDataSchema),
  },
})

export const v2UpdateMcpServerContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/mcp-servers/[id]',
  params: v2McpServerParamsSchema,
  body: v2UpdateMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2McpServerDataSchema),
  },
})

export const v2DeleteMcpServerContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/mcp-servers/[id]',
  params: v2McpServerParamsSchema,
  query: v2McpServerWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2McpServerDeleteDataSchema),
  },
})
