import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { googleFormsConnectorMeta, MAX_RESPONSES_PER_FORM } from '@/connectors/google-forms/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  buildDriveParentsClause,
  isListingScopeUnavailableError,
  joinTagArray,
  listingRequestError,
  parseMultiValue,
  parseTagDate,
} from '@/connectors/utils'

const logger = createLogger('GoogleFormsConnector')

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const FORMS_API_BASE = 'https://forms.googleapis.com/v1'
const FORM_MIME_TYPE = 'application/vnd.google-apps.form'
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

/**
 * Drive API page size when listing forms. Drive coerces anything above 1000, but
 * 100 is used because every listed form costs one `forms.get` plus (when
 * responses are indexed) a full `forms.responses.list` walk for its change
 * indicator, so a smaller page keeps per-call Forms API volume bounded.
 */
const DRIVE_PAGE_SIZE = 100

/**
 * Responses requested per `forms.responses.list` page. 5000 is what the API
 * returns when `pageSize` is unspecified or zero; it is sent explicitly rather
 * than relying on that default. No hard maximum is documented.
 */
const RESPONSES_PAGE_SIZE = 5000

/**
 * Number of forms whose change indicators are fetched concurrently during
 * listing. Keeps the Forms API call volume bounded while still parallelizing.
 */
const LIST_CONCURRENCY = 4

/**
 * Content scope for a form document. `both` indexes the form's questions and its
 * submitted responses; `structure` indexes only the questions (no response reads,
 * so the responses scope is never exercised for that connector instance).
 */
type ContentScope = 'both' | 'structure'

/**
 * Resolves the content scope from sourceConfig, defaulting to `both`.
 */
function resolveContentScope(value: unknown): ContentScope {
  return value === 'structure' ? 'structure' : 'both'
}

/**
 * Represents a Google Drive file entry for a form, returned by the Drive API.
 */
interface DriveFormFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  createdTime?: string
  webViewLink?: string
  owners?: { displayName?: string; emailAddress?: string }[]
  trashed?: boolean
}

/**
 * A single answer entry inside a response answer container.
 */
interface FormTextAnswer {
  value?: string
}

/**
 * A single question's answers within a form response. The Forms API keys the
 * `answers` map by questionId and stores text values under
 * `textAnswers.answers[].value`.
 */
interface FormAnswer {
  questionId?: string
  textAnswers?: { answers?: FormTextAnswer[] }
}

/**
 * A single submitted response to a form.
 */
interface FormResponse {
  responseId?: string
  createTime?: string
  lastSubmittedTime?: string
  respondentEmail?: string
  answers?: Record<string, FormAnswer>
}

/**
 * Paginated response list from the Forms API.
 */
interface FormResponseList {
  responses?: FormResponse[]
  nextPageToken?: string
}

/**
 * A question item within a form's structure.
 */
interface FormQuestionItem {
  question?: {
    questionId?: string
    required?: boolean
  }
}

/**
 * A single structural item within a form (question, section, image, etc.).
 */
interface FormItem {
  itemId?: string
  title?: string
  description?: string
  questionItem?: FormQuestionItem
}

/**
 * The form structure returned by the Forms API `forms.get` endpoint.
 */
interface FormStructure {
  formId?: string
  info?: {
    title?: string
    description?: string
    documentTitle?: string
  }
  items?: FormItem[]
  revisionId?: string
  responderUri?: string
}

/**
 * Lightweight metadata captured during listing, sufficient to build a stub
 * and detect changes without downloading the full form content.
 */
interface FormStubInput {
  file: DriveFormFile
  formTitle?: string
  revisionId?: string
  latestResponseTime?: string
  contentScope: ContentScope
  responseCap: number
}

/**
 * Resolves the effective per-form response cap applied when rendering content:
 * the user-configured `maxResponsesPerForm` clamped to the hard
 * `MAX_RESPONSES_PER_FORM` ceiling. Part of the content hash so changing the
 * cap re-syncs every form (the rendered content depends on it).
 */
function resolveResponseCap(sourceConfig: Record<string, unknown>): number {
  const configured = parsePositiveInt(sourceConfig.maxResponsesPerForm)
  return configured > 0 ? Math.min(configured, MAX_RESPONSES_PER_FORM) : MAX_RESPONSES_PER_FORM
}

