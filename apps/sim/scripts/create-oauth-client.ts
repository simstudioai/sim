#!/usr/bin/env bun

/**
 * Registers an OAuth client with Sim's authorization server by writing the
 * `oauth_client` row directly, the way `register-sso-provider.ts` registers
 * an SSO provider. Better Auth's own `adminCreateOAuthClient` endpoint needs a
 * signed-in session, and dynamic registration is deliberately switched off,
 * so an operator creates clients here.
 *
 * Usage: bun run apps/sim/scripts/create-oauth-client.ts
 *
 * Required environment variables:
 *   DATABASE_URL
 *   BETTER_AUTH_SECRET              The deployment's auth secret; the stored secret is encrypted under it
 *   OAUTH_CLIENT_ID=my-app            Stable identifier the app sends as client_id
 *   OAUTH_CLIENT_NAME="My App"        Shown on the consent page
 *   OAUTH_REDIRECT_URIS=https://my-app.example/callback,https://…   Comma-separated. Exact match, except a loopback-IP URI, which matches any port (RFC 8252 §7.3) — register it without one
 *
 * Optional:
 *   OAUTH_CLIENT_PUBLIC=true          A native/CLI app that cannot keep a secret (PKCE only, no secret issued)
 *   OAUTH_CLIENT_URI=https://…        Homepage stored in the client's metadata
 *   OAUTH_CLIENT_LOGO_URI=https://…   Logo stored in the client's metadata
 *
 * Required for least privilege:
 *   OAUTH_SCOPES=api:read             Comma-separated scopes the client may request
 *
 * A confidential client's secret is generated here, encrypted the way the
 * provider stores it, and printed exactly once.
 *
 * Better Auth requires reversibly encrypted client secrets whenever its JWT
 * plugin is disabled. `symmetricEncrypt` under `BETTER_AUTH_SECRET` matches
 * the provider's own client creation path, so token-endpoint authentication
 * can read and compare the secret.
 */

import { randomBytes } from 'node:crypto'
import { oauthClient } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { symmetricEncrypt } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { OAUTH_SCOPES } from '@/lib/auth/oauth-provider'

/**
 * Read from the provider's own list rather than copied, and every requested
 * scope is checked against it: the authorize endpoint validates against the
 * client's row, so a scope the provider never declared would be granted and
 * then mean nothing to any check that reads it.
 */
const DEFAULT_SCOPES: readonly string[] = OAUTH_SCOPES

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function parseList(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : fallback
}

export function parseOptionalBoolean(name: string, input: string | undefined): boolean {
  const value = input?.trim().toLowerCase()
  if (!value) return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

export function assertTerminalSafe(name: string, value: string): void {
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`${name} cannot contain control characters`)
  }
}

export function assertRedirectUri(uri: string): void {
  assertTerminalSafe('Redirect URI', uri)
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error(`Invalid redirect URI: ${uri}`)
  }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error(`Redirect URI must be https, or http on a loopback address: ${uri}`)
  }
  if (parsed.hash) throw new Error(`Redirect URI cannot carry a fragment: ${uri}`)
}

export async function main(): Promise<void> {
  const clientId = requireEnv('OAUTH_CLIENT_ID')
  const name = requireEnv('OAUTH_CLIENT_NAME')
  assertTerminalSafe('OAUTH_CLIENT_ID', clientId)
  assertTerminalSafe('OAUTH_CLIENT_NAME', name)
  const redirectUris = parseList(process.env.OAUTH_REDIRECT_URIS, [])
  if (redirectUris.length === 0) throw new Error('OAUTH_REDIRECT_URIS is required')
  for (const uri of redirectUris) assertRedirectUri(uri)

  const isPublic = parseOptionalBoolean('OAUTH_CLIENT_PUBLIC', process.env.OAUTH_CLIENT_PUBLIC)
  const scopes = parseList(process.env.OAUTH_SCOPES, [])
  if (scopes.length === 0) throw new Error('OAUTH_SCOPES is required')
  for (const scope of scopes) assertTerminalSafe('OAuth scope', scope)
  const unknownScopes = scopes.filter((scope) => !DEFAULT_SCOPES.includes(scope))
  if (unknownScopes.length > 0) {
    throw new Error(
      `Unknown scope(s): ${unknownScopes.join(', ')}. Sim's provider declares: ${DEFAULT_SCOPES.join(', ')}`
    )
  }
  const secret = isPublic ? null : randomBytes(32).toString('base64url')
  const storedSecret = secret
    ? await symmetricEncrypt({ key: requireEnv('BETTER_AUTH_SECRET'), data: secret })
    : null

  const postgresClient = postgres(requireEnv('DATABASE_URL'), {
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 30,
    max: 2,
    onnotice: () => {},
  })
  const db = drizzle(postgresClient)

  try {
    const [existing] = await db
      .select({ id: oauthClient.id })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1)
    if (existing) {
      throw new Error(
        `An OAuth client with client_id "${clientId}" already exists. Delete it first, or choose another id.`
      )
    }

    const now = new Date()
    const tokenEndpointAuthMethod = isPublic ? 'none' : 'client_secret_basic'
    const clientUri = process.env.OAUTH_CLIENT_URI?.trim() || null
    const logoUri = process.env.OAUTH_CLIENT_LOGO_URI?.trim() || null
    if (clientUri) assertTerminalSafe('OAUTH_CLIENT_URI', clientUri)
    if (logoUri) assertTerminalSafe('OAUTH_CLIENT_LOGO_URI', logoUri)

    await db.insert(oauthClient).values({
      id: generateId(),
      clientId,
      clientSecret: storedSecret,
      name,
      uri: clientUri,
      icon: logoUri,
      disabled: false,
      skipConsent: false,
      public: isPublic,
      type: isPublic ? 'native' : 'web',
      tokenEndpointAuthMethod,
      requirePKCE: true,
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      redirectUris,
      scopes,
      createdAt: now,
      updatedAt: now,
    })

    const output = [
      `Created OAuth client "${name}"`,
      `  client_id:     ${clientId}`,
      `  type:          ${isPublic ? 'public (PKCE only)' : 'confidential'}`,
      `  token_auth:    ${tokenEndpointAuthMethod}`,
      `  redirect_uris: ${redirectUris.join(', ')}`,
      `  scopes:        ${scopes.join(' ')}`,
    ]
    if (secret) {
      output.push(
        `  client_secret: ${secret}`,
        '  The secret is shown once and cannot be read back; keep it now.'
      )
    }
    process.stdout.write(`${output.join('\n')}\n`)
  } finally {
    await postgresClient.end()
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`Failed to create OAuth client: ${getErrorMessage(error)}\n`)
    process.exit(1)
  })
}
