import { validateExternalUrl } from '@/lib/core/security/input-validation'

/**
 * Shared PostHog base URL resolution.
 *
 * PostHog exposes two host families:
 * - The "app" REST API (`/api/...`) at `us.posthog.com` / `eu.posthog.com`, authenticated
 *   with a personal API key.
 * - The "ingest" API (`/i/v0/e`, `/batch/`, `/flags/`) at `us.i.posthog.com` / `eu.i.posthog.com`,
 *   authenticated with a project API key.
 *
 * Self-hosted PostHog instances serve both families from a single custom host. That host is
 * validated with the shared SSRF guard so it can't be pointed at loopback/private/link-local
 * addresses (e.g. cloud instance-metadata endpoints); the tool executor additionally
 * re-validates with DNS resolution and pins the resolved IP for the actual request.
 */

export function getPostHogAppBaseUrl(region?: 'us' | 'eu', host?: string): string {
  if (host?.trim()) {
    return normalizeHost(host)
  }
  return region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
}

export function getPostHogIngestBaseUrl(region?: 'us' | 'eu', host?: string): string {
  if (host?.trim()) {
    return normalizeHost(host)
  }
  return region === 'eu' ? 'https://eu.i.posthog.com' : 'https://us.i.posthog.com'
}

function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '')
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const validation = validateExternalUrl(withProtocol, 'Self-hosted host')
  if (!validation.isValid) {
    throw new Error(`${validation.error} (e.g., posthog.mycompany.com)`)
  }
  return withProtocol
}
