import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  narrowRegistrationOAuthScopes,
  OAUTH_PUBLIC_REGISTRATION_SCOPES,
} from '@/lib/auth/oauth-provider'

/** Reviewed native callbacks; never accept arbitrary executable or custom URI schemes. */
const NATIVE_MCP_CALLBACKS = new Set(['cursor://anysphere.cursor-mcp/oauth/callback'])

const redirectUriSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      return (
        value === value.trim() &&
        !/[\s*]/.test(value) &&
        !url.username &&
        !url.password &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && loopback) ||
          NATIVE_MCP_CALLBACKS.has(value))
      )
    } catch {
      return false
    }
  }, 'Redirect URIs must use HTTPS, loopback HTTP, or a supported native app callback, without wildcards or fragments')

export const registerOAuthClientBodySchema = z.object({
  client_name: z.string().trim().min(1).max(128).default('MCP client'),
  redirect_uris: z.array(redirectUriSchema).min(1).max(10),
  /** Better Auth negotiates unauthenticated registration to public clients without secrets. */
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_basic', 'client_secret_post'])
    .default('none'),
  grant_types: z
    .array(z.enum(['authorization_code', 'refresh_token']))
    .min(1)
    .max(2)
    .refine(
      (grants) => grants.includes('authorization_code'),
      'Authorization code grant is required'
    )
    .default(['authorization_code', 'refresh_token']),
  response_types: z.array(z.literal('code')).length(1).default(['code']),
  scope: z
    .string()
    .max(128)
    .default(OAUTH_PUBLIC_REGISTRATION_SCOPES.join(' '))
    .transform((scope, context) => {
      const granted = narrowRegistrationOAuthScopes(scope)
      if (granted !== null) return granted
      context.addIssue({
        code: 'custom',
        message: 'Only Sim MCP access can be registered automatically',
      })
      return z.NEVER
    }),
})

export const registerOAuthClientResponseSchema = z.object({
  client_id: z.string().min(1).max(255),
  client_name: z.string().min(1).max(128),
  redirect_uris: z.array(redirectUriSchema).min(1).max(10),
  token_endpoint_auth_method: z.literal('none'),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])),
  response_types: z.array(z.literal('code')),
  scope: z.string().max(128),
  client_id_issued_at: z.number().int().nonnegative(),
})

/**
 * Public RFC 7591 registration for MCP clients. A registered client holds no
 * access by itself: every grant is narrowed to its MCP resource and consented to.
 */
export const registerOAuthClientContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/oauth2/register',
  body: registerOAuthClientBodySchema,
  response: { mode: 'json', schema: registerOAuthClientResponseSchema },
})

export type RegisterOAuthClientBody = z.input<typeof registerOAuthClientBodySchema>
export type RegisterOAuthClientResponse = z.output<typeof registerOAuthClientResponseSchema>
