import type {
  AgiloftAsyncStatusParams,
  AgiloftAttachmentInfoParams,
  AgiloftBaseParams,
  AgiloftCredentials,
  AgiloftGetChoiceLineIdParams,
  AgiloftListTablesParams,
  AgiloftLockRecordParams,
  AgiloftNlpSearchParams,
  AgiloftRemoveAttachmentParams,
  AgiloftRetrieveAttachmentParams,
  AgiloftRunActionButtonParams,
  AgiloftSelectRecordsParams,
  AgiloftUpsertRecordParams,
} from '@/tools/agiloft/types'
import type { HttpMethod } from '@/tools/types'

/**
 * Asks the JSON decorator for real HTTP status codes. Without it Agiloft
 * answers 200 even on failure, which is what forces callers to infer errors
 * from the body shape.
 */
export const AGILOFT_JSON_ERROR_CODES = 'err_code_resp=1'

/**
 * Reduces an Agiloft error body to its message.
 *
 * Failures arrive as an HTML document wrapping a typed exception and an
 * internal task id — `<html>…EWWrongDataException has occurred:
 * [default task-70331][1786479740423] One has to specify $table…</html>` —
 * none of which helps the person reading the workflow log.
 */
export function describeAgiloftError(body: string): string {
  const text = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const typed = /(EW[A-Za-z]*Exception)\s*(?:has occurred)?\s*:?\s*(.*)/.exec(text)
  if (!typed) return text

  const detail = typed[2].replace(/^(\[[^\]]*\]\s*)+/, '').trim()
  return detail ? `${typed[1]}: ${detail}` : typed[1]
}

/**
 * Strips the instance credentials out of any text relayed to the caller.
 *
 * The credentials for the operations that accept them travel in the request
 * body, and an Agiloft error page or an intermediary that echoes submitted form
 * parameters would carry them straight back. Anything derived from an upstream
 * response or a transport error goes through here before it reaches a workflow
 * result or a log.
 */
export function redactAgiloftSecrets(
  message: string,
  credentials: { login: string; password: string }
): string {
  let safe = message
  for (const secret of [credentials.password, credentials.login]) {
    if (secret) safe = safe.split(secret).join('[redacted]')
  }
  return safe
}

/** Language sent on every Agiloft call; EWLogin rejects the request without it. */
export const AGILOFT_LANG = 'en'

/**
 * Base URL for the `/ewws/alrest/{KB}` REST surface, which is the one that
 * accepts the token EWLogin issues. The legacy `/ewws/EW*` endpoints expect
 * inline `$login`/`$password` credentials instead and reject a bearer token.
 */
export function agiloftAlrestBase(instanceUrl: string, knowledgeBase: string): string {
  return `${instanceUrl.replace(/\/$/, '')}/ewws/alrest/${encodeURIComponent(knowledgeBase)}`
}

/** Table segment of an alrest path. */
function tableSegment(table: string): string {
  return encodeURIComponent(table.trim())
}

export function alrestRecordUrl(base: string, table: string, recordId: string): string {
  return `${base}/${tableSegment(table)}/${encodeURIComponent(recordId.trim())}?lang=${AGILOFT_LANG}`
}

/**
 * EWDelete's dependent-record strategy carries over to alrest as a query
 * parameter; omitting it leaves the behavior for linked records unspecified.
 */
export function alrestDeleteRecordUrl(
  base: string,
  table: string,
  recordId: string,
  deleteRule: string,
  substituteIds?: string
): string {
  let url = `${alrestRecordUrl(base, table, recordId)}&deleteRule=${encodeURIComponent(deleteRule)}`

  /**
   * `subs` is read only under REPLACE_WITH_ANOTHER, and names records from the
   * same table that adopt the dependants of the one being deleted.
   */
  if (deleteRule === 'REPLACE_WITH_ANOTHER' && substituteIds) {
    for (const id of substituteIds
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      url += `&subs=${encodeURIComponent(id)}`
    }
  }

  return url
}

