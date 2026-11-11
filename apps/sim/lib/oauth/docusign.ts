import { env } from '@/lib/core/config/env'

/**
 * DocuSign developer/demo and production are separate account systems with
 * separate authentication services, so a token issued by one is not accepted by
 * the other. Going live means switching hosts: "The authentication service host
 * name needs to be changed from https://account-d.docusign.com to
 * https://account.docusign.com in your app's OAuth configuration"
 * (docusign.com/blog/developers — configuring your production account).
 *
 * Default kept on demo so existing installations keep their current behavior.
 */
const DOCUSIGN_DEMO_AUTH_HOST = 'account-d.docusign.com'
const DOCUSIGN_PRODUCTION_AUTH_HOST = 'account.docusign.com'

/**
 * Resolves the DocuSign OAuth host from `DOCUSIGN_AUTH_HOST`. Accepts a bare host
 * or a full origin; anything that is not one of the two DocuSign authentication
 * hosts falls back to the demo host, so a typo can never redirect the OAuth flow
 * (and the bearer token that follows) to an attacker-controlled origin.
 */
function getDocusignAuthHost(): string {
  const configured = env.DOCUSIGN_AUTH_HOST?.trim()
  if (!configured) return DOCUSIGN_DEMO_AUTH_HOST
  const host = configured
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
  return host === DOCUSIGN_PRODUCTION_AUTH_HOST || host === DOCUSIGN_DEMO_AUTH_HOST
    ? host
    : DOCUSIGN_DEMO_AUTH_HOST
}

/** Absolute DocuSign OAuth endpoint (e.g. `/oauth/token`) on the configured host. */
export function getDocusignOAuthUrl(path: string): string {
  return `https://${getDocusignAuthHost()}${path}`
}

/**
 * DocuSign web-app base for envelope deep links, kept in lockstep with
 * {@link getDocusignAuthHost}: demo envelopes only exist in `appdemo.docusign.com`.
 */
export function getDocusignWebBase(): string {
  return getDocusignAuthHost() === DOCUSIGN_PRODUCTION_AUTH_HOST
    ? 'https://app.docusign.com'
    : 'https://appdemo.docusign.com'
}

/**
 * The eSignature REST base a JWT Grant credential is bound to
 * (`https://{host}.docusign.net/restapi/v2.1/accounts/{accountId}`), resolved
 * by the minter from the credential's own environment.
 */
const DOCUSIGN_ACCOUNT_API_BASE_REGEX =
  /^(https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.docusign\.net)\/restapi\/v2\.1\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

export interface DocuSignBoundAccount {
  /** eSignature host origin, e.g. `https://na3.docusign.net`. */
  baseUri: string
  accountId: string
  /** Web app origin for envelope links in the same environment as {@link baseUri}. */
  webBase: string
}

/**
 * Parses a credential-bound account base, or `undefined` when the value is not
 * exactly that shape, so a value that did not come from the minter is never
 * sent a token.
 */
export function parseDocuSignAccountApiBase(value: unknown): DocuSignBoundAccount | undefined {
  if (typeof value !== 'string') return undefined
  const match = DOCUSIGN_ACCOUNT_API_BASE_REGEX.exec(value)
  if (!match) return undefined
  return {
    baseUri: match[1],
    accountId: match[3],
    webBase: match[2] === 'demo' ? 'https://appdemo.docusign.com' : 'https://app.docusign.com',
  }
}
