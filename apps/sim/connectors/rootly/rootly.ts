import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { rootlyConnectorMeta } from '@/connectors/rootly/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('RootlyConnector')

const ROOTLY_API_BASE = 'https://api.rootly.com/v1'
/** JSON:API media type required by Rootly for all requests. */
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json'
const PAGE_SIZE = 50
/** Cap on timeline events appended to a document to keep content bounded. */
const MAX_TIMELINE_EVENTS = 200
/**
 * Relationship names passed as `include` on incident requests — `environments`,
 * `services`, and `groups` (Rootly's API token for teams), the only ones this
 * connector reads. Rootly's incident schema embeds them inside `attributes`, so
 * the include only affects the sideloaded `included[]`; it is sent on both the
 * list and detail requests so neither path can serialize the relationship
 * attributes differently and make the stub's tags drift from the hydrated
 * document's.
 */
const INCIDENT_INCLUDE = 'environments,services,groups'

/**
 * Detail-only include. `incident_post_mortem` sideloads the incident's
 * retrospective so `getDocument` can append its body to the indexed content
 * without a second round trip.
 */
const INCIDENT_DETAIL_INCLUDE = `${INCIDENT_INCLUDE},incident_post_mortem`

/** JSON:API resource `type` of a Rootly retrospective in `included[]`. */
const POST_MORTEM_TYPE = 'incident_post_mortems'

/**
 * Deterministic sort keys. Rootly paginates with `page[number]`, so an unsorted
 * listing can reorder between page requests and silently drop incidents — and a
 * full-sync listing that drops a document makes the sync engine hard-delete it.
 *
 * Full syncs sort by `created_at`, which never changes, so page boundaries are
 * fixed for the whole walk. Incremental syncs have no immutable key available —
 * they are filtered on `updated_at`, the very column that moves — so they sort
 * `updated_at` ascending, which pushes a record touched mid-sync ahead of the
 * cursor rather than behind it. Its own update is therefore still seen; the
 * residual risk is the one-position shift that displacement causes further down
 * the listing, which page-number paging cannot fully avoid either way.
 */
const FULL_SYNC_SORT = 'created_at'
const INCREMENTAL_SORT = 'updated_at'

/**
 * JSON:API named-resource entry as embedded directly inside incident
 * `attributes` for relationships (environments, services, etc.). Each entry
 * wraps a `data` object whose `attributes.name` is the human-readable label.
 */
interface RootlyNamedResource {
  data?: {
    id?: string
    type?: string
    attributes?: {
      name?: string
    }
  }
}

/**
 * Minimal shape of a Rootly incident's `attributes` object.
 * Only the fields this connector reads are typed; Rootly returns many more.
 *
 * Relationship arrays (environments, services, groups) and the freeform
 * `labels` map are embedded inline in the `attributes` of both the list and
 * detail responses, so the deferred list stub can derive every tag without an
 * extra request.
 */
interface RootlyIncidentAttributes {
  title?: string
  slug?: string
  summary?: string
  kind?: string
  status?: string
  url?: string
  short_url?: string
  mitigation_message?: string
  resolution_message?: string
  cancellation_message?: string
  retrospective_progress_status?: string
  started_at?: string
  detected_at?: string
  mitigated_at?: string
  resolved_at?: string
  closed_at?: string
  created_at?: string
  updated_at?: string
  severity?: {
    data?: {
      id?: string
      attributes?: {
        name?: string
        severity?: string
      }
    }
  }
  environments?: RootlyNamedResource[]
  services?: RootlyNamedResource[]
  groups?: RootlyNamedResource[]
  labels?: Record<string, string>
}

/** A single JSON:API resource object for an incident. */
interface RootlyIncidentResource {
  id?: string
  type?: string
  attributes?: RootlyIncidentAttributes
}

/** Attributes of a Rootly incident timeline event. */
interface RootlyEventAttributes {
  event?: string
  visibility?: string
  occurred_at?: string
  created_at?: string
  updated_at?: string
}

interface RootlyEventResource {
  id?: string
  type?: string
  attributes?: RootlyEventAttributes
}

