import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { typeformConnectorMeta } from '@/connectors/typeform/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('TypeformConnector')

const TYPEFORM_API_BASE = 'https://api.typeform.com'
/** Typeform allows page_size up to 1000; 100 keeps per-batch memory bounded. */
const RESPONSES_PER_PAGE = 100

/**
 * Connector-local choices mapped onto the Responses API `response_type` filter.
 * The API accepts a comma-separated list of `started`, `partial`, `completed` and
 * defaults to `completed` when the parameter is omitted, so `all` must be sent
 * explicitly rather than by omission.
 */
type ResponseTypeChoice = 'completed' | 'partial' | 'all'

/**
 * A single field definition from the Typeform form structure.
 */
interface TypeformField {
  id: string
  ref?: string
  title?: string
  type?: string
}

/**
 * The relevant subset of a Typeform form definition.
 */
interface TypeformFormDefinition {
  id: string
  title?: string
  fields?: TypeformField[]
  _links?: { display?: string }
}

/**
 * A single answer within a Typeform response. Only the value-bearing keys for
 * each answer `type` are declared explicitly; the remainder are optional.
 */
interface TypeformAnswer {
  field?: { id?: string; type?: string; ref?: string }
  type?: string
  text?: string
  email?: string
  url?: string
  phone_number?: string
  file_url?: string
  number?: number
  boolean?: boolean
  date?: string
  choice?: { label?: string; other?: string }
  choices?: { labels?: string[]; other?: string }
  payment?: { amount?: string; last4?: string; name?: string; success?: boolean }
  signature?: { url?: string; type?: string }
  multi_format?: {
    video_url?: string
    video_transcript?: string
    audio_url?: string
    audio_transcript?: string
  }
}

/**
 * A single variable captured with a response. Each entry carries a `key`, a
 * `type` of `text` or `number`, and the value under the property named by that
 * type — there is no generic `value` property.
 */
interface TypeformVariable {
  key?: string
  type?: string
  text?: string
  number?: number
}

/**
 * A single Typeform response item.
 *
 * `token` is the cursor field consumed by the `before`/`after` query params, while
 * `response_id` is the identifier consumed by `included_response_ids`. They are
 * distinct values, so both are tracked: the externalId is keyed off `response_id`
 * (used by getDocument), the pagination cursor off `token`.
 */
interface TypeformResponseItem {
  response_id?: string
  token: string
  landed_at?: string
  submitted_at?: string
  metadata?: {
    platform?: string
    browser?: string
    referer?: string
  }
  answers?: TypeformAnswer[] | null
  hidden?: Record<string, unknown> | null
  variables?: TypeformVariable[] | null
}

/**
 * Formats a Date for Typeform's `since`/`until` filters, which the docs example
 * as second-precision ISO 8601 (`2020-03-20T14:00:59`). Dropping the milliseconds
 * `toISOString()` emits rounds down, and both filters are inclusive, so the
 * window can only widen — never skip a response.
 */
function toTypeformTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

/**
 * Reads the `response_type` choice from sourceConfig, defaulting to `completed`.
 */
function getResponseTypeChoice(sourceConfig: Record<string, unknown>): ResponseTypeChoice {
  const value =
    typeof sourceConfig.responseType === 'string' ? sourceConfig.responseType.trim() : ''
  if (value === 'partial' || value === 'all') return value
  return 'completed'
}

/**
 * Appends the `response_type` filter for a given choice. Omitting the parameter
 * would fall back to the API default of `completed` only, so every choice is sent
 * explicitly.
 *
 * Typeform documents exactly two members: "It is expected to be passed as a comma
 * separated list of values, e.g. `response_type=partial,completed`", defaulting to
 * `completed`. There is no documented `started` member — the `sort` docs imply a
 * started *state* exists (ordering falls back to `landed_at`), but that does not
 * make it a valid filter value, and sending an undocumented member risks a 400
 * that fails the entire sync. `all` therefore requests the widest documented set,
 * which is the same as `partial`.
 */
function appendResponseType(params: URLSearchParams, choice: ResponseTypeChoice): void {
  if (choice === 'partial' || choice === 'all') {
    params.append('response_type', 'partial,completed')
  } else {
    params.append('response_type', 'completed')
  }
}

/**
 * Renders a single answer's value into a human-readable string.
 */
