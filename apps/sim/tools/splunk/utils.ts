import type { SplunkBaseParams, SplunkMessage, SplunkSavedSearch } from '@/tools/splunk/types'
import type { ToolConfig } from '@/tools/types'

/** Connection + credential params every Splunk tool declares. */
export const SPLUNK_CONNECTION_PARAMS: ToolConfig['params'] = {
  baseUrl: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description:
      'Splunk management URL including the management port (e.g. https://splunk.example.com:8089)',
  },
  authToken: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Splunk authentication token, sent as a bearer token. Preferred over a password.',
  },
  username: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Splunk username, used for basic authentication when no token is supplied',
  },
  password: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Splunk password, used for basic authentication when no token is supplied',
  },
  owner: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description:
      'Namespace owner for /servicesNS requests (e.g. admin, or nobody for app-shared objects). Leave both this and the app empty to use the authenticated user context; set only one and the other becomes the - wildcard.',
  },
  app: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description:
      'Namespace app context for /servicesNS requests (e.g. search). Leave both this and the owner empty to use the authenticated user context; set only one and the other becomes the - wildcard.',
  },
}

/**
 * Splunk defaults every REST response to XML. Every request Sim makes must pin
 * `output_mode=json` or the transform layer receives XML it cannot parse.
 */
export const SPLUNK_JSON_OUTPUT_MODE = 'json'

/** Normalize the user-supplied management URL (e.g. `https://splunk.example.com:8089`). */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Splunk base URL is required (e.g. https://splunk.example.com:8089)')
  }
  return trimmed
}

/**
 * Build the namespace prefix for a REST path. Splunk exposes every configuration
 * endpoint both at `/services/...`, where "the system processes the request using
 * the active user user/app context", and at `/servicesNS/{owner}/{app}/...` when an
 * explicit context is needed.
 *
 * When only one node is supplied the other is filled with the documented wildcard
 * `-` — "To indicate all users, all apps, or resources shared by all users, use the
 * wildcard dash (-) symbol". `nobody` is NOT a neutral filler: it names the
 * shared-application owner, so using it would silently hide every user-private
 * object in the requested app.
 */
function namespacePrefix(params: SplunkBaseParams): string {
  const owner = params.owner?.trim()
  const app = params.app?.trim()
  if (!owner && !app) return '/services'
  return `/servicesNS/${encodeURIComponent(owner || '-')}/${encodeURIComponent(app || '-')}`
}

/**
 * Compose a fully qualified Splunk REST URL with `output_mode=json` always applied.
 * `path` is namespace-relative and must start with a slash (e.g. `/search/jobs`).
 */
export function buildSplunkUrl(
  params: SplunkBaseParams,
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (key === 'output_mode' || value == null || value === '') continue
    search.set(key, String(value))
  }
  search.set('output_mode', SPLUNK_JSON_OUTPUT_MODE)
  return `${normalizeBaseUrl(params.baseUrl)}${namespacePrefix(params)}${path}?${search.toString()}`
}

/** Encode a user-supplied value for use as a REST path segment. */
export function splunkPathSegment(value: string): string {
  return encodeURIComponent(value.trim())
}

/**
 * Build auth headers. Splunk supports a bearer authentication token ("In version 7.3
 * and higher of the Splunk platform, you can also use Splunk authentication tokens to
 * access REST endpoints") and basic authentication; the token is preferred when both
 * are supplied.
 */
export function buildSplunkHeaders(
  params: SplunkBaseParams,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extra }

  const token = params.authToken?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
    return headers
  }

  const username = params.username?.trim()
  const password = params.password
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    return headers
  }

  throw new Error('Splunk requires either an authentication token or a username and password')
}

/** Headers for the form-encoded POST bodies every Splunk write endpoint expects. */
export function buildSplunkFormHeaders(params: SplunkBaseParams): Record<string, string> {
  return buildSplunkHeaders(params, { 'Content-Type': 'application/x-www-form-urlencoded' })
}

/**
 * Serialize a form body, skipping empty values. Splunk expects booleans as 1/0.
 * An untouched subBlock serializes as `null`, so `null` must be dropped exactly
 * like `undefined` — otherwise the field is sent as the literal string `null`
 * and overrides the default Splunk would otherwise apply.
 */
