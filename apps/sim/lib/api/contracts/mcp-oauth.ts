import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const mcpOauthMetadataQuerySchema = z.record(z.string(), z.string())
export type McpOauthMetadataQuery = z.input<typeof mcpOauthMetadataQuerySchema>

const xSimAuthSchema = z.object({
  type: z.literal('api_key'),
  header: z.string(),
})

const mcpAuthorizationServerMetadataSchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  registration_endpoint: z.string(),
  jwks_uri: z.string(),
  token_endpoint_auth_methods_supported: z.array(z.string()),
  grant_types_supported: z.array(z.string()),
  response_types_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
  scopes_supported: z.array(z.string()),
  resource: z.string(),
  x_sim_auth: xSimAuthSchema,
})
export type McpAuthorizationServerMetadata = z.output<typeof mcpAuthorizationServerMetadataSchema>

const mcpProtectedResourceMetadataSchema = z.object({
  resource: z.string(),
  authorization_servers: z.array(z.string()),
  bearer_methods_supported: z.array(z.string()),
  scopes_supported: z.array(z.string()),
  x_sim_auth: xSimAuthSchema,
})
export type McpProtectedResourceMetadata = z.output<typeof mcpProtectedResourceMetadataSchema>

export const mcpOauthAuthorizationServerMetadataContract = defineRouteContract({
  method: 'GET',
  path: '/api/mcp/copilot/.well-known/oauth-authorization-server',
  query: mcpOauthMetadataQuerySchema,
  response: {
    mode: 'json',
    schema: mcpAuthorizationServerMetadataSchema,
  },
})

export const mcpOauthProtectedResourceMetadataContract = defineRouteContract({
  method: 'GET',
  path: '/api/mcp/copilot/.well-known/oauth-protected-resource',
  query: mcpOauthMetadataQuerySchema,
  response: {
    mode: 'json',
    schema: mcpProtectedResourceMetadataSchema,
  },
})
