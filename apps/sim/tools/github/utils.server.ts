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
 * GitHub's API rejects a request without a User-Agent with 403 "Request forbidden by
 * administrative rules". The declarative transport sets `User-Agent: Sim` for every
 * tool it formats; a tool on this helper bypasses that, and the guarded fetch builds
 * its request with raw `node:https`, which adds no default. Bun's `node:http` shim
 * does inject its own `Bun/x.y.z`, so the call happens to work in production today —
 * but that silently replaces Sim's attribution and does not hold under Node.
 *
 * Set here rather than in each caller's header map so every future tool on this
 * helper inherits it. A caller that supplies its own User-Agent, in any casing, wins.
 */
function withUserAgent(headers: Record<string, string>): Record<string, string> {
  const hasUserAgent = Object.keys(headers).some((name) => name.toLowerCase() === 'user-agent')
  return hasUserAgent ? headers : { ...headers, 'User-Agent': 'Sim' }
}

/**
 * Executes one DNS-validated, IP-pinned GitHub request for a registered operation
 * whose provider interaction spans multiple requests.
 *
 * This deliberately carries no retry loop: the tools on this path declare no
 * `request.retry`, so the transport retries them zero times today, and the second
 * phase of a comment flow is a non-idempotent POST that must not be replayed.
 *
 * The redirect policy is explicit because omitting it leaves the workspace's GitHub
 * token on the request across a cross-origin hop — the transport only strips
 * credentials when a policy is present. `legacy` is chosen over `standard` for the
 * method rules: `standard` rewrites a redirected POST to a bodyless GET on 301/302
 * regardless of origin, and GitHub answers 301 within api.github.com for a renamed
 * repository, so a comment POST there would be replayed as a GET of the comment
 * list — a JSON array that fails the tool's payload shape check and reports success
 * with no comment created. `legacy` keeps the method and body across that hop.
 *
 * Credential stripping is unaffected by the mode: the guarded follower strips
 * Authorization, Proxy-Authorization and Cookie on a cross-origin hop whenever
 * `sendCredentialsOnCrossOriginRedirect` is false, in either mode.
 *
 * `stripAuthOnRedirect` is deliberately NOT set: it drops the token on every hop,
 * including the legitimate same-origin renamed-repository 301, so an unauthenticated
 * replay there would turn a working call into a 401.
 */
export async function secureGitHubRequest(
  url: string,
  options: SecureGitHubRequestOptions
): Promise<Response> {
  const validation = await validateUrlWithDNS(url, 'githubUrl', 'configuredEndpoint')
  if (!validation.isValid) {
    throw new Error(`Invalid GitHub URL: ${validation.error ?? 'DNS resolution failed'}`)
  }

  const response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
    profile: 'configuredEndpoint',
    method: options.method ?? 'GET',
    headers: withUserAgent(options.headers),
    body: options.body,
    maxResponseBytes: options.maxResponseBytes ?? GITHUB_MAX_RESPONSE_BYTES,
    redirectPolicy: { mode: 'legacy', sendCredentialsOnCrossOriginRedirect: false },
    signal: options.signal,
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.toRecord(),
  })
}