export function alrestSearchUrl(base: string, table: string): string {
  return `${base}/${tableSegment(table)}/search?lang=${AGILOFT_LANG}`
}

/**
 * Hard ceiling on records returned from a search.
 *
 * Whether alrest honours `page`/`limit` in the request body is unverified — the
 * names carry over from the legacy EWSearch query string. If it ignores them a
 * broad query returns the whole table, and an unfiltered contract record runs
 * to roughly 184 KB, so the result is capped here rather than trusting the
 * server to bound it.
 */
export const AGILOFT_MAX_SEARCH_RECORDS = 200

/**
 * Byte ceiling for a single attachment download. The route base64-encodes the
 * body into a JSON response, so peak memory is several times the file size;
 * without a cap it inherits the shared 100 MiB default.
 */
export const AGILOFT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Ceiling on record IDs returned by EWSelect. The operation has no page size
 * of its own — the documented way to bound it is a database `limit` inside the
 * WHERE clause — so an unqualified clause returns every matching ID.
 */
export const AGILOFT_MAX_SELECT_IDS = 1000

/**
 * Splits a comma-separated field list into the `field` array alrest search
 * accepts. Field selection is the only way to keep a response small — a single
 * contract record runs to roughly 184 KB unfiltered.
 */
export function parseFieldList(fields?: string): string[] | undefined {
  const list = fields
    ?.split(',')
    .map((field) => field.trim())
    .filter(Boolean)
  return list?.length ? list : undefined
}

/** URL builders for the legacy `/ewws/EW*` surface (inline-credential auth) */

function encodeTable(params: AgiloftBaseParams) {
  return {
    kb: encodeURIComponent(params.knowledgeBase),
    table: encodeURIComponent(params.table),
  }
}

/** Non-secret query prefix shared by the legacy `/ewws/EW*` endpoints. */
function buildEwBaseQuery(params: AgiloftBaseParams): string {
  const { kb, table } = encodeTable(params)
  return `$KB=${kb}&$table=${table}&$lang=${AGILOFT_LANG}`
}

/**
 * Credentials appended to an EW* URL.
 *
 * "Every REST call should contain the user's credentials in the form
 * login={login}&password={password}" — the legacy surface authenticates this
 * way rather than from the bearer token EWLogin issues. Used only for the
 * operations that cannot carry them in a body instead; see
 * `ewCredentialBody`.
 */
function ewCredentialQuery(params: AgiloftCredentials): string {
  const login = encodeURIComponent(params.login)
  const password = encodeURIComponent(params.password)
  return `&$login=${login}&$password=${password}`
}

/**
 * Credentials as a form-encoded POST body, which is how Agiloft recommends
 * production systems pass them: "you can avoid passing the login or password
 * in REST calls by using POST instead of GET to pass the parameters in the
 * request body."
 *
 * Only EWRead, EWSelect, EWCreate, EWUpdate, and EWDelete accept credentials
 * this way. Every other EW* operation has to keep them in the query string.
 */
export function ewCredentialBody(params: AgiloftCredentials): string {
  return `$login=${encodeURIComponent(params.login)}&$password=${encodeURIComponent(params.password)}`
}

/**
 * EWSelect is one of the five operations that accept credentials in a POST
 * body, so the URL deliberately carries no `$login`/`$password`.
 */
/**
 * EWSavedSearch answers JSON only, so the `.json` decorator is mandatory. It
 * also has to run under EWLogin or OAuth authorization rather than inline
 * credentials, so no `$login`/`$password` are appended here.
 */
/**
 * EWTable is knowledge-base scoped, so the query carries `$KB` and `$lang` but
 * no `$table`. Narrowing to one table uses the plain `table` parameter, and
 * JSON is the only supported output, hence the mandatory `.json` decorator.
 * Runs under EWLogin or OAuth authorization, so no inline credentials.
 */