export function buildSplunkFormBody(
  fields: Record<string, string | number | boolean | null | undefined>
): string {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue
    body.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
  }
  return body.toString()
}

/**
 * Read a Splunk JSON body, tolerating an empty one. The results endpoint answers
 * `204 No Content` with no body while a job has not produced results yet, and the job
 * control endpoint documents "Returned values: None". `Response.json()` throws on an
 * empty body, so a caller that polled a still-running job would surface
 * `Unexpected end of JSON input` instead of an empty result set.
 */
export async function readSplunkJson(response: Response): Promise<unknown> {
  if (response.status === 204) return {}
  const text = await response.text()
  if (!text.trim()) return {}
  return JSON.parse(text)
}

/**
 * Resolve the search ID a dispatching endpoint returns. The REST reference documents
 * the response as `<response><sid>...</sid></response>` with a single returned value,
 * `sid`, which `output_mode=json` renders as a flat `{ "sid": "..." }`.
 *
 * A missing `sid` is never a successful dispatch — it means the request produced
 * something other than a job (for example `exec_mode=oneshot`, which the reference
 * says "Does not return the search ID"). Fail loudly instead of handing the workflow
 * a null sid that only breaks two blocks later.
 */
export function requireSplunkSid(data: unknown): string {
  const sid = asString((data as { sid?: unknown })?.sid) ?? getEntryName(getSplunkEntries(data)[0])
  if (!sid) {
    throw new Error(
      'Splunk did not return a search ID for this request. Verify the search dispatched successfully; exec_mode=oneshot returns results instead of a search ID.'
    )
  }
  return sid
}

/**
 * Splunk SPL sent to `search/jobs` must begin with a search command. Users routinely
 * type a bare `index=main error`, so prefix the implicit `search` command unless the
 * string already starts with one (`search ...`, `| tstats ...`, `search ...`).
 */
export function normalizeSearchQuery(query: string): string {
  const trimmed = query.trim()
  if (trimmed.startsWith('|') || /^search\s/i.test(trimmed) || /^search$/i.test(trimmed)) {
    return trimmed
  }
  return `search ${trimmed}`
}

interface SplunkAtomEntry {
  name?: string
  title?: string
  id?: string
  updated?: string
  author?: string | { name?: string }
  content?: Record<string, unknown>
}

/**
 * Splunk renders collection responses in an Atom-derived envelope. With
 * `output_mode=json` the entries live at `entry[]`; the XML-to-JSON translation
 * used in parts of the reference nests the same array under `feed`. Read both.
 */
export function getSplunkEntries(data: unknown): SplunkAtomEntry[] {
  const root = (data ?? {}) as { entry?: unknown; feed?: { entry?: unknown } }
  const entries = Array.isArray(root.entry)
    ? root.entry
    : Array.isArray(root.feed?.entry)
      ? root.feed.entry
      : []
  return entries as SplunkAtomEntry[]
}

/** The per-entry property dictionary, or an empty object when the entry has none. */
export function getEntryContent(entry: SplunkAtomEntry | undefined): Record<string, unknown> {
  return (entry?.content as Record<string, unknown>) ?? {}
}

/** Entry display name — `name` under `output_mode=json`, `title` in the Atom form. */
export function getEntryName(entry: SplunkAtomEntry | undefined): string | null {
  return entry?.name ?? entry?.title ?? null
}

/** Entry author — a bare string under `output_mode=json`, an object in the Atom form. */
export function getEntryAuthor(entry: SplunkAtomEntry | undefined): string | null {
  const author = entry?.author
  if (typeof author === 'string') return author
  return author?.name ?? null
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Splunk serializes booleans as `0`/`1` (and occasionally as real booleans). */
export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') return true
    if (value === '0' || value.toLowerCase() === 'false') return false
  }
  return null
}

/** Normalize the `messages` array Splunk attaches to results and control responses. */
export function mapSplunkMessages(value: unknown): SplunkMessage[] {
  if (!Array.isArray(value)) return []
  return value.map((message) => {
    const record = (message ?? {}) as Record<string, unknown>
    return { type: asString(record.type), text: asString(record.text) }
  })
}

