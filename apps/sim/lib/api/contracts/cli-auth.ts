import { z } from 'zod'
import { apiKeyAccessSchema } from '@/lib/api/contracts/api-keys'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
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

/**
 * Which key space the exchange mints from.
 *
 * `copilot` — a Sim Agent key, for the conversational surface.
 * `platform` — a Sim API key (`x-api-key`), the credential the public `/api/v1`
 * and `/api/v2` endpoints accept. These are separate key spaces: a copilot key
 * does not authenticate a platform request, or vice versa.
 *
 * Defaulted to `copilot` so terminals built against the original exchange keep
 * working without sending the field.
 */
export const cliAuthScopeSchema = z.enum(['copilot', 'platform']).default('copilot')
export type CliAuthScope = z.output<typeof cliAuthScopeSchema>

/**
 * Bounds on a minted platform key's lifetime, in whole days. The same window
 * every other key-creation surface allows: one day to one year.
 */
export const CLI_AUTH_MIN_EXPIRY_DAYS = 1
export const CLI_AUTH_MAX_EXPIRY_DAYS = 365

const cliAuthExpiresInDaysSchema = z
  .number()
  .int('expiresInDays must be a whole number of days')
  .min(CLI_AUTH_MIN_EXPIRY_DAYS, `expiresInDays must be at least ${CLI_AUTH_MIN_EXPIRY_DAYS}`)
  .max(CLI_AUTH_MAX_EXPIRY_DAYS, `expiresInDays cannot exceed ${CLI_AUTH_MAX_EXPIRY_DAYS}`)

export const approveCliAuthBodySchema = z.object({
  request: base64Url43('request must be a base64url request id'),
  challenge: base64Url43('challenge must be a base64url-encoded SHA-256 digest'),
  scope: cliAuthScopeSchema,
  /**
   * Platform scope only: the workspace the user picked in the browser. Returned
   * to the terminal so it can store it as the profile's default — the user chose
   * it by name, and asking them to go find its id afterwards would be absurd.
   *
   * Recorded whether or not the key ends up bound to it; see
   * {@link bindKeyToWorkspace}.
   */
  workspaceId: workspaceIdSchema.optional(),
  /**
   * Mint a key scoped to {@link workspaceId} rather than a personal key. Only a
   * workspace admin may ask for this, and the approve route rejects anything
   * less rather than silently downgrading — the browser has already told the
   * user which kind of key they are about to get, so a mismatch here means the
   * request did not come from that UI.
   */
  bindKeyToWorkspace: z.boolean().optional().default(false),
  /**
   * Platform scope only: the access the key is minted with. The terminal asks
   * for it in the browser URL and the approval page shows it before the user
   * approves; recording it here, rather than reading it at poll time, is what
   * keeps the unauthenticated poll from widening it.
   */
  access: apiKeyAccessSchema.optional().default('write'),
  /** Platform scope only: days until the minted key expires. Absent means it never expires. */
  expiresInDays: cliAuthExpiresInDaysSchema.optional(),
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
        key: z.object({
          id: z.string(),
          apiKey: z.string(),
          /** The name the key is listed under in Settings → API keys. */
          name: z.string(),
        }),
        /**
         * Echoes what the approving user actually consented to. The CLI asked
         * for a scope in the browser URL, but the approval is what binds it —
         * a client that assumed its own request was honored could file a
         * copilot key under a platform profile and fail every later call with
         * an opaque 401.
         */
        scope: z.enum(['copilot', 'platform']),
        /**
         * The workspace the user picked, for the terminal to store as its
         * default. Present for a personal key too — the choice is about which
         * workspace the profile targets, not about what the key can reach.
         */
        workspaceId: z.string().nullable(),
        /**
         * Whether the key itself is scoped to {@link workspaceId}. A bound key
         * can reach nothing else, so the terminal must not offer to point the
         * profile somewhere the credential cannot follow.
         */
        workspaceBound: z.boolean(),
        /**
         * Platform scope only: the access the key was minted with, as approved.
         * A terminal that asked for read-only must check this rather than
         * assume it — a server that predates the field mints full access.
         */
        access: apiKeyAccessSchema.optional(),
        /** Platform scope only: when the key expires, or null when it never does. */
        expiresAt: z.string().nullable().optional(),
      }),
    ]),
  },
})
export type PollCliAuthResult = z.output<(typeof pollCliAuthContract)['response']['schema']>
