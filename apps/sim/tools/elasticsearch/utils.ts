import type { ElasticsearchBaseParams } from '@/tools/elasticsearch/types'

/**
 * Right-partitions an optional `:<port>` suffix off one Cloud ID component.
 *
 * Mirrors `extractPortFromName` in Elastic's own decoder
 * (`beats/libbeat/cloudid/cloudid.go`), which is applied to the parent domain
 * **and** to each service UUID. A component with no `:` keeps `fallbackPort`.
 *
 * @param component - A decoded Cloud ID component, e.g. `es.io:9243` or `<uuid>:9244`.
 * @param fallbackPort - The port to use when the component carries none.
 * @returns The component with any port removed, and the resolved port.
 */
function splitCloudIdPort(component: string, fallbackPort: number): { name: string; port: number } {
  const portIndex = component.lastIndexOf(':')

  if (portIndex === -1) {
    return { name: component, port: fallbackPort }
  }

  const rawPort = component.slice(portIndex + 1)

  return {
    name: component.slice(0, portIndex),
    port: rawPort === '' ? fallbackPort : Number(rawPort),
  }
}

/**
 * Decodes an Elastic Cloud ID into the Elasticsearch origin it addresses.
 *
 * A Cloud ID is `<label>:<base64>`, where the base64 payload decodes to
 * `<parent-dn[:port]>$<es-uuid[:port]>$<kibana-uuid[:port]>`. The pre-colon
 * `<label>` is a user-chosen deployment name and is **not** part of any
 * hostname — the Elasticsearch host is `<es-uuid>.<parent-dn>`. Elastic's own
 * sample decodes to
 * `us-east-1.aws.found.io$cec6f261a74bf24ce33bb8811b84294f$c6c2ca6d…`, which
 * addresses `https://cec6f261a74bf24ce33bb8811b84294f.us-east-1.aws.found.io`.
 *
 * The parsing rules mirror `parse_cloud_id` in elastic-transport-python,
 * `CloudNodePool` in the .NET client, and `decodeCloudID` in Elastic's Go
 * implementation:
 *
 * - The label is split off at the **first** colon only (`str.partition(':')`),
 *   so a label containing a colon cannot shift the payload slice. An empty or
 *   absent label is accepted — the base64 alphabet excludes `:`, so a value
 *   with no colon is unambiguously a bare payload.
 * - **Every** component may carry its own `:<port>`, not just the parent
 *   domain. Elastic's decoder fixtures include `different-es-kb-port`, whose
 *   payload is `us-central1.gcp.cloud.es.io$<es-uuid>:9243$<kb-uuid>:9244` and
 *   which must resolve to `https://<es-uuid>.us-central1.gcp.cloud.es.io:9243`.
 *   Using the raw component as the hostname label instead produced
 *   `https://<es-uuid>:9243.us-central1.gcp.cloud.es.io`, which `fetch` rejects
 *   as an invalid URL with no actionable message.
 * - **The Elasticsearch UUID's own port wins over the parent domain's.** Go
 *   resolves this as `host, port := extract(words[0], 443)` followed by
 *   `esID, esPort := extract(words[1], port)`: the parent port is only the
 *   *default* handed to the per-service extraction, so a port on the UUID
 *   overrides it. The `host-and-kb-set` fixture pins the other direction —
 *   parent `:9243` with a bare ES UUID resolves to `:9243`.
 * - Kibana's port (`words[2]`) is read by Elastic only to build the Kibana URL
 *   and never influences the Elasticsearch origin, which the `only-kb-set`
 *   fixture pins: a `:9244` on the Kibana UUID alone still yields ES on 443.
 * - We append `:<port>` to the origin only when the resolved port differs from
 *   443, since 443 is already the default for `https:` and emitting it would
 *   only make the URL noisier.
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
  const [rawParentDn, rawEsUuid] = decoded.split('$')

  if (!rawParentDn || !rawEsUuid) {
    throw new Error(
      'Cloud ID is not properly formatted (expected "<host>$<es-uuid>$<kibana-uuid>" once decoded)'
    )
  }

  const { name: parentDn, port: parentPort } = splitCloudIdPort(rawParentDn, 443)
  const { name: esUuid, port } = splitCloudIdPort(rawEsUuid, parentPort)

  if (!parentDn || !esUuid || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Cloud ID is not properly formatted (invalid host or port)')
  }

  const origin = `https://${esUuid}.${parentDn}`
  return port === 443 ? origin : `${origin}:${port}`
}

/**
 * Builds a traversal-safe URL path segment from an Elasticsearch index target.
 *
 * This is a deliberate local variant of {@link safeUrlPathSegment} in
 * `@/tools/url-path`, which rejects any value still carrying a `/`. That
 * rejection makes Elasticsearch's documented **date-math index names**
 * unusable: the canonical example in the API-conventions doc is
 * `<logstash-{now/d}>`, and the same doc instructs clients to percent-encode
 * it (`/` becomes `%2F`). The shared helper threw on the slash, so the feature
 * could not be reached at all.
 *
 * Encoding rather than rejecting the slash is safe **here specifically**, for
 * three reasons that hold for Elasticsearch index targets and not in general:
 *
 * 1. An Elasticsearch index name cannot contain a literal `/`, so the
 *    separator rejection was protecting nothing — any `/` reaching this
 *    parameter is either date math or a traversal attempt, and encoding
 *    handles both correctly.
 * 2. `encodeURIComponent` turns `/` into `%2F`, and the WHATWG URL parser that
 *    `fetch` uses does **not** treat `%2F` as a path separator. It is unlike
 *    `%2e`, which the parser decodes and then removes as a dot segment:
 *    `new URL('https://x/a/%2F/b').pathname` keeps `/a/%2F/b`, while
 *    `new URL('https://x/a/%2e%2e/b').pathname` collapses to `/b`. So an
 *    encoded slash cannot introduce a new segment for dot-segment removal to
 *    act on, and `a/../..` survives inert as `a%2F..%2F..`.
 * 3. Elasticsearch percent-decodes each captured path segment (`PathTrie` with
 *    `RestUtils.REST_DECODER`) before splitting it on commas, which is why
 *    `%2F` and `%2C` round-trip and multi-target values like `a,b` still work.
 *
 * The real traversal hole — a value that is *exactly* `.` or `..`, which no
 * encoding neutralizes — stays closed by rejection, exactly as the shared
 * helper does. See the module note in `@/tools/url-path` for why.
 *
 * @param value - The raw index target, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed, percent-encoded segment, safe to interpolate.
 * @throws If the value is empty or is a bare dot segment.
 */