/**
 * Parses an optional positive-integer config value, returning 0 when unset/invalid.
 */
function parsePositiveInt(value: unknown): number {
  if (value == null || value === '') return 0
  const num = Number(value)
  return Number.isNaN(num) || num <= 0 ? 0 : Math.floor(num)
}

/**
 * Maps a small array over an async worker with a bounded concurrency, preserving
 * input order in the returned results.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function run(): Promise<void> {
    while (next < items.length) {
      const current = next++
      results[current] = await worker(items[current], current)
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, run)
  await Promise.all(runners)
  return results
}

/**
 * Fetches the form structure via the Forms API. Returns null on 404 (form
 * deleted or inaccessible).
 */
async function fetchFormStructure(
  accessToken: string,
  formId: string
): Promise<FormStructure | null> {
  const url = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch form structure ${formId}: ${response.status}`)
  }

  return (await response.json()) as FormStructure
}

/**
 * Result of scanning a form's responses: the retained responses (at most
 * `retain`, in listing order) plus the greatest submission timestamp across ALL
 * response pages.
 *
 * `latestSubmittedTime` is deliberately independent of `retain` so the change
 * indicator is identical whether listing scanned with `retain: 0` or
 * `getDocument` scanned with the configured render cap. Deriving it from the
 * retained slice alone would let a form with more responses than the cap hash
 * differently on the two paths and re-sync on every run.
 */
interface ScannedResponses {
  responses: FormResponse[]
  latestSubmittedTime?: string
}

/**
 * Walks every page of a form's responses, retaining at most `retain` of them.
 *
 * Every page is scanned for the latest submission timestamp even once `retain`
 * is satisfied — the Forms API does not guarantee response order, so the newest
 * submission may sit on any page. Listing calls this with `retain: 0` purely for
 * the change indicator; `getDocument` passes the configured render cap.
 *
 * Throws on a failed read rather than returning partial data: a swallowed error
 * would poison the stub's content hash and re-process the form on every sync,
 * while throwing routes into the per-form catch that sets `skippedOnError` →
 * `listingCapped`.
 */
async function scanFormResponses(
  accessToken: string,
  formId: string,
  retain: number
): Promise<ScannedResponses> {
  const collected: FormResponse[] = []
  let latest = ''
  let pageToken: string | undefined

  do {
    const url = new URL(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/responses`)
    url.searchParams.set('pageSize', String(RESPONSES_PAGE_SIZE))
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to list responses for form ${formId}: ${response.status}`)
    }

    const data = (await response.json()) as FormResponseList
    const responses = data.responses ?? []

    const pageLatest = latestResponseTime(responses)
    if (pageLatest && pageLatest > latest) latest = pageLatest

    for (const r of responses) {
      if (collected.length >= retain) break
      collected.push(r)
    }

    pageToken = data.nextPageToken
  } while (pageToken)

  return { responses: collected, latestSubmittedTime: latest || undefined }
}

/**
 * Returns the greatest submission timestamp across the given responses, or
 * undefined when the list is empty.
 */
function latestResponseTime(responses: FormResponse[]): string | undefined {
  let latest = ''
  for (const r of responses) {
    const t = r.lastSubmittedTime || r.createTime || ''
    if (t > latest) latest = t
  }
  return latest || undefined
}

/**
 * Builds the content hash for a form. The hash must change when either the form
 * structure (revisionId) or, when responses are indexed, the set of responses
 * (latest submission time) changes. Drive `modifiedTime` alone is insufficient
 * because new response submissions do not update the form's Drive modifiedTime.
 * The content scope is part of the hash so that toggling response indexing
 * forces a re-sync of every document.
 */
function formContentHash(input: FormStubInput): string {
  const responsePart =
    input.contentScope === 'both'
      ? `${input.latestResponseTime ?? ''}:${input.responseCap}`
      : 'none'
  return `gforms:${input.file.id}:${input.contentScope}:${input.revisionId ?? ''}:${responsePart}`
}

/**
 * Creates a lightweight stub from a form's Drive file and change indicators.
 * Content is deferred and only fetched via getDocument for new/changed forms.
 */
function formToStub(input: FormStubInput): ExternalDocument {
  const { file } = input
  const title = input.formTitle?.trim() || file.name || 'Untitled Form'
  return {
    externalId: file.id,
    title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: file.webViewLink || `https://docs.google.com/forms/d/${file.id}/edit`,
    contentHash: formContentHash(input),
    metadata: {
      formTitle: title,
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      latestResponseTime: input.contentScope === 'both' ? input.latestResponseTime : undefined,
      owners: file.owners?.map((o) => o.displayName || o.emailAddress).filter(Boolean),
    },
  }
}

