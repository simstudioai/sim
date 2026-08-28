import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'

/**
 * Response ceiling for a GitHub request issued outside the tool transport. Matches
 * the transport's own `MAX_TOOL_RESPONSE_BODY_BYTES`, so a tool moved onto this
 * helper keeps the exact body limit it had before.
 */
export const GITHUB_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

export interface SecureGitHubRequestOptions {
  method?: string
  headers: Record<string, string>
  body?: string
  maxResponseBytes?: number
  signal?: AbortSignal
}

/**
 * Executes one DNS-validated, IP-pinned GitHub request for a tool that cannot use
 * the declarative transport — a multi-phase tool running under `directExecution`.
 *
 * This deliberately carries no retry loop: the tools on this path declare no
 * `request.retry`, so the transport retries them zero times today, and the second
 * phase of a comment flow is a non-idempotent POST that must not be replayed.
 */
export async function secureGitHubRequest(
  url: string,
  options: SecureGitHubRequestOptions
): Promise<Response> {
  const validation = await validateUrlWithDNS(url, 'githubUrl')
  if (!validation.isValid || !validation.resolvedIP) {
    throw new Error(`Invalid GitHub URL: ${validation.error ?? 'DNS resolution failed'}`)
  }

  const response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
    maxResponseBytes: options.maxResponseBytes ?? GITHUB_MAX_RESPONSE_BYTES,
    signal: options.signal,
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.toRecord(),
  })
}