export function buildListTablesUrl(base: string, params: AgiloftListTablesParams): string {
  const kb = encodeURIComponent(params.knowledgeBase)
  let url = `${base}/ewws/EWTable/.json?${AGILOFT_JSON_ERROR_CODES}&$KB=${kb}&$lang=${AGILOFT_LANG}`

  const table = params.table?.trim()
  if (table) url += `&table=${encodeURIComponent(table)}`
  if (params.includeLinkedInfo) url += '&includelinkedinfo=true'
  if (params.skipColumnsInfo) url += '&skipColumnsInfo=true'

  return url
}

/**
 * EWUpsert takes every parameter — credentials included — in a form-encoded
 * body, so nothing sensitive reaches the URL and there is no request-line
 * length ceiling on the record data.
 */
export function buildUpsertRecordUrl(base: string): string {
  return `${base}/ewws/EWUpsert`
}

/**
 * Serializes ordered key/value pairs into an `application/x-www-form-urlencoded`
 * body, the Content-Type the legacy `/ewws/EW*` operations document as
 * supported, and the only one EWCreate accepts.
 *
 * Pairs rather than an object because Agiloft encodes multi-value fields as the
 * same key repeated, which an object cannot express.
 */
export function encodeEwFormBody(fields: Array<[string, string]>): string {
  return fields
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

/**
 * Renders one field value, refusing anything Agiloft has no encoding for.
 *
 * Applied to array entries as well as bare values: an object nested in a
 * multi-value field is just as unencodable as a bare one, and `String()` would
 * quietly write "[object Object]" into the record instead of failing.
 */
function encodeFieldValue(field: string, value: unknown): string {
  if (typeof value === 'object') {
    throw new TypeError(
      `Field "${field}" is an object, which Agiloft has no encoding for. Use a string, a number, or an array of values.`
    )
  }
  return String(value)
}

/**
 * Expands caller-supplied record data into form pairs, appending to `fields`.
 *
 * Multi-value fields are encoded as repeated key/value pairs, not as a joined
 * string.
 *
 * `$` opens Agiloft's reserved request-parameter namespace — `$table`, `$KB`,
 * `$login`, `$password` — which this body has already set. Record data reaches
 * here from workflow input, so a field carrying one of those names would append
 * a second occurrence of a reserved parameter and let the caller's data decide
 * which table the record lands in, or which credentials the call runs under.
 * Whether the duplicate wins is Agiloft's parser's business, so the name is
 * refused rather than sent.
 */
function pushRecordFields(fields: Array<[string, string]>, data: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue

    if (field.startsWith('$')) {
      throw new TypeError(
        `Field "${field}" uses Agiloft's reserved "$" parameter prefix, which record data cannot set. Rename the field.`
      )
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null) continue
        fields.push([field, encodeFieldValue(field, entry)])
      }
      continue
    }

    fields.push([field, encodeFieldValue(field, value)])
  }
}

export function buildUpsertRecordBody(
  params: AgiloftUpsertRecordParams,
  data: Record<string, unknown>
): string {
  const fields: Array<[string, string]> = [
    ['$KB', params.knowledgeBase],
    ['$table', params.table],
    ['$login', params.login],
    ['$password', params.password],
    ['$lang', AGILOFT_LANG],
    ['$match', params.match.trim()],
  ]

  if (params.async) fields.push(['$async', 'true'])

  pushRecordFields(fields, data)

  return encodeEwFormBody(fields)
}

/**
 * EWCreate is the documented create operation. It answers with the ID of the
 * new record as an `EWREST_id` assignment, which is the only place that ID is
 * published. There is no documented JSON create that returns it.
 */
export function buildCreateRecordUrl(base: string): string {
  return `${base}/ewws/EWCreate`
}

/**
 * Every parameter travels in a form-encoded body: EWCreate lists
 * `application/x-www-form-urlencoded` as its supported Content-Type, it is one
 * of the operations that accept credentials in the body rather than the query
 * string, and a body has no request-line length ceiling on the record data.
 */
