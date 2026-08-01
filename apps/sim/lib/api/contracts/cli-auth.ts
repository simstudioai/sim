import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Boundary shapes for the CLI key handoff (OAuth device-authorization style).
 *
 * The CLI generates a `request` id and a poll secret, opens `/cli/auth` with the
 * id and the secret's challenge, and polls for the key over TLS while the user
 * approves in the browser. No key ever crosses the browser leg, and there is no
 * loopback listener — the same shape `gh`, `stripe login`, and `ant auth login`
 * use for terminals that may not share a machine with the browser.
 */

/** BASE64URL, 43 chars (a 32-byte token or SHA-256 digest), no padding. */
const base64Url43 = (message: string) => z.string().regex(/^[A-Za-z0-9\-_]{43}$/, message)

export const approveCliAuthBodySchema = z.object({
  request: base64Url43('request must be a base64url request id'),
  challenge: base64Url43('challenge must be a base64url-encoded SHA-256 digest'),
})
export type ApproveCliAuthBody = z.input<typeof approveCliAuthBodySchema>

export const approveCliAuthContract = defineRouteContract({
  method: 'POST',
  path: '/api/cli/auth/approve',
  body: approveCliAuthBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ ok: z.literal(true) }),
  },
})
export type ApproveCliAuthResult = z.output<(typeof approveCliAuthContract)['response']['schema']>

export const pollCliAuthBodySchema = z.object({
  request: base64Url43('request must be a base64url request id'),
  /** The poll secret the CLI kept; its challenge was registered at approval. */
  verifier: base64Url43('verifier must be a base64url secret'),
})
export type PollCliAuthBody = z.input<typeof pollCliAuthBodySchema>

export const pollCliAuthContract = defineRouteContract({
  method: 'POST',
  path: '/api/cli/auth/poll',
  body: pollCliAuthBodySchema,
  response: {
    mode: 'json',
    schema: z.discriminatedUnion('status', [
      z.object({ status: z.literal('pending') }),
      z.object({
        status: z.literal('complete'),
        key: z.object({ id: z.string(), apiKey: z.string() }),
      }),
    ]),
  },
})
export type PollCliAuthResult = z.output<(typeof pollCliAuthContract)['response']['schema']>