/** A sideloaded JSON:API resource from the top-level `included[]` array. */
interface RootlyIncludedResource {
  id?: string
  type?: string
  attributes?: Record<string, unknown>
}

/** JSON:API list envelope shared by incidents and events list endpoints. */
interface RootlyListResponse<T> {
  data?: T[]
  links?: {
    next?: string | null
  }
  meta?: {
    next_page?: number | null
    total_pages?: number | null
    current_page?: number | null
    total_count?: number
  }
}

interface RootlyResourceResponse<T> {
  data?: T
  included?: RootlyIncludedResource[]
}

/**
 * Metadata persisted on every incident document, identical between the list
 * stub and the hydrated document so `contentHash` and tags stay stable.
 */
interface IncidentMetadata {
  status?: string
  severityName?: string
  severityLevel?: string
  kind?: string
  incidentDate?: string
  resolvedDate?: string
  environments?: string[]
  services?: string[]
  teams?: string[]
  labels?: string[]
  updatedAt?: string
}

/**
 * Builds the standard JSON:API request headers with Bearer auth.
 */
function buildHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': JSON_API_CONTENT_TYPE,
    Accept: JSON_API_CONTENT_TYPE,
  }
}

/**
 * Derives the metadata bag from an incident's attributes. Used by both the list
 * stub and getDocument so the two produce an identical `contentHash`.
 */
function buildMetadata(attrs: RootlyIncidentAttributes): IncidentMetadata {
  const severityData = attrs.severity?.data
  return {
    status: attrs.status ?? undefined,
    severityName: severityData?.attributes?.name ?? undefined,
    severityLevel: severityData?.attributes?.severity ?? undefined,
    kind: attrs.kind ?? undefined,
    incidentDate: attrs.started_at ?? attrs.created_at ?? undefined,
    resolvedDate: attrs.resolved_at ?? undefined,
    environments: namedResourceLabels(attrs.environments),
    services: namedResourceLabels(attrs.services),
    teams: namedResourceLabels(attrs.groups),
    labels: labelPairs(attrs.labels),
    updatedAt: attrs.updated_at ?? undefined,
  }
}

/**
 * Extracts the human-readable `name` from each JSON:API named-resource entry,
 * dropping any without a usable label.
 */
function namedResourceLabels(resources: RootlyNamedResource[] | undefined): string[] | undefined {
  if (!Array.isArray(resources)) return undefined
  const names: string[] = []
  for (const resource of resources) {
    const name = resource.data?.attributes?.name?.trim()
    if (name) names.push(name)
  }
  return names.length > 0 ? names : undefined
}

/**
 * Flattens Rootly's freeform `labels` map (e.g. `{platform: "osx"}`) into
 * `key:value` strings so they can be joined into a single searchable tag.
 */
function labelPairs(labels: Record<string, string> | undefined): string[] | undefined {
  if (!labels || typeof labels !== 'object') return undefined
  const pairs: string[] = []
  for (const [key, value] of Object.entries(labels)) {
    const trimmedKey = key.trim()
    if (!trimmedKey) continue
    const trimmedValue = typeof value === 'string' ? value.trim() : ''
    pairs.push(trimmedValue ? `${trimmedKey}:${trimmedValue}` : trimmedKey)
  }
  return pairs.length > 0 ? pairs : undefined
}

/**
 * Computes a metadata-based content hash. The formula depends only on the
 * incident ID and its `updated_at` timestamp, so the deferred list stub and the
 * hydrated `getDocument` result hash identically — change detection keys off
 * Rootly's own change indicator rather than the rendered text.
 */
function buildContentHash(id: string, updatedAt: string | undefined): string {
  return `rootly:${id}:${updatedAt ?? ''}`
}

function buildSourceUrl(attrs: RootlyIncidentAttributes): string | undefined {
  return attrs.url || attrs.short_url || undefined
}

/**
 * Determines whether another page exists.
 *
 * `meta.next_page` is the documented per-page indicator — nullable, and null on
 * the last page — so it decides whenever it is present. `links.next` (also
 * documented nullable) is only consulted when the envelope carries no
 * `meta.next_page` at all.
 */
