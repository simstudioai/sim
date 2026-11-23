import { z } from 'zod'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse, v2TimestampSchema } from '@/lib/api/contracts/v2/shared'

export const v2ApiKeyTypeSchema = z
  .enum(['personal', 'workspace', 'oauth_access_token'])
  .describe(
    'Calling credential kind: a personal API key acting for its owner, a key bound to one workspace, or an OAuth access token acting for its user within granted scopes. Resource permissions and credential policies still apply.'
  )
export type V2ApiKeyType = z.output<typeof v2ApiKeyTypeSchema>

/** Facts about the calling credential itself. Nothing here is workspace data. */
export const v2MetaSchema = z
  .object({
    v2Enabled: z
      .boolean()
      .describe('Whether this API version is available. This is true when the endpoint is served.'),
    keyType: v2ApiKeyTypeSchema,
    expiresAt: v2TimestampSchema
      .nullable()
      .describe(
        'ISO 8601 timestamp when the calling credential expires, or null when it does not.'
      ),
    scopes: z
      .array(z.enum(['api:read', 'api:write', 'search:read']))
      .describe(
        'API scopes the calling credential can use. api:write implies api:read, and either implies search:read. A read-only API key holds api:read and search:read: it is refused every operation that changes state and every operation that declares no API scope, so api:read alone does not authorize those. A full-access key holds all three; an OAuth access token holds what it was granted and what that implies.'
      ),
    keyId: z
      .string()
      .nullable()
      .describe('ID of the calling API key, or null for an OAuth access token.'),
    userId: z
      .string()
      .nullable()
      .describe(
        'ID of the user the credential acts for, or null for a workspace API key, which acts as its workspace rather than as a user.'
      ),
    workspaceId: z
      .string()
      .nullable()
      .describe(
        'The only workspace a workspace API key can reach, or null for personal API keys and OAuth access tokens, which reach every workspace their user can.'
      ),
    links: z
      .object({
        openapi: z.string().describe('URL of the OpenAPI document for this API.'),
        docs: z.string().describe('URL of the API reference documentation.'),
        mcp: z.string().describe('URL of the Sim MCP server.'),
      })
      .describe('Where to find the API description, its documentation, and the Sim MCP server.'),
  })
  .meta({
    id: 'V2Meta',
    title: 'API status',
    description: 'Identity, API availability, and lifecycle facts about the calling credential.',
  })
export type V2Meta = z.output<typeof v2MetaSchema>

export const v2GetMetaContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/meta',
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2MetaSchema),
  },
})