export function buildCreateRecordBody(
  params: AgiloftBaseParams,
  data: Record<string, unknown>
): string {
  const fields: Array<[string, string]> = [
    ['$KB', params.knowledgeBase],
    ['$table', params.table],
    ['$login', params.login],
    ['$password', params.password],
    ['$lang', AGILOFT_LANG],
  ]

  pushRecordFields(fields, data)

  return encodeEwFormBody(fields)
}

export function buildSavedSearchUrl(base: string, params: AgiloftBaseParams): string {
  return `${base}/ewws/EWSavedSearch/.json?${AGILOFT_JSON_ERROR_CODES}&${buildEwBaseQuery(params)}`
}

export function buildSelectRecordsUrl(base: string, params: AgiloftSelectRecordsParams): string {
  const where = encodeURIComponent(params.where)
  return `${base}/ewws/EWSelect?${buildEwBaseQuery(params)}&where=${where}`
}

export function buildRetrieveAttachmentUrl(
  base: string,
  params: AgiloftRetrieveAttachmentParams
): string {
  const id = encodeURIComponent(params.recordId.trim())
  const field = encodeURIComponent(params.fieldName.trim())
  const position = encodeURIComponent(params.position.trim())
  return `${base}/ewws/EWRetrieve?${buildEwBaseQuery(params)}${ewCredentialQuery(params)}&id=${id}&field=${field}&filePosition=${position}`
}

export function buildRemoveAttachmentUrl(
  base: string,
  params: AgiloftRemoveAttachmentParams
): string {
  const id = encodeURIComponent(params.recordId.trim())
  const field = encodeURIComponent(params.fieldName.trim())
  const position = encodeURIComponent(params.position)
  return `${base}/ewws/EWRemoveAttachment?${buildEwBaseQuery(params)}${ewCredentialQuery(params)}&id=${id}&field=${field}&filePosition=${position}`
}

export function buildAttachmentInfoUrl(base: string, params: AgiloftAttachmentInfoParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  const fieldName = encodeURIComponent(params.fieldName.trim())
  return `${base}/ewws/EWAttachInfo/.json?${AGILOFT_JSON_ERROR_CODES}&${buildEwBaseQuery(params)}${ewCredentialQuery(params)}&id=${id}&field=${fieldName}`
}

/**
 * `force` is only meaningful on the DELETE (unlock) variant, where it lets an
 * admin release a lock held by another user.
 */
export function buildLockRecordUrl(base: string, params: AgiloftLockRecordParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  let url = `${base}/ewws/EWLock?${buildEwBaseQuery(params)}${ewCredentialQuery(params)}&id=${id}`
  if (params.lockAction === 'unlock' && params.force) {
    url += '&force=true'
  }
  return url
}

/**
 * EWAttach carries the file as the raw request body, so its credentials have to
 * travel in the query string like the rest of the EW* surface — there is no
 * room for a form-encoded credential body here.
 */
export function buildAttachFileUrl(
  base: string,
  params: AgiloftBaseParams & { recordId: string; fieldName: string; overwrite?: boolean },
  fileName: string
): string {
  const recordId = encodeURIComponent(params.recordId.trim())
  const fieldName = encodeURIComponent(params.fieldName.trim())
  const encodedFileName = encodeURIComponent(fileName)
  let url = `${base}/ewws/EWAttach?${buildEwBaseQuery(params)}${ewCredentialQuery(params)}&id=${recordId}&field=${fieldName}&fileName=${encodedFileName}`

  /** `<fieldName>$overwrite` replaces the field's contents instead of appending. */
  if (params.overwrite) {
    url += `&${fieldName}%24overwrite=true`
  }

  return url
}