function hasNextPage(body: RootlyListResponse<unknown>, pageItemCount: number): boolean {
  if (pageItemCount === 0) return false
  const nextPage = body.meta?.next_page
  if (nextPage != null) return Number(nextPage) > 0
  if (body.meta && 'next_page' in body.meta) return false
  return Boolean(body.links?.next)
}

/**
 * Fetches the incident timeline events, following JSON:API pagination until
 * exhausted or the event cap is reached. Returns an empty array on any failure
 * so timeline enrichment never blocks document creation.
 */
async function fetchTimelineEvents(
  accessToken: string,
  incidentId: string
): Promise<RootlyEventAttributes[]> {
  const events: RootlyEventAttributes[] = []
  let pageNumber = 1

  try {
    while (events.length < MAX_TIMELINE_EVENTS) {
      const url = `${ROOTLY_API_BASE}/incidents/${encodeURIComponent(incidentId)}/events?page[number]=${pageNumber}&page[size]=${PAGE_SIZE}`
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: buildHeaders(accessToken),
      })

      if (!response.ok) {
        logger.warn('Failed to fetch Rootly incident timeline', {
          incidentId,
          status: response.status,
        })
        break
      }

      const body = (await response.json()) as RootlyListResponse<RootlyEventResource>
      const pageEvents = body.data ?? []
      for (const event of pageEvents) {
        if (event.attributes) events.push(event.attributes)
      }

      if (!hasNextPage(body, pageEvents.length)) break
      pageNumber += 1
    }
  } catch (error) {
    logger.warn('Error fetching Rootly incident timeline', {
      incidentId,
      error: toError(error).message,
    })
  }

  if (events.length > MAX_TIMELINE_EVENTS) {
    logger.warn('Truncating Rootly incident timeline', {
      incidentId,
      fetched: events.length,
      kept: MAX_TIMELINE_EVENTS,
    })
  }

  return events.slice(0, MAX_TIMELINE_EVENTS)
}

/**
 * Extracts the retrospective body sideloaded via `include=incident_post_mortem`.
 * Both `title` and `content` are optional in the sideloaded resource, so a
 * retrospective that carries only one of them still contributes it, and an
 * incident without one contributes nothing.
 */
function extractPostMortem(
  included: RootlyIncludedResource[] | undefined
): { title?: string; content?: string } | null {
  if (!Array.isArray(included)) return null
  for (const resource of included) {
    if (resource.type !== POST_MORTEM_TYPE) continue
    const attrs = resource.attributes ?? {}
    const title = typeof attrs.title === 'string' ? attrs.title.trim() : undefined
    const content = typeof attrs.content === 'string' ? attrs.content.trim() : undefined
    if (title || content) return { title, content }
  }
  return null
}

/**
 * Renders an incident plus its timeline into plain-text content. Only sections
 * with data are emitted, so resolved incidents read cleanly while open ones omit
 * empty resolution fields.
 */
function formatIncidentContent(
  attrs: RootlyIncidentAttributes,
  events: RootlyEventAttributes[],
  postMortem: { title?: string; content?: string } | null
): string {
  const parts: string[] = []

  if (attrs.title) parts.push(`Incident: ${attrs.title}`)
  if (attrs.status) parts.push(`Status: ${attrs.status}`)
  if (attrs.kind) parts.push(`Kind: ${attrs.kind}`)

  const severityName = attrs.severity?.data?.attributes?.name
  if (severityName) parts.push(`Severity: ${severityName}`)

  const services = namedResourceLabels(attrs.services)
  if (services) parts.push(`Services: ${services.join(', ')}`)

  const teams = namedResourceLabels(attrs.groups)
  if (teams) parts.push(`Teams: ${teams.join(', ')}`)

  const environments = namedResourceLabels(attrs.environments)
  if (environments) parts.push(`Environments: ${environments.join(', ')}`)

  if (attrs.started_at) parts.push(`Started: ${attrs.started_at}`)
  if (attrs.resolved_at) parts.push(`Resolved: ${attrs.resolved_at}`)

  const summary = attrs.summary?.trim()
  if (summary) {
    parts.push('')
    parts.push('--- Summary ---')
    parts.push(summary)
  }

  const mitigation = attrs.mitigation_message?.trim()
  if (mitigation) {
    parts.push('')
    parts.push('--- Mitigation ---')
    parts.push(mitigation)
  }

  const resolution = attrs.resolution_message?.trim()
  if (resolution) {
    parts.push('')
    parts.push('--- Resolution ---')
    parts.push(resolution)
  }

  const cancellation = attrs.cancellation_message?.trim()
  if (cancellation) {
    parts.push('')
    parts.push('--- Cancellation ---')
    parts.push(cancellation)
  }

  const postMortemTitle = postMortem?.title
  const postMortemContent = postMortem?.content
  if (postMortemTitle || postMortemContent) {
    parts.push('')
    parts.push('--- Retrospective ---')
    if (postMortemTitle) parts.push(postMortemTitle)
    if (postMortemContent) parts.push(postMortemContent)
  }

  if (events.length > 0) {
    const timeline: string[] = []
    for (const event of events) {
      const text = event.event?.trim()
      if (!text) continue
      const when = event.occurred_at || event.created_at
      timeline.push(when ? `${when}: ${text}` : text)
    }
    if (timeline.length > 0) {
      parts.push('')
      parts.push('--- Timeline ---')
      parts.push(...timeline)
    }
  }

  return parts.join('\n')
}