function renderAnswerValue(answer: TypeformAnswer): string {
  switch (answer.type) {
    case 'text':
      return answer.text ?? ''
    case 'email':
      return answer.email ?? ''
    case 'url':
      return answer.url ?? ''
    case 'phone_number':
      return answer.phone_number ?? ''
    case 'file_url':
      return answer.file_url ?? ''
    case 'number':
      return answer.number != null ? String(answer.number) : ''
    case 'boolean':
      return answer.boolean != null ? (answer.boolean ? 'Yes' : 'No') : ''
    case 'date':
      return answer.date ?? ''
    case 'choice': {
      const parts = [answer.choice?.label, answer.choice?.other].filter(Boolean)
      return parts.join(', ')
    }
    case 'choices': {
      const labels = Array.isArray(answer.choices?.labels) ? (answer.choices?.labels ?? []) : []
      const parts = [...labels]
      if (answer.choices?.other) parts.push(answer.choices.other)
      return parts.join(', ')
    }
    case 'payment':
      return answer.payment?.amount ?? ''
    case 'signature':
      return answer.signature?.url ?? ''
    case 'multi_format': {
      /**
       * A `multi_format` answer carries an audio or video recording plus the
       * transcript Typeform generated for it. The transcript is the indexable
       * part; the URL is the fallback when no transcript was produced.
       */
      const m = answer.multi_format
      return m?.video_transcript || m?.audio_transcript || m?.video_url || m?.audio_url || ''
    }
    default:
      return renderUnknownAnswerValue(answer)
  }
}

/**
 * Best-effort rendering for an answer whose `type` this connector does not model.
 * Every documented Typeform answer stores its value under a property named by the
 * answer's own `type`, either as a scalar or as an object with a `url`/`label`,
 * so a new variant degrades to partial content instead of vanishing.
 */
function renderUnknownAnswerValue(answer: TypeformAnswer): string {
  const key = answer.type
  if (!key) return ''
  const value = (answer as Record<string, unknown>)[key]
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value && typeof value === 'object') {
    const { url, label } = value as { url?: unknown; label?: unknown }
    if (typeof label === 'string') return label
    if (typeof url === 'string') return url
  }
  return ''
}

/**
 * Builds a map of field id to its human-readable question title from a form definition.
 */
function buildFieldTitleMap(form: TypeformFormDefinition): Map<string, string> {
  const map = new Map<string, string>()
  for (const field of form.fields ?? []) {
    if (field.id) map.set(field.id, field.title || field.id)
  }
  return map
}

/**
 * Renders a Typeform response as readable "Question: Answer" plain text.
 */
function renderResponseContent(
  form: TypeformFormDefinition,
  response: TypeformResponseItem,
  fieldTitles: Map<string, string>
): string {
  const parts: string[] = []

  if (form.title) parts.push(`Form: ${form.title}`)
  if (response.submitted_at) parts.push(`Submitted: ${response.submitted_at}`)
  parts.push('')

  const answers = Array.isArray(response.answers) ? response.answers : []
  for (const answer of answers) {
    const fieldId = answer.field?.id
    const question = (fieldId && fieldTitles.get(fieldId)) || fieldId || 'Answer'
    const value = renderAnswerValue(answer)
    parts.push(`${question}: ${value}`)
  }

  if (response.hidden && Object.keys(response.hidden).length > 0) {
    parts.push('')
    parts.push('--- Hidden Fields ---')
    for (const [key, val] of Object.entries(response.hidden)) {
      parts.push(`${key}: ${String(val)}`)
    }
  }

  const variables = Array.isArray(response.variables) ? response.variables : []
  if (variables.length > 0) {
    parts.push('')
    parts.push('--- Variables ---')
    for (const variable of variables) {
      if (!variable?.key) continue
      const value = variable.text ?? variable.number
      parts.push(`${variable.key}: ${value != null ? String(value) : ''}`)
    }
  }

  return parts.join('\n')
}

/**
 * Derives the stable external identifier for a response. Prefers `response_id`
 * (the identifier `included_response_ids` filters on, so getDocument can fetch the
 * exact response) and falls back to `token` when `response_id` is absent.
 */
function getResponseExternalId(response: TypeformResponseItem): string {
  return response.response_id || response.token
}

/**
 * Produces the metadata-based content hash for a response. Responses are immutable
 * once submitted, so `submitted_at` is a stable change key. For not-yet-submitted
 * (started/partial) responses, `landed_at` is used as the fallback indicator.
 */
function getResponseContentHash(response: TypeformResponseItem): string {
  const indicator = response.submitted_at || response.landed_at || ''
  return `typeform:${getResponseExternalId(response)}:${indicator}`
}

