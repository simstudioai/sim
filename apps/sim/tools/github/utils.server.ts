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
 *
 * The redirect policy is explicit because omitting it leaves the workspace's GitHub
 * token on the request across a cross-origin hop — the transport only strips
 * credentials when a policy is present. `standard` also refuses to replay the POST
 * a 301/302 downgrades, which is the same non-idempotency reasoning as the missing
 * retry loop above. `stripAuthOnRedirect` is deliberately NOT set: it drops the
 * token on every hop, and GitHub redirects same-origin for legitimate reasons (a
 * renamed repository answers 301 within api.github.com), so an unauthenticated
 * replay there would turn a working call into a 401.
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
    redirectPolicy: { mode: 'standard', sendCredentialsOnCrossOriginRedirect: false },
    signal: options.signal,
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.toRecord(),
  })
}