/**
 * The `content` keys `mapSavedSearchEntry` reads, in the `f` filtering-parameter form
 * the reference prescribes for the `saved/searches` collection: "This endpoint returns
 * an unusually high number of values. To limit the number of returned values, specify
 * the f filtering parameter." A saved search otherwise carries well over a hundred
 * `content` keys (`action.email.*` alone runs to dozens) of which only these are
 * projected, so a `count=0` listing pays for all of them on every entry.
 *
 * Only the collection endpoint documents this; the single-entity endpoint returns one
 * entry, so it is left unfiltered rather than assuming `f` is honored there too.
 */
const SAVED_SEARCH_CONTENT_FIELDS = [
  'search',
  'qualifiedSearch',
  'description',
  'disabled',
  'is_scheduled',
  'is_visible',
  'cron_schedule',
  'next_scheduled_time',
  'alert_type',
  'dispatch.earliest_time',
  'dispatch.latest_time',
] as const

/** Repeated `f=` arguments selecting only the saved-search fields Sim projects. */
export function savedSearchFieldQuery(): string {
  return SAVED_SEARCH_CONTENT_FIELDS.map((field) => `f=${encodeURIComponent(field)}`).join('&')
}

/** Project one `saved/searches` Atom entry into the canonical saved-search shape. */
export function mapSavedSearchEntry(entry: unknown): SplunkSavedSearch {
  const atomEntry = entry as SplunkAtomEntry | undefined
  const content = getEntryContent(atomEntry)
  return {
    name: getEntryName(atomEntry),
    id: asString(atomEntry?.id),
    author: getEntryAuthor(atomEntry),
    updated: asString(atomEntry?.updated),
    search: asString(content.search),
    qualifiedSearch: asString(content.qualifiedSearch),
    description: asString(content.description),
    disabled: asBoolean(content.disabled),
    isScheduled: asBoolean(content.is_scheduled),
    isVisible: asBoolean(content.is_visible),
    cronSchedule: asString(content.cron_schedule),
    nextScheduledTime: asString(content.next_scheduled_time),
    alertType: asString(content.alert_type),
    dispatchEarliestTime: asString(content['dispatch.earliest_time']),
    dispatchLatestTime: asString(content['dispatch.latest_time']),
  }
}

/**
 * Project the documented search-results envelope (`init_offset`, `messages`,
 * `preview`, `results`) into Sim's output shape. Result rows are the search's own
 * fields, so they are passed through as dynamic objects.
 */
export function mapSearchResultsPayload(data: unknown) {
  const root = (data ?? {}) as {
    results?: unknown
    messages?: unknown
    preview?: unknown
    init_offset?: unknown
  }
  const results = Array.isArray(root.results) ? (root.results as Record<string, unknown>[]) : []
  return {
    results,
    resultCount: results.length,
    preview: asBoolean(root.preview),
    initOffset: asNumber(root.init_offset),
    messages: mapSplunkMessages(root.messages),
  }
}

/** Shared output schema for the two tools that return search results. */
export const SEARCH_RESULTS_OUTPUTS = {
  results: {
    type: 'array' as const,
    description: 'Result rows. Each row holds the fields produced by the search.',
    items: { type: 'object' as const },
  },
  resultCount: {
    type: 'number' as const,
    description: 'Number of result rows returned in this response',
  },
  preview: {
    type: 'boolean' as const,
    description: 'Whether these are preview results from a still-running job',
    optional: true,
  },
  initOffset: {
    type: 'number' as const,
    description: 'Offset of the first returned row within the full result set',
    optional: true,
  },
  messages: {
    type: 'array' as const,
    description: 'Search messages returned alongside the results',
    items: {
      type: 'object' as const,
      properties: {
        type: { type: 'string' as const, description: 'Message severity' },
        text: { type: 'string' as const, description: 'Message text' },
      },
    },
  },
}

/** Shared output schema for the `messages` envelope key. */
export const SPLUNK_MESSAGES_OUTPUT = {
  type: 'array' as const,
  description: 'Informational, warning, and error messages returned with the response',
  items: {
    type: 'object' as const,
    properties: {
      type: { type: 'string' as const, description: 'Message severity (INFO, WARN, ERROR, DEBUG)' },
      text: { type: 'string' as const, description: 'Message text' },
    },
  },
}