/**
 * Builds a full ExternalDocument from a rendered response.
 */
function responseToDocument(
  form: TypeformFormDefinition,
  response: TypeformResponseItem,
  fieldTitles: Map<string, string>
): ExternalDocument {
  const externalId = getResponseExternalId(response)
  const submittedAt = response.submitted_at
  const displayUrl = form._links?.display

  return {
    externalId,
    title: `${form.title || 'Typeform'} — ${submittedAt || response.landed_at || externalId}`,
    content: renderResponseContent(form, response, fieldTitles),
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: displayUrl || undefined,
    contentHash: getResponseContentHash(response),
    metadata: {
      formId: form.id,
      formTitle: form.title,
      submittedAt,
      landedAt: response.landed_at,
      platform: response.metadata?.platform,
    },
  }
}

/**
 * Fetches a form definition, caching it in syncContext keyed by form id so a
 * single sync run fetches each form's structure only once.
 */
async function getFormDefinition(
  accessToken: string,
  formId: string,
  syncContext?: Record<string, unknown>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<TypeformFormDefinition> {
  const cacheKey = `form:${formId}`
  const cached = syncContext?.[cacheKey] as TypeformFormDefinition | undefined
  if (cached) return cached

  const response = await fetchWithRetry(
    `${TYPEFORM_API_BASE}/forms/${encodeURIComponent(formId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch Typeform form ${formId}: ${response.status}`)
  }

  const form = (await response.json()) as TypeformFormDefinition
  if (syncContext) syncContext[cacheKey] = form
  return form
}

