/**
 * Default base URL for the managed fastCRW cloud.
 *
 * fastCRW is Firecrawl-compatible and can also be self-hosted (single Rust
 * binary). Pass a `baseUrl` to point a tool at a self-hosted server
 * (e.g., "http://localhost:3000"); otherwise the managed cloud is used.
 */
export const DEFAULT_CRW_BASE_URL = 'https://fastcrw.com/api'

/**
 * Resolve the fastCRW base URL, falling back to the managed cloud and stripping
 * any trailing slash so endpoint paths can be appended cleanly.
 */
export function resolveCrwBaseUrl(baseUrl?: string): string {
  const url = baseUrl?.trim() || DEFAULT_CRW_BASE_URL
  return url.replace(/\/+$/, '')
}
