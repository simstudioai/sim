import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { IncidentioIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('IncidentioConnector')

const INCIDENTIO_API_BASE = 'https://api.incident.io'
const PAGE_SIZE = 100
/** Cap incident updates fetched per document so a noisy incident can't blow the time budget. */
const MAX_UPDATES_PER_INCIDENT = 100

interface IncidentioNamedRef {
  id?: string
  name?: string
  /** Present on incident_status: the stable status category enum (triage/live/closed/...). */
  category?: string
  rank?: number
}

interface IncidentioCustomFieldValue {
  value_text?: string
  value_link?: string
  value_numeric?: string
  value_option?: { value?: string }
  value_catalog_entry?: { name?: string }
}

interface IncidentioCustomFieldEntry {
  custom_field?: { id?: string; name?: string; field_type?: string }
  values?: IncidentioCustomFieldValue[]
}

interface IncidentioRoleAssignment {
  role?: { id?: string; name?: string; role_type?: string }
  assignee?: { id?: string; name?: string; email?: string }
}

interface IncidentioTimestampValue {
  incident_timestamp?: { id?: string; name?: string; rank?: number }
  /**
   * The v2 API nests the timestamp string under `value.value` (an object), not a
   * flat string. A flat string is tolerated defensively for older shapes.
   */
  value?: { value?: string } | string
}

interface IncidentioIncident {
  id: string
  reference?: string
  name?: string
  summary?: string
  mode?: string
  visibility?: string
  permalink?: string
  call_url?: string
  created_at?: string
  updated_at?: string
  slack_channel_id?: string
  slack_channel_name?: string
  severity?: IncidentioNamedRef
  incident_status?: IncidentioNamedRef
  incident_type?: IncidentioNamedRef
  custom_field_entries?: IncidentioCustomFieldEntry[]
  incident_role_assignments?: IncidentioRoleAssignment[]
  incident_timestamp_values?: IncidentioTimestampValue[]
}

interface IncidentioPaginationMeta {
  after?: string
  page_size?: number
  total_record_count?: number
}

interface IncidentioIncidentsListResponse {
  incidents?: IncidentioIncident[]
  pagination_meta?: IncidentioPaginationMeta
}

interface IncidentioIncidentShowResponse {
  incident?: IncidentioIncident
}

/**
 * incident.io ActorV2: the entity behind an action, used for incident update
 * authors. The v2 API documents this as an ActorV2 with exactly one of the
 * nested `user`/`api_key`/`workflow`/`alert` variants populated. A flat
 * `{ name, email }` shape is also tolerated defensively; we read whichever is
 * present so the author resolves regardless of which form the API returns.
 */
interface IncidentioActor {
  user?: { id?: string; name?: string; email?: string }
  api_key?: { id?: string; name?: string }
  alert?: { id?: string; title?: string }
  workflow?: { id?: string; name?: string }
  name?: string
  email?: string
}

interface IncidentioUpdate {
  id?: string
  message?: string
  new_severity?: IncidentioNamedRef
  /**
   * The status change on an update. The v2 API documents `new_incident_status`,
   * but a flat `new_status` shape also appears in the wild; both are read.
   */
  new_incident_status?: IncidentioNamedRef
  new_status?: IncidentioNamedRef
  updater?: IncidentioActor
  /** Some responses use `author` instead of `updater`; both are read. */
  author?: IncidentioActor
  created_at?: string
}

/**
 * Resolves a human-readable display name for an update author, covering the
 * ActorV2 variants and the flat `{ name, email }` shape.
 */
function actorName(actor: IncidentioActor | undefined): string | undefined {
  if (!actor) return undefined
  return (
    actor.user?.name ||
    actor.user?.email ||
    actor.api_key?.name ||
    actor.workflow?.name ||
    actor.alert?.title ||
    actor.name ||
    actor.email ||
    undefined
  )
}

interface IncidentioUpdatesListResponse {
  incident_updates?: IncidentioUpdate[]
  pagination_meta?: IncidentioPaginationMeta
}

/**
 * Builds the metadata-based content hash for an incident.
 *
 * Uses only the incident `updated_at` timestamp, which incident.io bumps whenever any
 * field, role assignment, custom field, or status changes. This guarantees the hash is
 * identical whether produced from the list stub or the fully-hydrated getDocument result,
 * so the sync engine can detect changes without downloading content.
 */
function buildContentHash(incident: IncidentioIncident): string {
  return `incidentio:${incident.id}:${incident.updated_at ?? ''}`
}

/**
 * Builds the public URL for an incident, preferring the API-provided permalink.
 */
function buildSourceUrl(incident: IncidentioIncident): string | undefined {
  return incident.permalink || undefined
}

/**
 * Derives the document title from the incident reference and name.
 */
function buildTitle(incident: IncidentioIncident): string {
  const name = incident.name?.trim()
  const reference = incident.reference?.trim()
  if (reference && name) return `${reference}: ${name}`
  return name || reference || 'Untitled Incident'
}

/**
 * Collects the source-specific metadata fed to mapTags. Shared between the list stub
 * and getDocument so tag values stay consistent regardless of which path produced the doc.
 */
function buildMetadata(incident: IncidentioIncident): Record<string, unknown> {
  const lead = incident.incident_role_assignments?.find(
    (assignment) => assignment.role?.role_type === 'lead'
  )
  const reporter = incident.incident_role_assignments?.find(
    (assignment) => assignment.role?.role_type === 'reporter'
  )
  const reportedBy = (reporter ?? lead)?.assignee?.name

  return {
    reference: incident.reference,
    status: incident.incident_status?.name,
    statusCategory: incident.incident_status?.category,
    severity: incident.severity?.name,
    incidentType: incident.incident_type?.name,
    mode: incident.mode,
    visibility: incident.visibility,
    incidentDate: incident.created_at,
    reportedBy,
  }
}

/**
 * Renders a single custom field value to a human-readable string, covering each of
 * incident.io's value variants (text, link, numeric, select option, catalog entry).
 */
function renderCustomFieldValue(value: IncidentioCustomFieldValue): string | undefined {
  if (value.value_text) return htmlToPlainText(value.value_text)
  if (value.value_link) return value.value_link
  if (value.value_numeric) return value.value_numeric
  if (value.value_option?.value) return value.value_option.value
  if (value.value_catalog_entry?.name) return value.value_catalog_entry.name
  return undefined
}

/**
 * Formats the incident, its custom fields, role assignments, timeline, and status
 * updates into a single plain-text document. HTML in summary / custom field text is
 * stripped via htmlToPlainText.
 */
function formatIncidentContent(incident: IncidentioIncident, updates: IncidentioUpdate[]): string {
  const parts: string[] = []

  parts.push(`Incident: ${buildTitle(incident)}`)
  if (incident.incident_status?.name) parts.push(`Status: ${incident.incident_status.name}`)
  if (incident.severity?.name) parts.push(`Severity: ${incident.severity.name}`)
  if (incident.incident_type?.name) parts.push(`Type: ${incident.incident_type.name}`)
  if (incident.created_at) parts.push(`Reported: ${incident.created_at}`)

  if (incident.summary?.trim()) {
    parts.push('')
    parts.push('--- Summary ---')
    parts.push(htmlToPlainText(incident.summary))
  }

  const roleLines = (incident.incident_role_assignments ?? [])
    .map((assignment) => {
      const role = assignment.role?.name
      const assignee = assignment.assignee?.name || assignment.assignee?.email
      if (!role || !assignee) return undefined
      return `${role}: ${assignee}`
    })
    .filter((line): line is string => Boolean(line))
  if (roleLines.length > 0) {
    parts.push('')
    parts.push('--- Roles ---')
    parts.push(...roleLines)
  }

  const customFieldLines = (incident.custom_field_entries ?? [])
    .map((entry) => {
      const name = entry.custom_field?.name
      if (!name) return undefined
      const rendered = (entry.values ?? [])
        .map(renderCustomFieldValue)
        .filter((v): v is string => Boolean(v))
      if (rendered.length === 0) return undefined
      return `${name}: ${rendered.join(', ')}`
    })
    .filter((line): line is string => Boolean(line))
  if (customFieldLines.length > 0) {
    parts.push('')
    parts.push('--- Custom Fields ---')
    parts.push(...customFieldLines)
  }

  const timestampLines = (incident.incident_timestamp_values ?? [])
    .map((entry) => {
      const name = entry.incident_timestamp?.name
      const value = typeof entry.value === 'string' ? entry.value : entry.value?.value
      if (!name || !value) return undefined
      return `${name}: ${value}`
    })
    .filter((line): line is string => Boolean(line))
  if (timestampLines.length > 0) {
    parts.push('')
    parts.push('--- Timeline ---')
    parts.push(...timestampLines)
  }

  if (updates.length > 0) {
    parts.push('')
    parts.push('--- Updates ---')
    for (const update of updates) {
      const segments: string[] = []
      if (update.created_at) segments.push(`[${update.created_at}]`)
      const author = actorName(update.updater ?? update.author)
      if (author) segments.push(author)
      const changes: string[] = []
      const newStatusName = update.new_incident_status?.name ?? update.new_status?.name
      if (newStatusName) {
        changes.push(`status → ${newStatusName}`)
      }
      if (update.new_severity?.name) changes.push(`severity → ${update.new_severity.name}`)
      const message = update.message ? htmlToPlainText(update.message) : ''
      const tail = [changes.join(', '), message].filter(Boolean).join(' — ')
      const line = [segments.join(' '), tail].filter(Boolean).join(': ')
      if (line.trim()) parts.push(line)
    }
  }

  return parts.join('\n').trim()
}

/**
 * Creates a lightweight document stub from a list entry. No API calls — content is
 * deferred to getDocument and only fetched for new or changed incidents.
 */
function incidentToStub(incident: IncidentioIncident): ExternalDocument {
  return {
    externalId: incident.id,
    title: buildTitle(incident),
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildSourceUrl(incident),
    contentHash: buildContentHash(incident),
    metadata: buildMetadata(incident),
  }
}

/**
 * Fetches all status updates for an incident, following the `after` cursor and capping
 * the total to keep getDocument bounded for very long-running incidents.
 */
async function fetchIncidentUpdates(
  accessToken: string,
  incidentId: string
): Promise<IncidentioUpdate[]> {
  const updates: IncidentioUpdate[] = []
  let after: string | undefined

  while (updates.length < MAX_UPDATES_PER_INCIDENT) {
    const url = new URL(`${INCIDENTIO_API_BASE}/v2/incident_updates`)
    url.searchParams.set('incident_id', incidentId)
    url.searchParams.set('page_size', String(PAGE_SIZE))
    if (after) url.searchParams.set('after', after)

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch incident updates', { incidentId, status: response.status })
      break
    }

    const data = (await response.json()) as IncidentioUpdatesListResponse
    const page = data.incident_updates ?? []
    updates.push(...page)

    after = data.pagination_meta?.after?.trim() || undefined
    if (!after || page.length === 0) break
  }

  return updates.slice(0, MAX_UPDATES_PER_INCIDENT)
}

