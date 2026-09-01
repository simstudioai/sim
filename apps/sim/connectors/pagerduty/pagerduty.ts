import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { pagerdutyConnectorMeta } from '@/connectors/pagerduty/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('PagerDutyConnector')

const PAGERDUTY_API_BASE = 'https://api.pagerduty.com'
/** PagerDuty caps `limit` at 100 on every classic-pagination listing. */
const PAGE_SIZE = 100
/** Cap on log entries appended to a document so a noisy incident stays bounded. */
const MAX_LOG_ENTRIES = 200
/**
 * Hard ceiling on classic (offset) pagination in PagerDuty's REST API v2: a
 * request whose `offset + limit` exceeds this value is answered with
 * `400 Invalid Request` rather than served. The listing therefore stops while the
 * *next* request would still fit, and the caller marks the sync as capped instead
 * of letting deletion reconciliation purge the unseen tail.
 */
const MAX_LISTING_WINDOW = 10000

const VALID_STATUSES = new Set(['triggered', 'acknowledged', 'resolved'])
const VALID_URGENCIES = new Set(['high', 'low'])

/** PagerDuty's common reference envelope, present on service/team/priority/agent fields. */
interface PagerDutyReference {
  id?: string
  type?: string
  summary?: string
  html_url?: string
}

/** Additional incident body, returned only when `include[]=body` is requested. */
interface PagerDutyIncidentBody {
  type?: string
  /**
   * Documented as an object in PagerDuty's OpenAPI schema, but the Incident
   * Creation API only accepts string bodies, so both forms occur in practice.
   */
  details?: unknown
}

interface PagerDutyIncident {
  id?: string
  incident_number?: number
  title?: string
  status?: string
  urgency?: string
  incident_key?: string
  created_at?: string
  updated_at?: string
  last_status_change_at?: string
  resolved_at?: string
  html_url?: string
  service?: PagerDutyReference
  escalation_policy?: PagerDutyReference
  teams?: PagerDutyReference[]
  priority?: PagerDutyReference
  assignments?: Array<{ assignee?: PagerDutyReference }>
  incident_type?: { name?: string }
  resolve_reason?: { type?: string; incident?: PagerDutyReference }
  body?: PagerDutyIncidentBody
}

interface PagerDutyIncidentsListResponse {
  incidents?: PagerDutyIncident[]
  limit?: number
  offset?: number
  more?: boolean
}

interface PagerDutyIncidentShowResponse {
  incident?: PagerDutyIncident
}

interface PagerDutyNote {
  id?: string
  content?: string
  created_at?: string
  updated_at?: string
  user?: PagerDutyReference
}

interface PagerDutyNotesResponse {
  notes?: PagerDutyNote[]
}

interface PagerDutyLogEntry {
  id?: string
  type?: string
  summary?: string
  created_at?: string
  agent?: PagerDutyReference
  note?: string
}

interface PagerDutyLogEntriesResponse {
  log_entries?: PagerDutyLogEntry[]
  more?: boolean
}

/**
 * Metadata persisted on every incident document. Produced by one function so the
 * deferred list stub and the hydrated document carry identical tag values.
 */
interface IncidentMetadata {
  status?: string
  urgency?: string
  priority?: string
  service?: string
  teams?: string[]
  incidentType?: string
  incidentDate?: string
  resolvedDate?: string
  incidentNumber?: number
}

/**
 * Builds PagerDuty's REST headers. The REST API authenticates with a
 * `Token token=<key>` scheme rather than Bearer, and pins the v2 schema through
 * the versioned Accept header.
 */
function buildHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Token token=${accessToken}`,
    Accept: 'application/vnd.pagerduty+json;version=2',
    'Content-Type': 'application/json',
  }
}

/**
 * Metadata-based content hash keyed on PagerDuty's own change indicator.
 *
 * `updated_at` is bumped whenever the incident is modified, so the hash is stable
 * between the list stub and `getDocument`. Notes and log entries are child
 * resources: PagerDuty does not guarantee they bump the parent's `updated_at`, so
 * the connector sets `rehydrateOnFullSync` and an explicit full resync is what
 * picks up note-only changes.
 */
function buildContentHash(incident: PagerDutyIncident): string {
  return `pagerduty:${incident.id}:${incident.updated_at ?? ''}`
}

function buildTitle(incident: PagerDutyIncident): string {
  const title = incident.title?.trim()
  const number = incident.incident_number
  if (title && number != null) return `#${number}: ${title}`
  return title || (number != null ? `Incident #${number}` : `Incident ${incident.id ?? ''}`.trim())
}