export function safeIndexPathSegment(value: string, paramName: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${paramName} cannot be "${trimmed}" (path traversal is not allowed)`)
  }

  return encodeURIComponent(trimmed)
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
 * Normalizes an Elasticsearch duration parameter, supplying the implied unit.
 *
 * Elasticsearch's time-value parser requires a unit on every duration and
 * rejects a bare number with a 400 — the only unit-less values it accepts are
 * `0` and `-1`. A caller who types "30" means 30 seconds, so a bare positive
 * number gets an `s` appended.
 *
 * This lives in the **tool**, not in the block's `tools.config.params`,
 * because `lib/copilot/tool-executor/executor.ts` calls `executeAppTool`
 * directly and never runs the block's param mapping. Normalization that lives
 * only in the block is therefore a property of one calling surface rather than
 * of the tool, and a Copilot call with `esTimeout: "30"` sent `timeout=30` raw.
 *
 * Only an all-digit value gets the unit. A previous `endsWith('s')` test
 * rewrote "1m" to "1ms" — one millisecond instead of one minute — so anything
 * already carrying a unit is passed through untouched.
 *
 * @param value - The raw duration, which may arrive as a string from a text
 * subblock or as a number from a resolved reference or a Copilot call.
 * @returns The duration with a unit, or `undefined` when unset or blank.
 */
export function normalizeEsDuration(value: unknown): string | undefined {
  const trimmed =
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''

  if (!trimmed) {
    return undefined
  }

  return /^\d+$/.test(trimmed) && trimmed !== '0' ? `${trimmed}s` : trimmed
}

/**
 * Normalizes an optional numeric parameter, distinguishing "unset" from zero.
 *
 * A truthiness gate (`if (params.size)`) silently drops `size: 0`, so
 * Elasticsearch falls back to returning 10 documents. `size: 0` is a
 * meaningful request here: it asks for the match count in `hits.total` without
 * paying to materialize any documents. (It is *not* the aggregations-only
 * idiom — these tools expose no `aggs` parameter, so no aggregation can be
 * requested at all.) Only `undefined`, `null`, and `''` mean unset here.
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