export const incidentioConnector: ConnectorConfig = {
  id: 'incidentio',
  name: 'incident.io',
  description: 'Sync incidents and postmortems from incident.io into your knowledge base',
  version: '1.0.0',
  icon: IncidentioIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your incident.io API key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'statusCategory',
      title: 'Status Category',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'All', id: '' },
        { label: 'Live (active)', id: 'live' },
        { label: 'Paused', id: 'paused' },
        { label: 'Closed', id: 'closed' },
        { label: 'Triage', id: 'triage' },
        { label: 'Learning (post-incident)', id: 'learning' },
        { label: 'Declined', id: 'declined' },
        { label: 'Merged', id: 'merged' },
        { label: 'Canceled', id: 'canceled' },
      ],
      description:
        'Only sync incidents in this status category. Leave as All to sync every category.',
    },
    {
      id: 'mode',
      title: 'Mode',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'All', id: '' },
        { label: 'Standard (real incidents)', id: 'standard' },
        { label: 'Retrospective', id: 'retrospective' },
        { label: 'Test', id: 'test' },
        { label: 'Tutorial', id: 'tutorial' },
      ],
      description:
        'Only sync incidents of this mode. Use Standard to exclude test/tutorial incidents.',
    },
    {
      id: 'maxIncidents',
      title: 'Max Incidents',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
      description: 'Cap the number of incidents synced. Leave empty to sync all incidents.',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const maxIncidents = sourceConfig.maxIncidents ? Number(sourceConfig.maxIncidents) : 0

    const statusCategory =
      typeof sourceConfig.statusCategory === 'string' ? sourceConfig.statusCategory.trim() : ''
    const mode = typeof sourceConfig.mode === 'string' ? sourceConfig.mode.trim() : ''

    const url = new URL(`${INCIDENTIO_API_BASE}/v2/incidents`)
    url.searchParams.set('page_size', String(PAGE_SIZE))
    url.searchParams.set('sort_by', 'created_at_oldest_first')
    if (cursor) url.searchParams.set('after', cursor)
    if (lastSyncAt) url.searchParams.set('updated_at[gte]', lastSyncAt.toISOString())
    if (statusCategory) url.searchParams.set('status_category[one_of]', statusCategory)
    if (mode) url.searchParams.set('mode[one_of]', mode)

    logger.info('Listing incident.io incidents', {
      cursor: cursor ?? 'initial',
      incremental: Boolean(lastSyncAt),
      maxIncidents,
    })

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list incident.io incidents', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list incident.io incidents: ${response.status}`)
    }

    const data = (await response.json()) as IncidentioIncidentsListResponse
    const incidents = (data.incidents ?? []).filter((incident) => Boolean(incident.id))

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = incidents.map(incidentToStub)
    if (maxIncidents > 0) {
      const remaining = Math.max(0, maxIncidents - prevFetched)
      if (documents.length > remaining) {
        documents = documents.slice(0, remaining)
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxIncidents > 0 && totalFetched >= maxIncidents
    if (hitLimit && syncContext) syncContext.listingCapped = true

    const after = data.pagination_meta?.after?.trim() || undefined
    const hasMore = !hitLimit && Boolean(after)

    return {
      documents,
      nextCursor: hasMore ? after : undefined,
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

      const url = `${INCIDENTIO_API_BASE}/v2/incidents/${encodeURIComponent(externalId)}`

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 404 || response.status === 410) return null
        throw new Error(`Failed to fetch incident.io incident: ${response.status}`)
      }

      const data = (await response.json()) as IncidentioIncidentShowResponse
      const incident = data.incident
      if (!incident?.id) return null

      const updates = await fetchIncidentUpdates(accessToken, incident.id)
      const content = formatIncidentContent(incident, updates)
      if (!content.trim()) return null

      return {
        externalId: incident.id,
        title: buildTitle(incident),
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: buildSourceUrl(incident),
        contentHash: buildContentHash(incident),
        metadata: buildMetadata(incident),
      }
    } catch (error) {
      logger.warn('Failed to get incident.io incident', {
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
        `${INCIDENTIO_API_BASE}/v2/incidents?page_size=1`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `incident.io access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
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
    { id: 'statusCategory', displayName: 'Status Category', fieldType: 'text' },
    { id: 'severity', displayName: 'Severity', fieldType: 'text' },
    { id: 'incidentType', displayName: 'Incident Type', fieldType: 'text' },
    { id: 'mode', displayName: 'Mode', fieldType: 'text' },
    { id: 'visibility', displayName: 'Visibility', fieldType: 'text' },
    { id: 'incidentDate', displayName: 'Incident Date', fieldType: 'date' },
    { id: 'reportedBy', displayName: 'Reported By', fieldType: 'text' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.status === 'string' && metadata.status.trim()) {
      result.status = metadata.status
    }

    if (typeof metadata.statusCategory === 'string' && metadata.statusCategory.trim()) {
      result.statusCategory = metadata.statusCategory
    }

    if (typeof metadata.severity === 'string' && metadata.severity.trim()) {
      result.severity = metadata.severity
    }

    if (typeof metadata.incidentType === 'string' && metadata.incidentType.trim()) {
      result.incidentType = metadata.incidentType
    }

    if (typeof metadata.mode === 'string' && metadata.mode.trim()) {
      result.mode = metadata.mode
    }

    if (typeof metadata.visibility === 'string' && metadata.visibility.trim()) {
      result.visibility = metadata.visibility
    }

    const incidentDate = parseTagDate(metadata.incidentDate)
    if (incidentDate) result.incidentDate = incidentDate

    if (typeof metadata.reportedBy === 'string' && metadata.reportedBy.trim()) {
      result.reportedBy = metadata.reportedBy
    }

    return result
  },
}
