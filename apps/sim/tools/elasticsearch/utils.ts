import type { ElasticsearchBaseParams } from '@/tools/elasticsearch/types'

/**
 * Right-partitions an optional `:<port>` suffix off one Cloud ID component.
 *
 * Mirrors `extractPortFromName` in Beats' decoder
 * (`beats/libbeat/cloudid/cloudid.go`), which right-partitions at the last
 * colon and is applied to the parent domain **and** to each service UUID. A
 * component with no `:` keeps `fallbackPort`. (The .NET client resolves the
 * same per-service ports but partitions at the *first* colon; the `:` entry in
 * {@link CLOUD_ID_FORBIDDEN_CHARS} makes a two-colon component unreachable, so
 * the two rules cannot disagree here. elastic-transport-python has no
 * per-service port handling at all.)
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
 * Characters that must never appear in a decoded Cloud ID component.
 *
 * `#@?/` is **Beats'** reject set — `strings.IndexAny(component, "#@?/")` in
 * `decodeCloudID` (`beats/libbeat/cloudid/cloudid.go`), applied to the parent
 * domain and each service UUID, with the `inject-es`, `inject-host`, and
 * `inject-kb` fixtures pinning it. It is not a rule shared across the clients:
 * `parse_cloud_id` in elastic-transport-python and `CloudNodePool` in the .NET
 * client perform **no** character validation on decoded components at all, and
 * even Beats only added the check on some branches. We take the strictest
 * behavior of the three because each rejected character lets a decoded
 * component escape the authority it is supposed to be part of, verified against
 * the WHATWG parser `fetch` uses:
 *
 * ```
 * new URL('https://uuid@attacker.com.host').origin // => 'https://attacker.com.host'
 * new URL('https://uuid#attacker.com.host').origin // => 'https://uuid'
 * new URL('https://uuid?x.host').origin            // => 'https://uuid'
 * new URL('https://uuid/p.host').origin            // => 'https://uuid'
 * ```
 *
 * `@` is the dangerous one: the UUID becomes userinfo and the origin becomes
 * the attacker's host, which the caller's ApiKey or Basic credential is then
 * sent to. The other three silently truncate the authority to a bare label.
 *
 * `:` is a deliberate addition to Elastic's set. {@link splitCloudIdPort}
 * right-partitions only the *last* colon, so `a:b:9243` leaves `a:b` as a
 * component and assembles an authority with two colons that the URL parser
 * rejects outright — the same unactionable "Invalid URL" this module already
 * fixes for ported UUIDs. A real parent domain is a hostname and a real
 * service UUID is hex, so none of these five can occur in a legitimate value.
 */
const CLOUD_ID_FORBIDDEN_CHARS = ['#', '@', '?', '/', ':'] as const

/**
 * Rejects a decoded Cloud ID component that could escape the URL authority.
 *
 * Runs on the component **after** its port has been split off and **before**
 * it is concatenated into the origin. Checking the assembled string instead
 * would mean re-parsing the very URL whose parse is being subverted.
 *
 * @param component - A decoded, port-stripped Cloud ID component.
 * @param label - Names the component in the error message.
 * @throws If the component contains any of {@link CLOUD_ID_FORBIDDEN_CHARS}.
 */
