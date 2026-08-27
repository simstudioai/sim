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
