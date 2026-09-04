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
 *   OAUTH_CLIENT_URI=https://…        Homepage link on the consent page
 *   OAUTH_CLIENT_LOGO_URI=https://…   Logo on the consent page
 *   OAUTH_SCOPES=openid,profile,email,offline_access,api:read,api:write   Scopes the client may request
 *
 * A confidential client's secret is generated here, encrypted the way the
 * provider stores it, and printed exactly once.
 *
 * Encrypted rather than hashed because the provider issues opaque access
 * tokens (`disableJwtPlugin`), which leaves the client secret as the key an ID
 * token is signed with — so the server has to read it back. `symmetricEncrypt`
 * under `BETTER_AUTH_SECRET` is exactly what the plugin's own client creation
 * does; writing a hash here produced a row no client could ever authenticate
 * against.
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

function parseList(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : fallback
}

function assertRedirectUri(uri: string): void {
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

async function main(): Promise<void> {
  const clientId = requireEnv('OAUTH_CLIENT_ID')
  const name = requireEnv('OAUTH_CLIENT_NAME')
  const redirectUris = parseList(process.env.OAUTH_REDIRECT_URIS, [])
  if (redirectUris.length === 0) throw new Error('OAUTH_REDIRECT_URIS is required')
  for (const uri of redirectUris) assertRedirectUri(uri)

  const isPublic = process.env.OAUTH_CLIENT_PUBLIC === 'true'
  const scopes = parseList(process.env.OAUTH_SCOPES, [...DEFAULT_SCOPES])
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
    await db.insert(oauthClient).values({
      id: generateId(),
      clientId,
      clientSecret: storedSecret,
      name,
      uri: process.env.OAUTH_CLIENT_URI?.trim() || null,
      icon: process.env.OAUTH_CLIENT_LOGO_URI?.trim() || null,
      disabled: false,
      skipConsent: false,
      public: isPublic,
      type: isPublic ? 'native' : 'web',
      tokenEndpointAuthMethod: isPublic ? 'none' : 'client_secret_post',
      requirePKCE: true,
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      redirectUris,
      scopes,
      createdAt: now,
      updatedAt: now,
    })

    console.log(`Created OAuth client "${name}"`)
    console.log(`  client_id:     ${clientId}`)
    console.log(`  type:          ${isPublic ? 'public (PKCE only)' : 'confidential'}`)
    console.log(`  redirect_uris: ${redirectUris.join(', ')}`)
    console.log(`  scopes:        ${scopes.join(' ')}`)
    if (secret) {
      console.log(`  client_secret: ${secret}`)
      console.log('  The secret is shown once and cannot be read back; keep it now.')
    }
  } finally {
    await postgresClient.end()
  }
}

main().catch((error) => {
  console.error(`Failed to create OAuth client: ${getErrorMessage(error)}`)
  process.exit(1)
})