/** Extracts the human-readable summaries from a reference array. */
function referenceLabels(references: PagerDutyReference[] | undefined): string[] | undefined {
  if (!Array.isArray(references)) return undefined
  const labels: string[] = []
  for (const reference of references) {
    const label = reference.summary?.trim()
    if (label) labels.push(label)
  }
  return labels.length > 0 ? labels : undefined
}

function buildMetadata(incident: PagerDutyIncident): IncidentMetadata {
  return {
    status: incident.status ?? undefined,
    urgency: incident.urgency ?? undefined,
    priority: incident.priority?.summary ?? undefined,
    service: incident.service?.summary ?? undefined,
    teams: referenceLabels(incident.teams),
    incidentType: incident.incident_type?.name ?? undefined,
    incidentDate: incident.created_at ?? undefined,
    resolvedDate: incident.resolved_at ?? undefined,
    incidentNumber:
      typeof incident.incident_number === 'number' ? incident.incident_number : undefined,
  }
}

/** Depth beyond which nested `custom_details` are rendered as a single JSON line. */
const MAX_DETAIL_DEPTH = 4

/**
 * Flattens a `custom_details` payload into `dotted.path: value` lines.
 *
 * Events API alerts routinely nest their `custom_details` (a `metadata` object, a
 * list of affected hosts), so dropping non-primitive values would discard the most
 * specific part of the incident. Recursion is depth-bounded, and anything deeper
 * is emitted as compact JSON rather than lost.
 */
