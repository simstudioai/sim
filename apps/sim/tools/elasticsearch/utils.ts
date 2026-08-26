import type { ElasticsearchBaseParams } from '@/tools/elasticsearch/types'

/**
 * Decodes an Elastic Cloud ID into the Elasticsearch origin it addresses.
 *
 * A Cloud ID is `<label>:<base64>`, where the base64 payload decodes to
 * `<parent-dn[:port]>$<es-uuid>$<kibana-uuid>`. The pre-colon `<label>` is a
 * user-chosen deployment name and is **not** part of any hostname — the
 * Elasticsearch host is `<es-uuid>.<parent-dn>`. Elastic's own sample decodes
 * to `us-east-1.aws.found.io$cec6f261a74bf24ce33bb8811b84294f$c6c2ca6d…`,
 * which addresses `https://cec6f261a74bf24ce33bb8811b84294f.us-east-1.aws.found.io`.
 *
 * The parsing rules mirror `parse_cloud_id` in elastic-transport-python (and
 * `CloudNodePool` in the .NET client):
 *
 * - The label is split off at the **first** colon only (`str.partition(':')`),
 *   so a label containing a colon cannot shift the payload slice. An empty or
 *   absent label is accepted — the base64 alphabet excludes `:`, so a value
 *   with no colon is unambiguously a bare payload.
 * - The port is right-partitioned off the parent domain
 *   (`parent_dn.rpartition(':')`), defaulting to 443. We append `:<port>` to
 *   the origin only when it differs from 443, since 443 is already the default
 *   for `https:` and emitting it would only make the URL noisier.
 *
 * There is deliberately no `try`/`catch` around the decode: `Buffer.from(x,
 * 'base64')` never throws — it silently drops characters outside the base64
 * alphabet — so a catch block here would be unreachable. Malformed input is
 * caught by validating the decoded structure instead.
 *
 * @param rawCloudId - The Cloud ID exactly as pasted from the Elastic Cloud console.
 * @returns The Elasticsearch origin, e.g. `https://<es-uuid>.<parent-dn>`.
 * @throws If the Cloud ID does not decode to a parent domain and an Elasticsearch UUID.
 */
export function parseCloudId(rawCloudId: string): string {
  const cloudId = typeof rawCloudId === 'string' ? rawCloudId.trim() : ''

  if (!cloudId) {
    throw new Error('Cloud ID is required for cloud deployments')
  }

  const separatorIndex = cloudId.indexOf(':')
  const payload = separatorIndex === -1 ? cloudId : cloudId.slice(separatorIndex + 1)

  if (!payload) {
    throw new Error('Cloud ID is not properly formatted (missing encoded payload)')
  }

  /**
   * `Buffer.from(x, 'base64')` never throws — it silently discards characters
   * outside the base64 alphabet — so the payload is checked before decoding
   * rather than after. Without this, `team:staging:<payload>` (a label that
   * itself contains a colon, which no real Cloud ID has) would decode the
   * concatenation of two unrelated slices into plausible-looking garbage.
   */
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(payload)) {
    throw new Error('Cloud ID is not properly formatted (payload is not valid base64)')
  }

  const decoded = Buffer.from(payload, 'base64').toString('utf-8')
  const [rawParentDn, esUuid] = decoded.split('$')

  if (!rawParentDn || !esUuid) {
    throw new Error(
      'Cloud ID is not properly formatted (expected "<host>$<es-uuid>$<kibana-uuid>" once decoded)'
    )
  }

  const portIndex = rawParentDn.lastIndexOf(':')
  const parentDn = portIndex === -1 ? rawParentDn : rawParentDn.slice(0, portIndex)
  const rawPort = portIndex === -1 ? '' : rawParentDn.slice(portIndex + 1)
  const port = rawPort === '' ? 443 : Number(rawPort)

  if (!parentDn || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Cloud ID is not properly formatted (invalid host or port)')
  }

  const origin = `https://${esUuid}.${parentDn}`
  return port === 443 ? origin : `${origin}:${port}`
}

/**
 * Resolves the Elasticsearch base URL for either deployment type.
 *
 * Shared by every Elasticsearch tool so the Cloud ID decoding rules live in
 * exactly one place.
 *
 * @throws If the cloud deployment has no usable Cloud ID, or the self-hosted
 * deployment has no host.
 */
export function buildBaseUrl(params: ElasticsearchBaseParams): string {
  if (params.deploymentType === 'cloud') {
    return parseCloudId(params.cloudId ?? '')
  }

  const host = typeof params.host === 'string' ? params.host.trim() : ''

  if (!host) {
    throw new Error('Host is required for self-hosted deployments')
  }

  return host.replace(/\/+$/, '')
}

/**
 * Builds the request headers, including the Elasticsearch authorization header.
 *
 * @param contentType - Overridden by `_bulk`, which requires `application/x-ndjson`.
 * @throws If neither a complete API key nor a complete basic-auth pair is configured.
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

/**
 * Normalizes an optional numeric parameter, distinguishing "unset" from zero.
 *
 * A truthiness gate (`if (params.size)`) silently drops `size: 0` — the
 * standard aggregations-only idiom — so Elasticsearch falls back to returning
 * 10 documents. Only `undefined`, `null`, and `''` mean unset here.
 *
 * @param value - The raw parameter, which may arrive as a string from a text
 * subblock or as a real number from a resolved block reference or Copilot.
 * @param paramName - Names the offender in the error message.
 * @returns The number, or `undefined` when the parameter is unset.
 * @throws If the value is present but does not parse to a finite number,
 * rather than sending `NaN` to Elasticsearch.
 */
export function optionalNumber(value: unknown, paramName: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).trim())

  if (!Number.isFinite(parsed)) {
    throw new Error(`${paramName} must be a number, received "${String(value)}"`)
  }

  return parsed
}