/**
 * Extracts the answer values for a single question from a response.
 */
function extractAnswerText(answer: FormAnswer | undefined): string {
  const values = answer?.textAnswers?.answers
    ?.map((a) => a.value)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return values && values.length > 0 ? values.join(', ') : ''
}

/**
 * Builds a question-id → title map from the form structure, so responses can be
 * rendered with human-readable question labels instead of opaque IDs.
 */
function buildQuestionTitleMap(form: FormStructure): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of form.items ?? []) {
    const questionId = item.questionItem?.question?.questionId
    if (questionId && item.title) {
      map.set(questionId, item.title)
    }
  }
  return map
}

/**
 * Renders the full form document: its structure (title, description, questions)
 * followed by each response's question/answer pairs when responses are included.
 */
function renderFormDocument(form: FormStructure, responses: FormResponse[]): string {
  const parts: string[] = []

  const title = form.info?.title || form.info?.documentTitle
  if (title) parts.push(`# ${title}`)
  if (form.info?.description?.trim()) parts.push(form.info.description.trim())

  const questionTitles = buildQuestionTitleMap(form)

  const questionLines: string[] = []
  for (const item of form.items ?? []) {
    if (!item.title?.trim()) continue
    const required = item.questionItem?.question?.required ? ' (required)' : ''
    questionLines.push(`- ${item.title.trim()}${required}`)
    if (item.description?.trim()) questionLines.push(`  ${item.description.trim()}`)
  }
  if (questionLines.length > 0) {
    parts.push('## Questions')
    parts.push(questionLines.join('\n'))
  }

  if (responses.length > 0) {
    parts.push(`## Responses (${responses.length})`)
    responses.forEach((response, index) => {
      const responseLines: string[] = []
      const submitted = response.lastSubmittedTime || response.createTime
      const header = submitted
        ? `### Response ${index + 1} — ${submitted}`
        : `### Response ${index + 1}`
      responseLines.push(header)
      if (response.respondentEmail) {
        responseLines.push(`Respondent: ${response.respondentEmail}`)
      }
      for (const [questionId, answer] of Object.entries(response.answers ?? {})) {
        const label = questionTitles.get(questionId) || questionId
        const value = extractAnswerText(answer)
        if (value) responseLines.push(`${label}: ${value}`)
      }
      parts.push(responseLines.join('\n'))
    })
  }

  return parts.join('\n\n').trim()
}

/**
 * Builds the Drive `q` query that selects form files, optionally scoped to one
 * or more folders. Single quotes and backslashes in folder IDs are escaped to
 * prevent query injection.
 */
function buildDriveQuery(folderIds: string[]): string {
  const parts = ['trashed = false', `mimeType = '${FORM_MIME_TYPE}'`]
  const parentsClause = buildDriveParentsClause(folderIds)
  if (parentsClause) parts.push(parentsClause)
  return parts.join(' and ')
}