function flattenDetails(value: unknown, path: string, depth: number, lines: string[]): void {
  if (value == null) return
  if (typeof value !== 'object') {
    lines.push(path ? `${path}: ${String(value)}` : String(value))
    return
  }
  if (depth >= MAX_DETAIL_DEPTH) {
    lines.push(`${path}: ${JSON.stringify(value)}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenDetails(item, `${path}[${index}]`, depth + 1, lines))
    return
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    flattenDetails(nested, path ? `${path}.${key}` : key, depth + 1, lines)
  }
}

/**
 * Renders the incident body details, which arrive either as a plain/HTML string
 * (Incident Creation API) or as a structured object (Events API payloads).
 */
function renderBodyDetails(details: unknown): string | undefined {
  if (typeof details === 'string') {
    const text = htmlToPlainText(details)
    return text.trim() || undefined
  }
  if (details && typeof details === 'object') {
    const lines: string[] = []
    flattenDetails(details, '', 0, lines)
    return lines.length > 0 ? lines.join('\n') : undefined
  }
  return undefined
}

function incidentToStub(incident: PagerDutyIncident): ExternalDocument | null {
  if (!incident.id) return null
  return {
    externalId: incident.id,
    title: buildTitle(incident),
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: incident.html_url || undefined,
    contentHash: buildContentHash(incident),
    metadata: { ...buildMetadata(incident) },
  }
}

/**
 * Outcome of a child-resource fetch.
 *
 * `failed` separates a hard failure from "PagerDuty answered, and this incident
 * genuinely has no accessible sub-resource" (403/404 — an ability the account
 * lacks). The latter is a permanent, complete answer and is folded into the
 * document as an empty section; a hard failure means the rendered content is
 * missing sections that do exist, and since `contentHash` is keyed on the
 * incident's `updated_at` it would never change again — the partial document
 * would be frozen in place. The caller therefore fails the document so the next
 * sync retries it.
 */
interface ChildFetch<T> {
  items: T[]
  failed: boolean
}

/** 403/404 are terminal answers about access, not transient transport failures. */
function isPermanentlyUnavailable(status: number): boolean {
  return status === 403 || status === 404
}

/**
 * Fetches every note on an incident. `GET /incidents/{id}/notes` takes no
 * pagination parameters and returns the full set in one response.
 */
async function fetchNotes(
  accessToken: string,
  incidentId: string
): Promise<ChildFetch<PagerDutyNote>> {
  try {
    const response = await fetchWithRetry(
      `${PAGERDUTY_API_BASE}/incidents/${encodeURIComponent(incidentId)}/notes`,
      { method: 'GET', headers: buildHeaders(accessToken) }
    )

    if (!response.ok) {
      logger.warn('Failed to fetch PagerDuty incident notes', {
        incidentId,
        status: response.status,
      })
      return { items: [], failed: !isPermanentlyUnavailable(response.status) }
    }

    const data = (await response.json()) as PagerDutyNotesResponse
    return { items: data.notes ?? [], failed: false }
  } catch (error) {
    logger.warn('Error fetching PagerDuty incident notes', {
      incidentId,
      error: toError(error).message,
    })
    return { items: [], failed: true }
  }
}

/**
 * Fetches the incident's response timeline via classic offset pagination.
 *
 * `is_overview=true` narrows the log to the significant lifecycle changes
 * (trigger, acknowledge, escalate, resolve, annotate) instead of every
 * notification delivery, which keeps the indexed timeline readable.
 *
 * `since`/`until` are bounded to the incident's own lifetime. PagerDuty documents
 * a one-month default range on `GET /incidents` but says nothing either way about
 * `GET /incidents/{id}/log_entries`, and an inherited default would silently
 * return an empty timeline for every incident older than the window. Every log
 * entry necessarily falls inside `[created_at, now]`, so pinning that range can
 * only remove ambiguity — and if PagerDuty rejects the range (an undocumented
 * maximum span), the walk restarts unbounded rather than losing the timeline.
 */
async function fetchLogEntries(
  accessToken: string,
  incident: PagerDutyIncident
): Promise<ChildFetch<PagerDutyLogEntry>> {
  const incidentId = incident.id as string
  const entries: PagerDutyLogEntry[] = []
  let offset = 0
  let bounded = Boolean(incident.created_at)
  let truncated = false
  let failed = false

  try {
    while (entries.length < MAX_LOG_ENTRIES) {
      const url = new URL(
        `${PAGERDUTY_API_BASE}/incidents/${encodeURIComponent(incidentId)}/log_entries`
      )
      url.searchParams.set('limit', String(PAGE_SIZE))
      url.searchParams.set('offset', String(offset))
      url.searchParams.set('is_overview', 'true')
      if (bounded && incident.created_at) {
        url.searchParams.set('since', incident.created_at)
        url.searchParams.set('until', new Date().toISOString())
      }

      const response = await fetchWithRetry(url.toString(), {
        method: 'GET',
        headers: buildHeaders(accessToken),
      })

      if (!response.ok) {
        if (bounded && offset === 0 && response.status === 400) {
          logger.warn('PagerDuty rejected the log entry date range; retrying unbounded', {
            incidentId,
          })
          bounded = false
          continue
        }
        logger.warn('Failed to fetch PagerDuty incident log entries', {
          incidentId,
          status: response.status,
        })
        failed = !isPermanentlyUnavailable(response.status)
        break
      }

      const data = (await response.json()) as PagerDutyLogEntriesResponse
      const page = data.log_entries ?? []
      entries.push(...page)

      if (!data.more || page.length === 0) break
      if (entries.length >= MAX_LOG_ENTRIES) {
        truncated = true
        break
      }
      offset += page.length
    }
  } catch (error) {
    logger.warn('Error fetching PagerDuty incident log entries', {
      incidentId,
      error: toError(error).message,
    })
    failed = true
  }

  if (truncated) {
    logger.warn('Truncated PagerDuty incident timeline at the per-document cap', {
      incidentId,
      cap: MAX_LOG_ENTRIES,
    })
  }

  return { items: entries.slice(0, MAX_LOG_ENTRIES), failed }
}

/**
 * Formats an incident, its notes, and its timeline into a single plain-text
 * document. Sections without data are omitted so open incidents do not carry
 * empty resolution headers.
 */
function formatIncidentContent(
  incident: PagerDutyIncident,
  notes: PagerDutyNote[],
  logEntries: PagerDutyLogEntry[]
): string {
  const parts: string[] = []

  parts.push(`Incident: ${buildTitle(incident)}`)
  if (incident.status) parts.push(`Status: ${incident.status}`)
  if (incident.urgency) parts.push(`Urgency: ${incident.urgency}`)
  if (incident.priority?.summary) parts.push(`Priority: ${incident.priority.summary}`)
  if (incident.service?.summary) parts.push(`Service: ${incident.service.summary}`)
  if (incident.incident_type?.name) parts.push(`Type: ${incident.incident_type.name}`)

  const teams = referenceLabels(incident.teams)
  if (teams) parts.push(`Teams: ${teams.join(', ')}`)

  const assignees = referenceLabels(
    incident.assignments?.map((assignment) => assignment.assignee ?? {})
  )
  if (assignees) parts.push(`Assigned to: ${assignees.join(', ')}`)

  if (incident.escalation_policy?.summary) {
    parts.push(`Escalation Policy: ${incident.escalation_policy.summary}`)
  }
  if (incident.created_at) parts.push(`Triggered: ${incident.created_at}`)
  if (incident.resolved_at) parts.push(`Resolved: ${incident.resolved_at}`)
  if (incident.resolve_reason?.type) parts.push(`Resolve Reason: ${incident.resolve_reason.type}`)
  if (incident.incident_key) parts.push(`Incident Key: ${incident.incident_key}`)

  const details = renderBodyDetails(incident.body?.details)
  if (details) {
    parts.push('')
    parts.push('--- Details ---')
    parts.push(details)
  }

  const noteLines = notes
    .map((note) => {
      const content = note.content?.trim()
      if (!content) return undefined
      const author = note.user?.summary?.trim()
      const prefix = [note.created_at ? `[${note.created_at}]` : '', author ?? '']
        .filter(Boolean)
        .join(' ')
      return prefix ? `${prefix}: ${content}` : content
    })
    .filter((line): line is string => Boolean(line))
  if (noteLines.length > 0) {
    parts.push('')
    parts.push('--- Notes ---')
    parts.push(...noteLines)
  }

  const timelineLines = logEntries
    .map((entry) => {
      const summary = entry.summary?.trim()
      const note = entry.note?.trim()
      const text = [summary, note].filter(Boolean).join(' — ')
      if (!text) return undefined
      const agent = entry.agent?.summary?.trim()
      const prefix = [entry.created_at ? `[${entry.created_at}]` : '', agent ?? '']
        .filter(Boolean)
        .join(' ')
      return prefix ? `${prefix}: ${text}` : text
    })
    .filter((line): line is string => Boolean(line))
  if (timelineLines.length > 0) {
    parts.push('')
    parts.push('--- Timeline ---')
    parts.push(...timelineLines)
  }

  return parts.join('\n').trim()
}

/**
 * Reads the optional `maxIncidents` cap, returning 0 (unlimited) when unset or
 * not a positive number.
 */
function parseMaxIncidents(sourceConfig: Record<string, unknown>): number {
  const raw = sourceConfig.maxIncidents
  if (raw == null || raw === '') return 0
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function readStringConfig(sourceConfig: Record<string, unknown>, key: string): string {
  const value = sourceConfig[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Fetches a single incident, asking for the extra sections the document renders.
 *
 * PagerDuty's OpenAPI schema documents `Incident.body` as "only returned if the
 * `include[]=body` query parameter is provided", yet omits `body` from the same
 * spec's `include[]` enum. The value is therefore requested on the strength of
 * the field docs, and a rejected request is retried once without it rather than
 * failing the document. Returns `null` when the incident no longer exists.
 */
async function fetchIncident(
  accessToken: string,
  incidentId: string
): Promise<PagerDutyIncident | null> {
  const base = `${PAGERDUTY_API_BASE}/incidents/${encodeURIComponent(incidentId)}`
  const includes = ['teams', 'priorities', 'services']

  for (const withBody of [true, false]) {
    const url = new URL(base)
    for (const include of includes) url.searchParams.append('include[]', include)
    if (withBody) url.searchParams.append('include[]', 'body')

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: buildHeaders(accessToken),
    })

    if (response.ok) {
      const data = (await response.json()) as PagerDutyIncidentShowResponse
      return data.incident ?? null
    }

    if (response.status === 404 || response.status === 410) return null
    if (withBody && response.status === 400) {
      logger.warn('PagerDuty rejected the body include; retrying without it', { incidentId })
      continue
    }

    throw new Error(`Failed to fetch PagerDuty incident: ${response.status}`)
  }

  return null
}

export const pagerdutyConnector: ConnectorConfig = {
  ...pagerdutyConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxIncidents = parseMaxIncidents(sourceConfig)
    const status = readStringConfig(sourceConfig, 'statuses')
    const urgency = readStringConfig(sourceConfig, 'urgency')
    const serviceIds = parseMultiValue(sourceConfig.serviceIds)
    const teamIds = parseMultiValue(sourceConfig.teamIds)

    const parsedCursor = cursor ? Number(cursor) : 0
    const offset = Number.isFinite(parsedCursor) && parsedCursor > 0 ? Math.floor(parsedCursor) : 0

    const url = new URL(`${PAGERDUTY_API_BASE}/incidents`)
    url.searchParams.set('limit', String(PAGE_SIZE))
    url.searchParams.set('offset', String(offset))
    url.searchParams.append('sort_by', 'created_at:asc')
    if (status) url.searchParams.append('statuses[]', status)
    if (urgency) url.searchParams.append('urgencies[]', urgency)
    for (const serviceId of serviceIds) url.searchParams.append('service_ids[]', serviceId)
    for (const teamId of teamIds) url.searchParams.append('team_ids[]', teamId)

    /**
     * Without an explicit range PagerDuty defaults `since`/`until` to the last
     * month, which would silently truncate the listing and make deletion
     * reconciliation purge every older document. `date_range=all` disables that
     * default and returns the complete history.
     */
    url.searchParams.set('date_range', 'all')

    logger.info('Listing PagerDuty incidents', { offset, maxIncidents })

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: buildHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list PagerDuty incidents', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list PagerDuty incidents: ${response.status}`)
    }

    const data = (await response.json()) as PagerDutyIncidentsListResponse
    const incidents = data.incidents ?? []

    const allDocuments: ExternalDocument[] = []
    let skipped = 0
    for (const incident of incidents) {
      const stub = incidentToStub(incident)
      if (stub) {
        allDocuments.push(stub)
      } else {
        skipped += 1
      }
    }

    /**
     * An incident dropped for a missing ID is still present in PagerDuty, so the
     * listing is incomplete and must not drive deletion reconciliation.
     */
    if (skipped > 0 && syncContext) {
      logger.warn('Skipped PagerDuty incidents without an ID', { skipped })
      syncContext.listingCapped = true
    }

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = allDocuments
    if (maxIncidents > 0) {
      const remaining = Math.max(0, maxIncidents - prevFetched)
      if (allDocuments.length > remaining) {
        documents = allDocuments.slice(0, remaining)
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxIncidents > 0 && totalFetched >= maxIncidents
    const sourceHasMore = Boolean(data.more)
    /**
     * The cap only truncates the listing when it actually withheld something: a
     * `maxIncidents` that happens to equal the source's exact incident count
     * still yields a complete listing, and marking it capped would block deletion
     * reconciliation forever.
     */
    if (hitLimit && (sourceHasMore || documents.length < allDocuments.length) && syncContext) {
      syncContext.listingCapped = true
    }

    const nextOffset = offset + incidents.length
    /**
     * Measured against the request that *would* come next: PagerDuty rejects
     * `offset + limit > 10000`, so a short page (which leaves `nextOffset` off a
     * clean page boundary) must still stop before the sum overruns.
     */
    const hitOffsetCeiling = nextOffset + PAGE_SIZE > MAX_LISTING_WINDOW
    /**
     * PagerDuty reported more results but served none, so the walk cannot
     * advance — `offset` only moves by what the page returned. Treat it as a
     * truncated listing rather than source exhaustion.
     */
    const stalledPage = sourceHasMore && incidents.length === 0
    const hasMore = !hitLimit && !hitOffsetCeiling && sourceHasMore && incidents.length > 0

    if (!hitLimit && hitOffsetCeiling && sourceHasMore && syncContext) {
      logger.warn('Stopping PagerDuty listing at the pagination window ceiling', {
        offset: nextOffset,
      })
      syncContext.listingCapped = true
    }

    if (!hitLimit && stalledPage && syncContext) {
      logger.warn('PagerDuty reported more incidents but returned an empty page', { offset })
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hasMore ? String(nextOffset) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    if (!externalId) return null

    /** Only a deleted incident (404/410) resolves to `null`; `fetchIncident` throws otherwise. */
    const incident = await fetchIncident(accessToken, externalId)
    if (!incident?.id) return null

    const [notes, logEntries] = await Promise.all([
      fetchNotes(accessToken, incident.id),
      fetchLogEntries(accessToken, incident),
    ])

    /**
     * Indexing the incident without its notes or timeline would freeze the gap
     * in place: the hash is derived from `updated_at`, which a retry cannot
     * change, so the document would never be re-hydrated. Throwing (rather than
     * resolving `null`) makes the sync engine record a visible failed document
     * and retry it, instead of dropping the incident with no counter.
     */
    if (notes.failed || logEntries.failed) {
      logger.warn('PagerDuty incident had an incomplete sub-resource fetch', {
        externalId,
        notesFailed: notes.failed,
        logEntriesFailed: logEntries.failed,
      })
      throw new Error(`Incomplete sub-resource fetch for PagerDuty incident ${externalId}`)
    }

    const content = formatIncidentContent(incident, notes.items, logEntries.items)
    if (!content.trim()) {
      logger.info('Skipping PagerDuty incident with no indexable content', { externalId })
      return null
    }

    return {
      externalId: incident.id,
      title: buildTitle(incident),
      content,
      contentDeferred: false,
      mimeType: 'text/plain',
      sourceUrl: incident.html_url || undefined,
      contentHash: buildContentHash(incident),
      metadata: { ...buildMetadata(incident) },
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxIncidents = sourceConfig.maxIncidents as string | undefined
    if (maxIncidents && (Number.isNaN(Number(maxIncidents)) || Number(maxIncidents) < 0)) {
      return { valid: false, error: 'Max incidents must be a non-negative number' }
    }

    const status = readStringConfig(sourceConfig, 'statuses')
    if (status && !VALID_STATUSES.has(status)) {
      return {
        valid: false,
        error: 'Status must be one of triggered, acknowledged, or resolved',
      }
    }

    const urgency = readStringConfig(sourceConfig, 'urgency')
    if (urgency && !VALID_URGENCIES.has(urgency)) {
      return { valid: false, error: 'Urgency must be either high or low' }
    }

    try {
      const response = await fetchWithRetry(
        `${PAGERDUTY_API_BASE}/incidents?limit=1&date_range=all`,
        {
          method: 'GET',
          headers: buildHeaders(accessToken),
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `PagerDuty access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    for (const key of ['status', 'urgency', 'priority', 'service', 'incidentType'] as const) {
      const value = metadata[key]
      if (typeof value === 'string' && value.trim()) result[key] = value
    }

    const teams = joinTagArray(metadata.teams)
    if (teams) result.teams = teams

    const incidentDate = parseTagDate(metadata.incidentDate)
    if (incidentDate) result.incidentDate = incidentDate

    const resolvedDate = parseTagDate(metadata.resolvedDate)
    if (resolvedDate) result.resolvedDate = resolvedDate

    if (metadata.incidentNumber != null) {
      const incidentNumber = Number(metadata.incidentNumber)
      if (!Number.isNaN(incidentNumber)) result.incidentNumber = incidentNumber
    }

    return result
  },
}
