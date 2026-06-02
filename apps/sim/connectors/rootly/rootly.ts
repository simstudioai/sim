import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { RootlyIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
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
 * JSON:API relationships to embed inline within each incident's `attributes`.
 * Rootly omits these unless requested via `include`, so both the list (stub) and
 * detail requests pass them to ensure tag metadata is identical on either path.
 * Scoped to exactly the relationships this connector reads — `environments`,
 * `services`, and `groups` (Rootly's API token for teams) — to avoid fetching
 * unused relationship payloads on every incident.
 */
const INCIDENT_INCLUDE = 'environments,services,groups'

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

/** JSON:API list envelope shared by incidents and events list endpoints. */
interface RootlyListResponse<T> {
  data?: T[]
  links?: {
    next?: string | null
  }
  meta?: {
    total_count?: number
  }
}

interface RootlyResourceResponse<T> {
  data?: T
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

      if (!body.links?.next || pageEvents.length === 0) break
      pageNumber += 1
    }
  } catch (error) {
    logger.warn('Error fetching Rootly incident timeline', {
      incidentId,
      error: toError(error).message,
    })
  }

  return events.slice(0, MAX_TIMELINE_EVENTS)
}

/**
 * Renders an incident plus its timeline into plain-text content. Only sections
 * with data are emitted, so resolved incidents read cleanly while open ones omit
 * empty resolution fields.
 */
function formatIncidentContent(
  attrs: RootlyIncidentAttributes,
  events: RootlyEventAttributes[]
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

  if (attrs.summary?.trim()) {
    parts.push('')
    parts.push('--- Summary ---')
    parts.push(attrs.summary.trim())
  }

  if (attrs.mitigation_message?.trim()) {
    parts.push('')
    parts.push('--- Mitigation ---')
    parts.push(attrs.mitigation_message.trim())
  }

  if (attrs.resolution_message?.trim()) {
    parts.push('')
    parts.push('--- Resolution ---')
    parts.push(attrs.resolution_message.trim())
  }

  if (attrs.cancellation_message?.trim()) {
    parts.push('')
    parts.push('--- Cancellation ---')
    parts.push(attrs.cancellation_message.trim())
  }

  if (events.length > 0) {
    parts.push('')
    parts.push('--- Timeline ---')
    for (const event of events) {
      if (!event.event?.trim()) continue
      const when = event.occurred_at || event.created_at
      parts.push(when ? `${when}: ${event.event.trim()}` : event.event.trim())
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
  id: 'rootly',
  name: 'Rootly',
  description: 'Sync incidents, postmortems, and timelines from Rootly',
  version: '1.0.0',
  icon: RootlyIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Rootly API key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'status',
      title: 'Filter by Status',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. resolved (default: all)',
      description: 'Only sync incidents with this status (e.g. resolved, mitigated, started).',
    },
    {
      id: 'severity',
      title: 'Filter by Severity',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. sev0 (default: all)',
      description:
        'Only sync incidents with this severity slug (e.g. sev0, sev1). Leave blank to sync all severities.',
    },
    {
      id: 'services',
      title: 'Filter by Services',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      multi: true,
      placeholder: 'Service slugs (comma-separated, default: all)',
      description: 'Only sync incidents affecting these service slugs.',
    },
    {
      id: 'teams',
      title: 'Filter by Teams',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      multi: true,
      placeholder: 'Team slugs (comma-separated, default: all)',
      description: 'Only sync incidents owned by these team slugs.',
    },
    {
      id: 'environments',
      title: 'Filter by Environments',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      multi: true,
      placeholder: 'Environment slugs (comma-separated, default: all)',
      description: 'Only sync incidents in these environment slugs.',
    },
    {
      id: 'maxIncidents',
      title: 'Max Incidents',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
  ],

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
      queryParams.set('sort', '-updated_at')
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
    for (const incident of incidents) {
      const stub = incidentToStub(incident)
      if (stub) allDocuments.push(stub)
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
    if (hitLimit && syncContext) syncContext.listingCapped = true

    const hasNextLink = Boolean(body.links?.next)
    const hasMore = !hitLimit && hasNextLink && incidents.length > 0

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
    try {
      if (!externalId) return null

      const url = `${ROOTLY_API_BASE}/incidents/${encodeURIComponent(externalId)}?include=${encodeURIComponent(INCIDENT_INCLUDE)}`
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: buildHeaders(accessToken),
      })

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
      const content = formatIncidentContent(attrs, events)
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
    } catch (error) {
      logger.warn('Failed to get Rootly incident', {
        externalId,
        error: toError(error).message,
      })
      return null
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

  tagDefinitions: [
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'severity', displayName: 'Severity', fieldType: 'text' },
    { id: 'kind', displayName: 'Kind', fieldType: 'text' },
    { id: 'services', displayName: 'Services', fieldType: 'text' },
    { id: 'teams', displayName: 'Teams', fieldType: 'text' },
    { id: 'environments', displayName: 'Environments', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'incidentDate', displayName: 'Incident Date', fieldType: 'date' },
    { id: 'resolvedDate', displayName: 'Resolved Date', fieldType: 'date' },
  ],

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
