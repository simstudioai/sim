import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Boundary shapes for the CLI key handoff.
 *
 * The browser leg carries a single-use code, never the key: `/cli/auth`
 * approves and redirects the code to the CLI's loopback listener, which
 * exchanges it here over TLS. Modeled on the OAuth authorization-code +
 * PKCE flow that `gh`, `vercel`, and `ant auth login` use.
 */

/** BASE64URL(SHA256(verifier)) — 43 chars, no padding. */
const pkceChallengeSchema = z
  .string()
  .regex(/^[A-Za-z0-9\-_]{43}$/, 'challenge must be a base64url-encoded SHA-256 digest')

export const approveCliAuthBodySchema = z.object({
  challenge: pkceChallengeSchema,
})
export type ApproveCliAuthBody = z.input<typeof approveCliAuthBodySchema>

export const approveCliAuthContract = defineRouteContract({
  method: 'POST',
  path: '/api/cli/auth/approve',
  body: approveCliAuthBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      code: z.string().min(1),
    }),
  },
})

export type ApproveCliAuthResult = z.output<(typeof approveCliAuthContract)['response']['schema']>

export const exchangeCliAuthCodeBodySchema = z.object({
  code: z.string().min(1, 'code is required').max(128, 'code is too long'),
  /**
   * The PKCE verifier the CLI generated before opening the browser. RFC 7636
   * bounds it at 43–128 characters from an unreserved alphabet.
   */
  verifier: z
    .string()
    .regex(/^[A-Za-z0-9\-._~]{43,128}$/, 'verifier must be 43-128 unreserved characters'),
})
export type ExchangeCliAuthCodeBody = z.input<typeof exchangeCliAuthCodeBodySchema>

export const exchangeCliAuthCodeContract = defineRouteContract({
  method: 'POST',
  path: '/api/cli/auth/token',
  body: exchangeCliAuthCodeBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      key: z.object({
        id: z.string(),
        apiKey: z.string(),
      }),
    }),
  },
})
