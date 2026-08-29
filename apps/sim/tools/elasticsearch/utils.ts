import type { ElasticsearchBaseParams } from '@/tools/elasticsearch/types'

/**
 * Default port for Elastic Cloud endpoints, matching `defaultCloudPort` in
 * Beats' `libbeat/cloudid/cloudid.go`.
 */
const DEFAULT_CLOUD_PORT = '443'

/**
 * Characters that must not appear in a decoded Cloud ID component. An `@` would
 * turn the rest of the authority into a host and send the credential headers to
 * an attacker-controlled origin; `#`, `?` and `/` truncate the authority.
 * Mirrors the `strings.IndexAny(component, "#@?/")` reject set in Beats, plus
 * `\`, which the WHATWG URL parser treats as a path separator for special
 * schemes and which therefore truncates the authority exactly as `/` does.
 */
const CLOUD_ID_REJECTED_CHARACTERS = /[#@?/\\]/

/**
 * Splits a Cloud ID component of the form `name:port` at its last colon.
 * Mirrors `extractPortFromName` in Beats' `libbeat/cloudid/cloudid.go`.
 */
function extractPortFromName(word: string, defaultPort: string): { name: string; port: string } {
  const index = word.lastIndexOf(':')
  if (index < 0) return { name: word, port: defaultPort }
  return { name: word.slice(0, index), port: word.slice(index + 1) }
}

/**
 * Decodes an Elastic Cloud ID into the Elasticsearch endpoint it addresses.
 *
 * A Cloud ID is `<deployment label>:<base64 of parentDomain$esUuid$kibanaUuid>`.
 * The reachable host is `<esUuid>.<parentDomain>` — the deployment label is a
 * human-readable name that resolves to nothing.
 *
 * @throws when the Cloud ID is malformed or contains an unsafe component.
 */
export function parseCloudId(cloudId: string): string {
  const separatorIndex = cloudId.lastIndexOf(':')
  const encoded = separatorIndex >= 0 ? cloudId.slice(separatorIndex + 1) : cloudId

  const decoded = Buffer.from(encoded, 'base64').toString('utf-8')

  const words = decoded.split('$')
  if (words.length < 3) {
    throw new Error('Invalid Cloud ID format')
  }

  const parentDomain = extractPortFromName(words[0], DEFAULT_CLOUD_PORT)
  const elasticsearch = extractPortFromName(words[1], parentDomain.port)

  if (!parentDomain.name || !elasticsearch.name) {
    throw new Error('Invalid Cloud ID format')
  }

  for (const component of [parentDomain.name, elasticsearch.name]) {
    if (CLOUD_ID_REJECTED_CHARACTERS.test(component)) {
      throw new Error('Invalid Cloud ID format')
    }
  }

  if (!/^\d+$/.test(elasticsearch.port)) {
    throw new Error('Invalid Cloud ID format')
  }

  const host = `${elasticsearch.name}.${parentDomain.name}`
  return elasticsearch.port === DEFAULT_CLOUD_PORT
    ? `https://${host}`
    : `https://${host}:${elasticsearch.port}`
}

/**
 * Resolves the Elasticsearch base URL for a tool invocation, from either an
 * Elastic Cloud ID or a self-hosted host URL.
 *
 * The deployment type alone selects the branch. A cloud invocation must never
 * fall back to `host`: switching the deployment dropdown leaves the previous
 * host in saved state, so a fallback would send the cloud credential to a
 * stale, unrelated origin.
 */
export function buildBaseUrl(params: ElasticsearchBaseParams): string {
  if (params.deploymentType === 'cloud') {
    if (!params.cloudId) {
      throw new Error('Cloud ID is required for cloud deployments')
    }
    return parseCloudId(params.cloudId)
  }

  if (!params.host) {
    throw new Error('Host is required for self-hosted deployments')
  }

  return params.host.replace(/\/$/, '')
}

/**
 * Builds the content-type and authorization headers shared by every
 * Elasticsearch tool.
 *
 * @param contentType overrides the default JSON media type. The `_bulk`
 * endpoint requires `application/x-ndjson` and answers `application/json` with
 * HTTP 406, so that tool must pass its own.
 */
export function buildAuthHeaders(
  params: ElasticsearchBaseParams,
  contentType = 'application/json'
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  }

  if (params.authMethod === 'api_key' && params.apiKey) {
    headers.Authorization = `ApiKey ${params.apiKey}`
  } else if (params.authMethod === 'basic_auth' && params.username && params.password) {
    const credentials = Buffer.from(`${params.username}:${params.password}`).toString('base64')
    headers.Authorization = `Basic ${credentials}`
  } else {
    throw new Error('Invalid authentication configuration')
  }

  return headers
}
