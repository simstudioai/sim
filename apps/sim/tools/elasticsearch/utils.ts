import type { ElasticsearchBaseParams } from '@/tools/elasticsearch/types'

/**
 * Default port for Elastic Cloud endpoints, matching `defaultCloudPort` in
 * Beats' `libbeat/cloudid/cloudid.go`.
 */
const DEFAULT_CLOUD_PORT = '443'

/**
 * Characters that must not appear in a decoded Cloud ID component name. An `@`
 * would turn the rest of the authority into a host and send the credential
 * headers to an attacker-controlled origin; `#`, `?` and `/` truncate the
 * authority. Mirrors the `strings.IndexAny(component, "#@?/")` reject set in
 * Beats, plus two additions:
 *
 * - `\`, which the WHATWG URL parser treats as a path separator for special
 *   schemes and which therefore truncates the authority exactly as `/` does.
 * - `:`, because `extractPortFromName` has already split the component at its
 *   last colon, so a colon surviving in the *name* half means the component
 *   carried two. The all-digits port check below does not catch that when the
 *   trailing half is numeric: `found.io:9243:5` yields name `found.io:9243`
 *   and port `5`, which assembles `https://<uuid>.found.io:9243:5` and fails
 *   as a bare `TypeError: Invalid URL` inside the transport. A hostname cannot
 *   contain a colon, so rejecting it here cannot refuse a legitimate ID.
 */
const CLOUD_ID_REJECTED_CHARACTERS = /[#@?/\\:]/

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

  for (const port of [parentDomain.port, elasticsearch.port]) {
    if (!/^\d+$/.test(port)) {
      throw new Error('Invalid Cloud ID format')
    }
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
 * fall back to `host`: the block hides `host` when cloud is selected but keeps
 * its previous value in saved state, so a fallback sends the cloud credential
 * to whatever cluster the user was pointed at before they switched.
 *
 * An unrecognized deployment type is rejected rather than treated as
 * self-hosted, because that fallthrough is the same disclosure by another
 * route. `deploymentType` is `required: true` with no explicit `visibility`,
 * which `tools/params.ts` resolves to `user-or-llm`, so a model supplies it on
 * the agent tool-calling path; a near miss such as `Cloud` is not `=== 'cloud'`
 * and would otherwise select the self-hosted branch. Only a nullish value still
 * means self-hosted — that is the dropdown's own default (`value: () =>
 * 'self_hosted'`) and the shape of state saved before the field was touched.
 */
export function buildBaseUrl(params: ElasticsearchBaseParams): string {
  if (params.deploymentType === 'cloud') {
    if (!params.cloudId) {
      throw new Error('Cloud ID is required for cloud deployments')
    }
    return parseCloudId(params.cloudId)
  }

  if (params.deploymentType != null && params.deploymentType !== 'self_hosted') {
    throw new Error(
      `Unsupported deployment type "${params.deploymentType}". Expected "self_hosted" or "cloud".`
    )
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