export function buildGetChoiceLineIdUrl(
  base: string,
  params: AgiloftGetChoiceLineIdParams
): string {
  const field = encodeURIComponent(params.fieldName.trim())
  const value = encodeURIComponent(params.value.trim())
  return `${base}/ewws/EWGetChoiceLineId?${buildEwBaseQuery(params)}${ewCredentialQuery(params)}&field=${field}&value=${value}`
}

/**
 * EWAsyncStatus reports the outcome of a call made through the `/ewws/async`
 * prefix — including EWActionButton, whose callback ID is otherwise unusable.
 */
export function buildAsyncStatusUrl(base: string, params: AgiloftAsyncStatusParams): string {
  const callbackId = encodeURIComponent(params.callbackId.trim())
  return `${base}/ewws/EWAsyncStatus?${buildEwBaseQuery(params)}${ewCredentialQuery(params)}&callback_id=${callbackId}`
}

/** Documented EWAsyncStatus response codes. */
export const AGILOFT_ASYNC_STATUS: Record<number, { status: string; complete: boolean }> = {
  200: { status: 'completed', complete: true },
  201: { status: 'queued', complete: false },
  202: { status: 'in_progress', complete: false },
  501: { status: 'failed', complete: true },
  523: { status: 'unknown_callback', complete: true },
}

/**
 * EWNLPSearch answers semantic queries and returns records in the same shape as
 * search. It is KB-scoped — the table is chosen by the KB's chat-search
 * configuration rather than by the caller.
 */
export function buildNlpSearchUrl(base: string): string {
  return `${base}/ewws/EWNLPSearch`
}

/**
 * Body for EWNLPSearch.
 *
 * `$KB`, `$login`, and `$password` are request parameters, not payload keys.
 * Agiloft documents them under the operation's query parameters and rejects the
 * call outright when they arrive as members of a JSON object instead:
 *
 *   EWWrongDataException ... One has to specify $login, $password parameters
 *
 * Form-encoding the whole request satisfies that while keeping the password out
 * of the URL, access logs, and proxy traces. `field` repeats once per requested
 * field, matching Agiloft's multi-value encoding.
 */
/** Keeps a pagination input only when it reads as a non-negative whole number. */
function toPaginationValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return /^\d+$/.test(trimmed) ? trimmed : undefined
}

export function buildNlpSearchBody(params: AgiloftNlpSearchParams): string {
  const fields: Array<[string, string]> = [
    ['$KB', params.knowledgeBase],
    ['$login', params.login],
    ['$password', params.password],
    ['$lang', AGILOFT_LANG],
    ['nlp_query', params.nlpQuery.trim()],
  ]

  for (const field of parseFieldList(params.fields) ?? []) {
    fields.push(['field', field])
  }

  /**
   * EWNLPSearch ignores the table and searches the whole knowledge base, so
   * pagination is the only bound a caller has on the result size.
   *
   * Both are documented as integers, and the block accepts them as free text,
   * so a non-numeric value is dropped rather than forwarded — Agiloft ignores
   * parameters it cannot read, which would silently widen the search instead of
   * bounding it.
   */
  const page = toPaginationValue(params.page)
  const limit = toPaginationValue(params.limit)
  if (page !== undefined) fields.push(['page', page])
  if (limit !== undefined) fields.push(['limit', limit])

  return encodeEwFormBody(fields)
}

export function getLockHttpMethod(lockAction: string): HttpMethod {
  switch (lockAction) {
    case 'lock':
      return 'PUT'
    case 'unlock':
      return 'DELETE'
    default:
      return 'GET'
  }
}

/**
 * EWActionButton runs asynchronously and therefore lives under the `/ewws/async`
 * prefix rather than `/ewws` directly.
 */
export function buildRunActionButtonUrl(
  base: string,
  params: AgiloftRunActionButtonParams
): string {
  const id = encodeURIComponent(params.recordId.trim())
  const name = encodeURIComponent(params.actionButtonField.trim())
  return `${base}/ewws/async/EWActionButton?${buildEwBaseQuery(params)}${ewCredentialQuery(params)}&name=${name}&id=${id}`
}