/**
 * Builds a deferred list stub for an incident — no content, but carrying the
 * exact metadata and hash the hydrated document will produce.
 */
function incidentToStub(resource: RootlyIncidentResource): ExternalDocument | null {
  const id = resource.id
  const attrs = resource.attributes
  if (!id || !attrs) return null

  const metadata = buildMetadata(attrs)
  return {
    externalId: id,
    title: attrs.title?.trim() || `Incident ${id}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildSourceUrl(attrs),
    contentHash: buildContentHash(id, attrs.updated_at),
    metadata: { ...metadata },
  }
}

/**
 * Reads the optional `maxIncidents` cap from sourceConfig, returning 0 when
 * unset or invalid (treated as unlimited).
 */
function parseMaxIncidents(sourceConfig: Record<string, unknown>): number {
  const raw = sourceConfig.maxIncidents
  if (raw == null || raw === '') return 0
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export const rootlyConnector: ConnectorConfig = {
  ...rootlyConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const maxIncidents = parseMaxIncidents(sourceConfig)
    const status = typeof sourceConfig.status === 'string' ? sourceConfig.status.trim() : ''
    const severity = typeof sourceConfig.severity === 'string' ? sourceConfig.severity.trim() : ''
    const services = parseMultiValue(sourceConfig.services)
    const teams = parseMultiValue(sourceConfig.teams)
    const environments = parseMultiValue(sourceConfig.environments)
    const pageNumber = cursor ? Number(cursor) : 1
    const startPage = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1

    const queryParams = new URLSearchParams()
    queryParams.set('page[number]', String(startPage))
    queryParams.set('page[size]', String(PAGE_SIZE))
    queryParams.set('include', INCIDENT_INCLUDE)
    if (status) queryParams.set('filter[status]', status)
    if (severity) queryParams.set('filter[severity]', severity)
    if (services.length > 0) queryParams.set('filter[services]', services.join(','))
    if (teams.length > 0) queryParams.set('filter[teams]', teams.join(','))
    if (environments.length > 0) queryParams.set('filter[environments]', environments.join(','))

    if (lastSyncAt) {
      queryParams.set('filter[updated_at][gt]', lastSyncAt.toISOString())
      queryParams.set('sort', INCREMENTAL_SORT)
    } else {
      queryParams.set('sort', FULL_SYNC_SORT)
    }

    const url = `${ROOTLY_API_BASE}/incidents?${queryParams.toString()}`

    logger.info('Listing Rootly incidents', {
      pageNumber: startPage,
      pageSize: PAGE_SIZE,
      status: status || undefined,
      incremental: Boolean(lastSyncAt),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: buildHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Rootly incidents', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Rootly incidents: ${response.status}`)
    }

    const body = (await response.json()) as RootlyListResponse<RootlyIncidentResource>
    const incidents = body.data ?? []

    const allDocuments: ExternalDocument[] = []
    let droppedFromPage = 0
    for (const incident of incidents) {
      const stub = incidentToStub(incident)
      if (stub) {
        allDocuments.push(stub)
      } else {
        droppedFromPage += 1
      }
    }

    /**
     * An incident that arrived without an id or attributes is absent from this
     * listing even though it still exists in Rootly, so deletion reconciliation
     * must not run against a listing that dropped one.
     */
    if (droppedFromPage > 0) {
      logger.warn('Dropped malformed Rootly incidents from listing', {
        pageNumber: startPage,
        dropped: droppedFromPage,
      })
      if (syncContext) syncContext.listingCapped = true
    }

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = allDocuments
    let truncatedByCap = false
    if (maxIncidents > 0) {
      const remaining = Math.max(0, maxIncidents - prevFetched)
      if (allDocuments.length > remaining) {
        documents = allDocuments.slice(0, remaining)
        truncatedByCap = true
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const morePagesAvailable = hasNextPage(body, incidents.length)
    const hitLimit = maxIncidents > 0 && totalFetched >= maxIncidents

    /**
     * Only a cap that actually hid incidents truncates the listing. When the cap
     * lands exactly on the final page with nothing left behind, the source is
     * genuinely exhausted and deletions must still reconcile.
     */
    if (hitLimit && (truncatedByCap || morePagesAvailable) && syncContext) {
      syncContext.listingCapped = true
    }

    const hasMore = !hitLimit && morePagesAvailable

    return {
      documents,
      nextCursor: hasMore ? String(startPage + 1) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    if (!externalId) return null

    const url = `${ROOTLY_API_BASE}/incidents/${encodeURIComponent(externalId)}?include=${encodeURIComponent(INCIDENT_DETAIL_INCLUDE)}`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: buildHeaders(accessToken),
    })

    /**
     * Only a deleted incident (404/410) resolves to `null`. Every other failure
     * throws so the sync engine records a visible failed document instead of
     * dropping the incident from the run with no counter and no error log.
     */
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) return null
      throw new Error(`Failed to fetch Rootly incident: ${response.status}`)
    }

    const body = (await response.json()) as RootlyResourceResponse<RootlyIncidentResource>
    const resource = body.data
    const attrs = resource?.attributes
    const id = resource?.id
    if (!id || !attrs) return null

    const events = await fetchTimelineEvents(accessToken, id)
    const content = formatIncidentContent(attrs, events, extractPostMortem(body.included))
    if (!content.trim()) {
      logger.info('Skipping Rootly incident with no indexable content', { externalId: id })
      return null
    }
    const metadata = buildMetadata(attrs)

    return {
      externalId: id,
      title: attrs.title?.trim() || `Incident ${id}`,
      content,
      contentDeferred: false,
      mimeType: 'text/plain',
      sourceUrl: buildSourceUrl(attrs),
      contentHash: buildContentHash(id, attrs.updated_at),
      metadata: { ...metadata },
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

    try {
      const response = await fetchWithRetry(
        `${ROOTLY_API_BASE}/incidents?page[size]=1`,
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
          error: `Rootly access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
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

    if (typeof metadata.status === 'string' && metadata.status.trim()) {
      result.status = metadata.status
    }

    const severity =
      (typeof metadata.severityName === 'string' && metadata.severityName.trim()
        ? metadata.severityName
        : undefined) ??
      (typeof metadata.severityLevel === 'string' && metadata.severityLevel.trim()
        ? metadata.severityLevel
        : undefined)
    if (severity) result.severity = severity

    if (typeof metadata.kind === 'string' && metadata.kind.trim()) {
      result.kind = metadata.kind
    }

    const services = joinTagArray(metadata.services)
    if (services) result.services = services

    const teams = joinTagArray(metadata.teams)
    if (teams) result.teams = teams

    const environments = joinTagArray(metadata.environments)
    if (environments) result.environments = environments

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    const incidentDate = parseTagDate(metadata.incidentDate)
    if (incidentDate) result.incidentDate = incidentDate

    const resolvedDate = parseTagDate(metadata.resolvedDate)
    if (resolvedDate) result.resolvedDate = resolvedDate

    return result
  },
}