export const typeformConnector: ConnectorConfig = {
  ...typeformConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const formId = (sourceConfig.formId as string)?.trim()
    if (!formId) {
      throw new Error('Form ID is required')
    }
    const maxResponses = sourceConfig.maxResponses ? Number(sourceConfig.maxResponses) : 0

    const form = await getFormDefinition(accessToken, formId, syncContext)
    const fieldTitles = buildFieldTitleMap(form)

    const queryParams = new URLSearchParams()
    queryParams.append('page_size', String(RESPONSES_PER_PAGE))
    appendResponseType(queryParams, getResponseTypeChoice(sourceConfig))

    const since = typeof sourceConfig.since === 'string' ? sourceConfig.since.trim() : ''
    const until = typeof sourceConfig.until === 'string' ? sourceConfig.until.trim() : ''
    const search = typeof sourceConfig.query === 'string' ? sourceConfig.query.trim() : ''
    if (until) queryParams.append('until', until)
    if (search) queryParams.append('query', search)

    /**
     * `since` from the user config wins; otherwise incremental sync derives it
     * from lastSyncAt. `since` narrows the set by date while `before` (token
     * paging) walks it newest-to-oldest. Which timestamp `since`/`until` filter
     * on depends on `response_type`: `submitted_at` when completed responses are
     * requested, `staged_at` for partial, `landed_at` otherwise. The docs name
     * `since`/`until` and `before`/`after` as the two ways to scope a form with
     * more than 1000 responses, so the connector combines both.
     */
    if (since) queryParams.append('since', since)
    else if (lastSyncAt) queryParams.append('since', toTypeformTimestamp(lastSyncAt))

    if (cursor) {
      queryParams.append('before', cursor)
    }

    const url = `${TYPEFORM_API_BASE}/forms/${encodeURIComponent(formId)}/responses?${queryParams.toString()}`

    logger.info('Listing Typeform responses', {
      formId,
      before: cursor,
      incremental: Boolean(lastSyncAt),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Typeform responses', {
        formId,
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Typeform responses: ${response.status}`)
    }

    const data = (await response.json()) as { items?: TypeformResponseItem[] }
    const items = Array.isArray(data.items) ? data.items.filter((item) => item?.token) : []

    const prevTotal = (syncContext?.totalDocsFetched as number) ?? 0

    /**
     * Trim the page to the remaining `maxResponses` budget so the cap is honored
     * exactly rather than overshooting by up to a full page. The `before` cursor
     * is still derived from the untrimmed page below, but it is unused once the
     * cap is hit because `hasMore` becomes false.
     */
    let cappedItems = items
    let slicedSome = false
    if (maxResponses > 0) {
      const remaining = Math.max(0, maxResponses - prevTotal)
      if (items.length > remaining) {
        slicedSome = true
        cappedItems = items.slice(0, remaining)
      }
    }

    const documents: ExternalDocument[] = cappedItems.map((item) =>
      responseToDocument(form, item, fieldTitles)
    )

    const totalFetched = prevTotal + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxResponses > 0 && totalFetched >= maxResponses

    /**
     * The `before` cursor is the response `token` (not `response_id`). Each full
     * page advances to the oldest token seen so the next request pages strictly
     * older responses. A short page or a missing token ends pagination, which also
     * guards against an infinite loop if the API ever repeats a cursor.
     */
    const lastItem = items[items.length - 1]
    const nextCursor = lastItem?.token
    const sourceHasMore = items.length === RESPONSES_PER_PAGE && Boolean(nextCursor)

    /**
     * Signal a truncated listing so the engine skips deletion reconciliation —
     * but only when the cap actually dropped responses (this page was sliced, or
     * the source had more pages). If the cap merely coincides with source
     * exhaustion, reconciliation stays enabled so deleted responses are cleaned up.
     */
    if (hitLimit && (slicedSome || sourceHasMore) && syncContext) {
      syncContext.listingCapped = true
    }

    const hasMore = !hitLimit && sourceHasMore

    return {
      documents,
      nextCursor: hasMore ? nextCursor : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const formId = (sourceConfig.formId as string)?.trim()
    /**
     * A misconfigured source is a failure, not an absent response. Returning
     * `null` reads as documented absence, which on an `add` drops the document
     * with no counter and no log. `listDocuments` throws on the same condition.
     */
    if (!formId) throw new Error('Form ID is required')
    if (!externalId) throw new Error('Response ID is required')

    const form = await getFormDefinition(accessToken, formId, syncContext)
    const fieldTitles = buildFieldTitleMap(form)

    /**
     * `included_response_ids` filters by `response_id`, matching the externalId
     * minted in listDocuments. The configured response_type is forwarded so a
     * partial response stays fetchable (the endpoint defaults to completed-only,
     * which would otherwise exclude it).
     */
    const params = new URLSearchParams()
    params.append('included_response_ids', externalId)
    appendResponseType(params, getResponseTypeChoice(sourceConfig))

    const url = `${TYPEFORM_API_BASE}/forms/${encodeURIComponent(formId)}/responses?${params.toString()}`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    /**
     * Only a deleted form/response (404, or an empty match below) resolves to
     * `null`. Every other failure throws so the sync engine records a visible
     * failed document instead of dropping the response with no counter.
     */
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to fetch Typeform response ${externalId}: ${response.status}`)
    }

    const data = (await response.json()) as { items?: TypeformResponseItem[] }
    const item = Array.isArray(data.items)
      ? data.items.find((candidate) => getResponseExternalId(candidate) === externalId)
      : undefined
    if (!item) return null

    return responseToDocument(form, item, fieldTitles)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const formId = (sourceConfig.formId as string)?.trim()
    if (!formId) {
      return { valid: false, error: 'Form ID is required' }
    }

    const maxResponses = sourceConfig.maxResponses as string | undefined
    if (maxResponses && (Number.isNaN(Number(maxResponses)) || Number(maxResponses) <= 0)) {
      return { valid: false, error: 'Max responses must be a positive number' }
    }

    const since = typeof sourceConfig.since === 'string' ? sourceConfig.since.trim() : ''
    if (since && Number.isNaN(new Date(since).getTime())) {
      return { valid: false, error: '"Submitted After" must be a valid ISO 8601 date' }
    }

    const until = typeof sourceConfig.until === 'string' ? sourceConfig.until.trim() : ''
    if (until && Number.isNaN(new Date(until).getTime())) {
      return { valid: false, error: '"Submitted Before" must be a valid ISO 8601 date' }
    }

    if (since && until && new Date(since).getTime() > new Date(until).getTime()) {
      return { valid: false, error: '"Submitted After" must not be later than "Submitted Before"' }
    }

    try {
      const response = await fetchWithRetry(
        `${TYPEFORM_API_BASE}/forms/${encodeURIComponent(formId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: 'Invalid or unauthorized Typeform personal access token' }
      }
      if (response.status === 404) {
        return { valid: false, error: `Form not found: ${formId}` }
      }
      if (!response.ok) {
        return { valid: false, error: `Failed to validate Typeform form: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.formTitle === 'string' && metadata.formTitle) {
      result.formTitle = metadata.formTitle
    }

    if (typeof metadata.platform === 'string' && metadata.platform) {
      result.platform = metadata.platform
    }

    const submittedAt = parseTagDate(metadata.submittedAt)
    if (submittedAt) result.submittedAt = submittedAt

    return result
  },
}