export const googleFormsConnector: ConnectorConfig = {
  ...googleFormsConnectorMeta,

  isListingScopeUnavailableError: isListingScopeUnavailableError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxForms = parsePositiveInt(sourceConfig.maxForms)
    const contentScope = resolveContentScope(sourceConfig.contentScope)
    const responseCap = resolveResponseCap(sourceConfig)
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    if (maxForms > 0 && previouslyFetched >= maxForms) {
      return { documents: [], hasMore: false }
    }

    const folderIds = parseMultiValue(sourceConfig.folderId)
    const queryParams = new URLSearchParams({
      q: buildDriveQuery(folderIds),
      pageSize: String(DRIVE_PAGE_SIZE),
      orderBy: 'modifiedTime desc',
      fields:
        'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    if (cursor) queryParams.set('pageToken', cursor)

    const url = `${DRIVE_API_BASE}/files?${queryParams.toString()}`

    logger.info('Listing Google Forms', {
      folderId: folderIds.length > 0 ? folderIds.join(',') : 'all',
      contentScope,
      cursor: cursor ?? 'initial',
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Google Forms', { status: response.status, error: errorText })
      throw listingRequestError('Failed to list Google Forms', response.status)
    }

    const data = await response.json()
    let files = (data.files || []) as DriveFormFile[]

    /**
     * Drive sets `incompleteSearch` when it could not search every corpus (it
     * arises with the `allDrives` scope enabled by `includeItemsFromAllDrives`).
     * A partial listing drops still-existing forms, so reconciliation must be
     * suppressed to avoid hard-deleting valid documents.
     */
    const incompleteSearch = data.incompleteSearch === true

    let slicedSome = false
    if (maxForms > 0) {
      const remaining = maxForms - previouslyFetched
      if (files.length > remaining) {
        slicedSome = true
        files = files.slice(0, remaining)
      }
    }

    /**
     * Build stubs with metadata-based change indicators. Each form needs its
     * revisionId (structure changes) and, when responses are indexed, the latest
     * response time (new submissions) so the sync engine can detect changes
     * without downloading full content. Forms are processed with bounded
     * concurrency; a transient per-form failure is skipped rather than aborting
     * the whole page, but it is recorded so the listing is marked incomplete.
     */
    let skippedOnError = false
    const stubs = await mapWithConcurrency(files, LIST_CONCURRENCY, async (file) => {
      try {
        const form = await fetchFormStructure(accessToken, file.id)
        if (!form) {
          /**
           * Drive listed this file moments ago, and Drive `q` already excluded
           * trashed files, so the Forms API 404 is far more likely to be a
           * transient read (permission propagation, eventual consistency) than a
           * deletion — and the API gives no way to tell the two apart. Treating
           * it as a truncated listing costs one deferred reconciliation; treating
           * it as absence would hard-delete a live document.
           */
          skippedOnError = true
          logger.warn(`Form not readable via Forms API during listing: ${file.name} (${file.id})`)
          return null
        }
        const latest =
          contentScope === 'both'
            ? (await scanFormResponses(accessToken, file.id, 0)).latestSubmittedTime
            : undefined
        return formToStub({
          file,
          formTitle: form.info?.title || form.info?.documentTitle,
          revisionId: form.revisionId,
          latestResponseTime: latest,
          contentScope,
          responseCap,
        })
      } catch (error) {
        skippedOnError = true
        logger.warn(`Skipping form during listing: ${file.name} (${file.id})`, {
          error: toError(error).message,
        })
        return null
      }
    })

    const documents = stubs.filter((s): s is ExternalDocument => s !== null)

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxForms > 0 && totalFetched >= maxForms

    const nextPageToken = data.nextPageToken as string | undefined

    /**
     * Mark the listing as incomplete so the sync engine skips deletion
     * reconciliation. Three cases drop still-existing forms from the listing:
     * - `slicedSome`: this page held more forms than the `maxForms` cap allowed,
     *   so forms beyond the slice were truncated. This is independent of
     *   `hitLimit`, which counts successfully fetched stubs and can fall below
     *   the cap when 404s or errors null out items even though real forms were
     *   sliced off.
     * - `hitLimit` with a next page: the cap was reached while more pages of
     *   forms remain in the source.
     * - `skippedOnError`: a transient error dropped a still-present form.
     * - `incompleteSearch`: Drive could not search every corpus, so the page
     *   itself is partial and may omit still-existing forms.
     * Deleting any of those would wipe valid documents from the knowledge base.
     * When the cap merely coincides with source exhaustion (no slice, no next
     * page), reconciliation stays enabled so deleted forms are cleaned up.
     */
    if (
      syncContext &&
      (slicedSome || (hitLimit && Boolean(nextPageToken)) || skippedOnError || incompleteSearch)
    ) {
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hitLimit ? undefined : nextPageToken,
      hasMore: hitLimit ? false : Boolean(nextPageToken),
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const contentScope = resolveContentScope(sourceConfig.contentScope)
    const fields = 'id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,trashed'
    const metadataUrl = `${DRIVE_API_BASE}/files/${encodeURIComponent(externalId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`

    const metadataResponse = await fetchWithRetry(metadataUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!metadataResponse.ok) {
      if (metadataResponse.status === 404) return null
      throw new Error(`Failed to get form metadata: ${metadataResponse.status}`)
    }

    const file = (await metadataResponse.json()) as DriveFormFile

    if (file.trashed) return null
    if (file.mimeType !== FORM_MIME_TYPE) return null

    try {
      const form = await fetchFormStructure(accessToken, file.id)
      /**
       * The Drive metadata read above already confirmed a live, untrashed form, so a
       * Forms API 404 here is an inconsistent read (permission propagation, eventual
       * consistency) rather than a deletion — the same conclusion `listDocuments`
       * reaches. Genuine deletion is observed by the form leaving the Drive listing,
       * which reconciliation handles; returning null here would hard-delete instead.
       */
      if (!form) {
        throw new Error(`Form ${file.id} is listed in Drive but not readable via the Forms API`)
      }

      const responseCap = resolveResponseCap(sourceConfig)
      const fetched =
        contentScope === 'both'
          ? await scanFormResponses(accessToken, file.id, responseCap)
          : { responses: [], latestSubmittedTime: undefined }

      const content = renderFormDocument(form, fetched.responses)
      if (!content.trim()) return null

      const stub = formToStub({
        file,
        formTitle: form.info?.title || form.info?.documentTitle,
        revisionId: form.revisionId,
        latestResponseTime: fetched.latestSubmittedTime,
        contentScope,
        responseCap,
      })
      return { ...stub, content, contentDeferred: false }
    } catch (error) {
      /**
       * Absence is already covered above (404 Drive metadata, trashed, non-form MIME
       * type). Anything reaching here is transient and must propagate so the engine
       * records a failed hydration instead of silently dropping a form that still exists.
       */
      logger.warn(`Failed to fetch content for form: ${file.name} (${file.id})`, {
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderIds = parseMultiValue(sourceConfig.folderId)
    const maxForms = sourceConfig.maxForms as string | undefined
    const maxResponsesPerForm = sourceConfig.maxResponsesPerForm as string | undefined

    if (maxForms && (Number.isNaN(Number(maxForms)) || Number(maxForms) <= 0)) {
      return { valid: false, error: 'Max forms must be a positive number' }
    }

    if (
      maxResponsesPerForm &&
      (Number.isNaN(Number(maxResponsesPerForm)) || Number(maxResponsesPerForm) <= 0)
    ) {
      return { valid: false, error: 'Max responses per form must be a positive number' }
    }

    try {
      if (folderIds.length > 0) {
        for (const folderId of folderIds) {
          const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`
          const response = await fetchWithRetry(
            url,
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
            if (response.status === 404) {
              return {
                valid: false,
                error: `Folder "${folderId}" not found. Check the folder ID and permissions.`,
              }
            }
            return {
              valid: false,
              error: `Failed to access folder "${folderId}": ${response.status}`,
            }
          }

          const folder = await response.json()
          if (folder.mimeType !== FOLDER_MIME_TYPE) {
            return { valid: false, error: `"${folderId}" is not a folder` }
          }
        }
      } else {
        const url = `${DRIVE_API_BASE}/files?pageSize=1&q=${encodeURIComponent(`mimeType = '${FORM_MIME_TYPE}'`)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`
        const response = await fetchWithRetry(
          url,
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
          return { valid: false, error: `Failed to access Google Forms: ${response.status}` }
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.formTitle === 'string' && metadata.formTitle.trim()) {
      result.formTitle = metadata.formTitle.trim()
    }

    const owners = joinTagArray(metadata.owners)
    if (owners) result.owners = owners

    const lastModified = parseTagDate(metadata.modifiedTime)
    if (lastModified) result.lastModified = lastModified

    const lastResponse = parseTagDate(metadata.latestResponseTime)
    if (lastResponse) result.lastResponse = lastResponse

    return result
  },
}