function assertSafeCloudIdComponent(component: string, label: string): void {
  for (const char of CLOUD_ID_FORBIDDEN_CHARS) {
    if (component.includes(char)) {
      throw new Error(
        `Cloud ID is not properly formatted (${label} "${component}" contains the invalid character "${char}")`
      )
    }
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
 * Elastic's own clients do **not** agree on how a Cloud ID is parsed, so each
 * rule below is attributed to the client it actually comes from rather than to
 * "the Elastic clients" collectively. The three checked are `decodeCloudID` in
 * `beats/libbeat/cloudid/cloudid.go`, `parse_cloud_id` in
 * `elastic_transport/client_utils.py`, and `CloudNodePool` in
 * `elastic-transport-net` (`src/Elastic.Transport/Components/NodePool/`).
 *
 * - **The label is split off at the first colon only** — Python's
 *   `cluster_name, _, cloud_id = cloud_id.partition(":")` and .NET's
 *   `cloudId.Split(':', 2)`. Beats does the opposite: its code is
 *   `idx := strings.LastIndex(cloudID, ":")`, so it keeps only what follows the
 *   *last* colon — the comment above that line (`// 1. Ignore anything before
 *   ':'`) reads like a first-colon split but the code is not one. We follow
 *   Python/.NET **deliberately**: a first-colon split means a label containing
 *   a colon cannot shift the payload slice, whereas Beats' last-colon rule
 *   would silently decode a different substring. An empty or absent label is
 *   accepted — the base64 alphabet excludes `:`, so a value with no colon is
 *   unambiguously a bare payload.
 * - **Every component may carry its own `:<port>`, not just the parent
 *   domain** — this is **Beats and .NET**, not Python. Python strips a port
 *   only from the parent DN (`parent_dn.rpartition(":")`) and then interpolates
 *   the service UUID raw into `f"{es_uuid}.{parent_dn}"`, so a ported UUID
 *   lands *inside* the hostname. Elastic's Go decoder fixtures include
 *   `different-es-kb-port`, whose payload is
 *   `us-central1.gcp.cloud.es.io$<es-uuid>:9243$<kb-uuid>:9244` and which must
 *   resolve to `https://<es-uuid>.us-central1.gcp.cloud.es.io:9243`. Following
 *   Python here produced `https://<es-uuid>:9243.us-central1.gcp.cloud.es.io`,
 *   which `fetch` rejects as an invalid URL with no actionable message.
 * - **The Elasticsearch UUID's own port wins over the parent domain's** —
 *   again Beats and .NET, which resolve it identically. Go reads
 *   `host, port := extractPortFromName(words[0], defaultCloudPort)` followed by
 *   `esID, esPort := extractPortFromName(words[1], port)`; .NET reads
 *   `var (host, defaultPort) = ExtractPortFromId(parts[0].Trim())` then
 *   `ExtractPortFromId(parts[1].Trim(), defaultPort)`. Either way the parent
 *   port is only the *default* handed to the per-service extraction, so a port
 *   on the UUID overrides it. The `host-and-kb-set` fixture pins the other
 *   direction — parent `:9243` with a bare ES UUID resolves to `:9243`.
 *   ({@link splitCloudIdPort} matches Beats in right-partitioning at the *last*
 *   colon; .NET partitions at the first. The reject set below makes the
 *   difference unreachable, since a component with two colons is refused.)
 * - Kibana's port (`words[2]`) never influences the Elasticsearch origin in any
 *   of the three, which Go's `only-kb-set` fixture pins: a `:9244` on the
 *   Kibana UUID alone still yields ES on 443.
 * - **`:<port>` is appended only when the resolved port differs from 443** —
 *   this is **.NET's** `BuildServiceUri`, which returns
 *   `https://{serviceId}.{host}` unchanged on port 443. Beats always emits the
 *   port. 443 is already the default for `https:`, so emitting it would only
 *   make the URL noisier.
 *
 * Sim deliberately diverges from all three in two places:
 *
 * - **The Kibana component is not decoded or validated at all.** Beats requires
 *   three `$`-separated parts and runs `kbID` through its character check;
 *   Python and .NET decode Kibana but treat it as optional. We only ever build
 *   the Elasticsearch origin, so a Cloud ID that works for search is accepted
 *   even when its Kibana slot is missing or malformed. Two parts is the
 *   minimum, matching .NET's two-part floor rather than Go's three-part one.
 * - **`:` is added to the forbidden-character set.** See
 *   {@link CLOUD_ID_FORBIDDEN_CHARS} — the `#@?/` set itself is Beats-only.
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

  /**
   * The Kibana UUID (`words[2]`) is deliberately not checked. Elastic validates
   * it because it also builds a Kibana URL; we only ever build the
   * Elasticsearch origin, so rejecting on a component that never reaches it
   * would refuse a Cloud ID that works fine for search.
   */
  assertSafeCloudIdComponent(parentDn, 'host')
  assertSafeCloudIdComponent(esUuid, 'Elasticsearch UUID')

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
 * The `null`/`undefined` rejection and `String(value)` coercion are taken from
 * `toGuardedString` in the shared module rather than re-deriving them. A
 * `typeof value === 'string' ? value.trim() : ''` normalization turns a
 * legitimate non-string into `''` and then reports *"is required"* for a value
 * the caller did supply — an LLM emitting `"index": 2024` as a JSON number is
 * the ordinary case, and it already works for `documentId`, which goes through
 * the shared helper on the very same URL. `null` and `undefined` are rejected
 * *before* coercion, because `String(null)` is the truthy `'null'` and would
 * silently address an index literally named `"null"`.
 *
 * @param value - The raw index target, typically LLM- or user-supplied. A number
 *   is stringified, since an LLM can emit a numeric-looking index as a JSON number.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed, percent-encoded segment, safe to interpolate.
 * @throws If the value is missing, empty, or is a bare dot segment.
 */
export function safeIndexPathSegment(value: string | number, paramName: string): string {
  if (value === null || value === undefined) {
    throw new Error(`${paramName} is required`)
  }

  const trimmed = String(value).trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${paramName} cannot be "${trimmed}" (path traversal is not allowed)`)
  }

  return encodeURIComponent(trimmed)
}

/**
 * Matches the only two schemes a self-hosted host may carry.
 *
 * Tested before parsing so a scheme-less value gets a message naming the
 * missing scheme, rather than the URL parser's unactionable "Invalid URL".
 * Because it pins the scheme, the parsed `protocol` needs no second check.
 */
const SELF_HOSTED_SCHEME_PATTERN = /^https?:\/\//i

/**
 * Normalizes and validates a self-hosted host into an absolute origin.
 *
 * The scheme requirement is a credential-exposure control, not tidiness. A
 * host without one stays a **relative** URL, and the executor resolves every
 * tool URL as `new URL(endpointUrl, getBaseUrl())` — with Sim's own origin as
 * the base:
 *
 * ```
 * new URL('es.internal/products/_search', 'https://sim.ai')
 * // => https://sim.ai/es.internal/products/_search
 * new URL('//evil.example.com/x', 'https://sim.ai')
 * // => https://evil.example.com/x   (protocol-relative, inherits the scheme)
 * new URL('localhost:9200/products/_search', 'https://sim.ai')
 * // => protocol "localhost:", origin null
 * ```
 *
 * {@link buildAuthHeaders} attaches `Authorization: ApiKey …` or `Basic …`
 * regardless, so the caller's Elasticsearch credential is sent to Sim's public
 * origin — or, for the protocol-relative form, to an attacker's. The SSRF
 * guard does not catch it either, because the resolved host really is Sim.
 * Only a scheme makes the value absolute, so it is required rather than
 * guessed at: prefixing `https://` ourselves would silently redirect a
 * plaintext-only cluster and turn a typo into a different host.
 *
 * The parse that follows catches a scheme-ful value the URL parser still
 * cannot resolve (`https://`, `http://[`). The original string — not the
 * parser's normalized `href` — is what is returned, so a host is passed to
 * Elasticsearch exactly as the user typed it, minus trailing slashes.
 *
 * @param rawHost - The host as configured on the block.
 * @returns The trimmed, absolute host with trailing slashes removed.
 * @throws If the host is missing, carries no `http://`/`https://` scheme, or
 * does not parse as a URL.
 */
function normalizeSelfHostedHost(rawHost: unknown): string {
  const host = typeof rawHost === 'string' ? rawHost.trim() : ''

  if (!host) {
    throw new Error('Host is required for self-hosted deployments')
  }

  if (!SELF_HOSTED_SCHEME_PATTERN.test(host)) {
    throw new Error(
      `Host must start with "http://" or "https://" (received "${host}"). ` +
        'A host without a scheme is a relative URL and would send your Elasticsearch credential to Sim instead of your cluster.'
    )
  }

  let parsed: URL

  try {
    parsed = new URL(host)
  } catch {
    throw new Error(`Host is not a valid URL (received "${host}")`)
  }

  if (!parsed.origin || parsed.origin === 'null') {
    throw new Error(`Host is not a valid URL (received "${host}")`)
  }

  return host.replace(/\/+$/, '')
}

/**
 * Resolves the Elasticsearch base URL for either deployment type.
 *
 * Shared by every Elasticsearch tool so the Cloud ID decoding rules and the
 * self-hosted scheme requirement live in exactly one place.
 *
 * @throws If the cloud deployment has no usable Cloud ID, or the self-hosted
 * deployment has no host or a host that is not an absolute http(s) URL.
 */
export function buildBaseUrl(params: ElasticsearchBaseParams): string {
  if (params.deploymentType === 'cloud') {
    return parseCloudId(params.cloudId ?? '')
  }

  return normalizeSelfHostedHost(params.host)
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
