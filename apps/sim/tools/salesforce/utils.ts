import { createLogger } from '@sim/logger'
import { isSalesforceLoginOrigin } from '@/lib/oauth/salesforce'

const logger = createLogger('SalesforceUtils')

/**
 * Extracts Salesforce instance URL from ID token or uses provided instance URL
 * @param idToken - The Salesforce ID token containing instance URL
 * @param instanceUrl - Direct instance URL if provided
 * @returns The Salesforce instance URL
 * @throws Error if instance URL cannot be determined
 */
export function getInstanceUrl(idToken?: string, instanceUrl?: string): string {
  if (instanceUrl) return instanceUrl
  if (idToken) {
    try {
      const base64Url = idToken.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
          .join('')
      )
      const decoded = JSON.parse(jsonPayload)
      // Both claims are rooted at the *authorization server* when no org host
      // could be resolved, and `/services/data/...` against a login host always
      // fails — so each is guarded, and `profile` falling through must still let
      // `sub` be tried rather than short-circuiting the whole lookup.
      for (const claim of [decoded.profile, decoded.sub]) {
        if (typeof claim !== 'string') continue
        // `URL` rather than a hand-rolled prefix regex: it normalizes away
        // userinfo, default ports, and case, so the origin compared against the
        // login-host set is the same one a fetch would actually use.
        let origin: string
        try {
          const url = new URL(claim)
          if (url.protocol !== 'https:') continue
          origin = url.origin
        } catch {
          continue
        }
        if (!isSalesforceLoginOrigin(origin)) return origin
      }
    } catch (error) {
      logger.error('Failed to decode Salesforce idToken', { error })
    }
  }
  throw new Error('Salesforce instance URL is required but not provided')
}

/**
 * Trims a record ID and throws if it is missing or whitespace-only.
 * Prevents whitespace-only IDs from collapsing into an empty URL path segment
 * (e.g. `/sobjects/Account/`) and hitting Salesforce with a malformed request.
 * @param value - The raw ID value from params
 * @param label - Human-readable field name used in the error message
 * @returns The trimmed, non-empty ID
 * @throws Error if the ID is absent or whitespace-only
 */
export function requireId(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${label} is required. Please provide a valid Salesforce ${label}.`)
  }
  return trimmed
}

/**
 * Ensures a custom field/object API name carries the required `__c` suffix.
 * Salesforce metadata components created via the Tooling API must end in `__c`;
 * users commonly omit it, so we append it when missing.
 * @param value - The raw API name from params (e.g. "Region" or "Region__c")
 * @param label - Human-readable field name used in the error message
 * @returns The trimmed API name guaranteed to end with `__c`
 * @throws Error if the name is absent or whitespace-only
 */
export function toCustomApiName(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${label} is required. Please provide a valid Salesforce API name.`)
  }
  return trimmed.endsWith('__c') ? trimmed : `${trimmed}__c`
}

/**
 * Normalizes a boolean-ish param value into a real boolean.
 * Tool params arrive as actual booleans from the LLM or as strings from block
 * inputs; this collapses both forms and treats empty values as "unset".
 * @param value - The raw param value
 * @returns The boolean value, or undefined when the param was not provided
 */
export function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return Boolean(value)
}

/**
 * Parses a comma-separated list into trimmed, non-empty entries.
 * Used for picklist value sets supplied as a single delimited string.
 * @param value - The raw comma-separated string
 * @returns An array of trimmed values (empty when nothing parseable is present)
 */
export function parseDelimitedList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Shape of the custom field metadata inputs accepted from tool params.
 * Numeric dimensions arrive as real numbers from the LLM (param `type: 'number'`)
 * or as strings from block inputs, so both forms are accepted.
 */
export interface CustomFieldMetadataInput {
  fieldType?: string
  label?: string
  length?: number | string
  precision?: number | string
  scale?: number | string
  visibleLines?: number | string
  required?: boolean | string
  unique?: boolean | string
  externalId?: boolean | string
  defaultValue?: string
  description?: string
  inlineHelpText?: string
  picklistValues?: string
}

/**
 * Coerces a numeric-ish metadata value (number or string) into a number.
 * @returns The parsed number, or undefined when unset or unparseable
 */
function toFieldNumber(value?: number | string): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Overlays only the explicitly-provided custom field properties onto `target`,
 * leaving any property the caller did not supply untouched. Shared by create
 * (onto a fresh object) and update (onto the field's existing metadata), so an
 * update never fabricates values for omitted properties.
 * @param target - The metadata object to mutate in place
 * @param params - The provided custom field metadata inputs
 */
function applyProvidedFieldMetadata(
  target: Record<string, any>,
  params: CustomFieldMetadataInput
): void {
  if (params.fieldType?.trim()) target.type = params.fieldType.trim()
  if (params.label?.trim()) target.label = params.label.trim()

  const length = toFieldNumber(params.length)
  if (length !== undefined) target.length = length
  const precision = toFieldNumber(params.precision)
  if (precision !== undefined) target.precision = precision
  const scale = toFieldNumber(params.scale)
  if (scale !== undefined) target.scale = scale
  const visibleLines = toFieldNumber(params.visibleLines)
  if (visibleLines !== undefined) target.visibleLines = visibleLines

  const required = normalizeBoolean(params.required)
  if (required !== undefined) target.required = required
  const unique = normalizeBoolean(params.unique)
  if (unique !== undefined) target.unique = unique
  const externalId = normalizeBoolean(params.externalId)
  if (externalId !== undefined) target.externalId = externalId

  if (params.description?.trim()) target.description = params.description.trim()
  if (params.inlineHelpText?.trim()) target.inlineHelpText = params.inlineHelpText.trim()

  if (params.defaultValue !== undefined && String(params.defaultValue).trim() !== '') {
    target.defaultValue =
      target.type === 'Checkbox'
        ? (normalizeBoolean(params.defaultValue) ?? false)
        : params.defaultValue
  }

  const picklistValues = parseDelimitedList(params.picklistValues)
  if (picklistValues.length > 0) {
    // Union with any existing values so an update adds new options without
    // dropping the field's current values (or their default flags).
    const existingValues: Array<Record<string, any>> = Array.isArray(
      target.valueSet?.valueSetDefinition?.value
    )
      ? target.valueSet.valueSetDefinition.value
      : []
    const existingFullNames = new Set(existingValues.map((entry) => entry.fullName))
    const additions = picklistValues
      .filter((value) => !existingFullNames.has(value))
      .map((value) => ({ fullName: value, default: false, label: value }))
    target.valueSet = {
      ...(target.valueSet ?? {}),
      valueSetDefinition: {
        ...(target.valueSet?.valueSetDefinition ?? {}),
        sorted: target.valueSet?.valueSetDefinition?.sorted ?? false,
        value: [...existingValues, ...additions],
      },
    }
  }
}

/**
 * Applies type-specific defaults required by Salesforce when the caller did not
 * supply them, so common field types work out of the box on create.
 * @param metadata - The metadata object to mutate in place (must have a `type`)
 */
function applyFieldTypeDefaults(metadata: Record<string, any>): void {
  const fieldType = metadata.type
  if (fieldType === 'Text' && metadata.length === undefined) {
    metadata.length = 255
  }
  if (fieldType === 'LongTextArea' || fieldType === 'Html') {
    if (metadata.length === undefined) metadata.length = 32768
    if (metadata.visibleLines === undefined) metadata.visibleLines = 3
  }
  if (fieldType === 'MultiselectPicklist') {
    if (metadata.visibleLines === undefined) metadata.visibleLines = 4
    // Salesforce requires `length` (total characters across selected values) for
    // multi-select picklists in addition to visibleLines.
    if (metadata.length === undefined) metadata.length = 255
  }
  if (fieldType === 'Number' || fieldType === 'Currency' || fieldType === 'Percent') {
    if (metadata.precision === undefined) metadata.precision = 18
    if (metadata.scale === undefined) metadata.scale = 0
  }
  // Checkbox fields require a default value; Salesforce rejects them without one.
  if (fieldType === 'Checkbox' && metadata.defaultValue === undefined) {
    metadata.defaultValue = false
  }
}

/**
 * Builds the `Metadata` object for a Tooling API CustomField create body.
 * Applies type-specific defaults so common field types work without the caller
 * supplying every property (e.g. Text defaults to length 255).
 * @param params - The custom field metadata params
 * @param fallbackLabel - Label to use when none is provided
 * @returns The Salesforce CustomField Metadata object
 * @throws Error if the field type is missing
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customfield.htm
 */
export function buildCustomFieldMetadata(
  params: CustomFieldMetadataInput,
  fallbackLabel: string
): Record<string, any> {
  const fieldType = params.fieldType?.trim()
  if (!fieldType) {
    throw new Error('Field Type is required (e.g., Text, Number, Checkbox, Date, Picklist).')
  }

  const metadata: Record<string, any> = {
    type: fieldType,
    label: params.label?.trim() || fallbackLabel,
  }
  applyProvidedFieldMetadata(metadata, params)
  applyFieldTypeDefaults(metadata)
  return metadata
}

/**
 * Merges caller-provided custom field changes onto a field's existing metadata
 * for a Tooling API update. The Tooling API PATCH replaces the whole `Metadata`
 * compound, so we start from the field's current metadata (read first) and
 * overlay only what changed — never fabricating defaults or labels that would
 * silently clobber unspecified properties.
 * @param existing - The field's current `Metadata` object (from a GET)
 * @param params - The provided custom field changes
 * @returns The merged Salesforce CustomField Metadata object
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customfield.htm
 */
export function mergeCustomFieldMetadata(
  existing: Record<string, any> | undefined,
  params: CustomFieldMetadataInput
): Record<string, any> {
  const metadata: Record<string, any> = { ...(existing ?? {}) }
  // An attribute update never changes the field's data type — Salesforce treats
  // a type change as a separate, conversion-driven operation. Keep the field's
  // existing type and overlay only the other provided properties.
  applyProvidedFieldMetadata(metadata, { ...params, fieldType: undefined })
  return metadata
}

/**
 * Extracts a descriptive error message from Salesforce API responses
 * @param data - The response data from Salesforce API
 * @param status - HTTP status code
 * @param defaultMessage - Default message to use if no specific error found
 * @returns Formatted error message
 */
export function extractErrorMessage(data: any, status: number, defaultMessage: string): string {
  if (Array.isArray(data) && data[0]?.message) {
    return `Salesforce API Error (${status}): ${data[0].message}${data[0].errorCode ? ` [${data[0].errorCode}]` : ''}`
  }
  // Tooling API metadata writes return { success: false, errors: [{ message, statusCode }] }
  if (Array.isArray(data?.errors) && data.errors[0]?.message) {
    const first = data.errors[0]
    return `Salesforce API Error (${status}): ${first.message}${first.statusCode ? ` [${first.statusCode}]` : ''}`
  }
  if (data?.message) {
    return `Salesforce API Error (${status}): ${data.message}`
  }
  if (data?.error) {
    return `Salesforce API Error (${status}): ${data.error}${data.error_description ? ` - ${data.error_description}` : ''}`
  }
  switch (status) {
    case 400:
      return `Salesforce API Error (400): Bad Request - The request was malformed or missing required parameters`
    case 401:
      return `Salesforce API Error (401): Unauthorized - Invalid or expired access token. Please re-authenticate.`
    case 403:
      return `Salesforce API Error (403): Forbidden - You do not have permission to access this resource.`
    case 404:
      return `Salesforce API Error (404): Not Found - The requested resource does not exist or you do not have access to it.`
    case 500:
      return `Salesforce API Error (500): Internal Server Error - An error occurred on Salesforce's servers.`
    default:
      return `${defaultMessage} (HTTP ${status})`
  }
}

/**
 * Thrown when a caller-supplied SOQL fragment fails validation.
 * Named so the failure is attributable in logs rather than surfacing as an
 * opaque Salesforce 400 (or, worse, as a silently rewritten statement).
 */
export class SoqlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SoqlValidationError'
  }
}

/**
 * Maximum child-to-parent relationship levels SOQL allows in a field path.
 *
 * The reference counts *relationship hops*, not dot-separated segments — it
 * calls `Contact.Account.Owner.FirstName` (four segments) three levels. A legal
 * path therefore spans up to `MAX_RELATIONSHIP_LEVELS + 1` segments.
 * @see https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_relationships_query_limits.htm
 */
const MAX_RELATIONSHIP_LEVELS = 5

/**
 * A single SOQL identifier: an object, relationship, or field API name.
 * Salesforce API names start with a letter and contain only letters, digits,
 * and underscores — which is also what makes the `__c` / `__r` suffixes match.
 */
const SOQL_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/

/**
 * Sanity ceiling on the SOQL `LIMIT` clause.
 *
 * SOQL documents no maximum for `LIMIT`; the 2,000 figure belongs to the REST
 * `query` resource's synchronous *batch* size, which is a paging boundary
 * rather than a cap on the result set. `LIMIT 5000` is a legal statement:
 * Salesforce returns the first batch with `done: false` plus a
 * `nextRecordsUrl`, and `salesforce_query_more` fetches the rest. This number
 * exists only to catch a typo or an overflowed value before it reaches the org,
 * so it is set far above any plausible intentional request.
 * @see https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_limit.htm
 */
const SOQL_MAX_LIMIT = 50_000

/** Default row count when the caller does not supply `limit`. */
const SOQL_DEFAULT_LIMIT = 100

/**
 * Field-group selectors the SELECT `fieldList` accepts in place of a field
 * name. Each is a closed keyword with no caller-controlled argument.
 * @see https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_fields.htm
 */
const SOQL_FIELD_GROUPS = new Set(['FIELDS(ALL)', 'FIELDS(CUSTOM)', 'FIELDS(STANDARD)'])

/**
 * SELECT-only functions that wrap exactly one field path, keyed by lower-case
 * name and valued with the documented spelling so the emitted statement is
 * stable. All three are legal alongside the ORDER BY these tools always append
 * (unlike `COUNT()`, and unlike `toLabel()` inside ORDER BY itself).
 */
const SOQL_SELECT_FUNCTIONS = new Map([
  ['tolabel', 'toLabel'],
  ['format', 'FORMAT'],
  ['convertcurrency', 'convertCurrency'],
])

/** `FORMAT(convertCurrency(Amount))` is the deepest documented nesting. */
const MAX_SELECT_FUNCTION_DEPTH = 2

/** One function call with a single argument and nothing outside the parentheses. */
const SOQL_FUNCTION_CALL = /^([A-Za-z]+)\(\s*([^()]*(?:\([^()]*\))?[^()]*)\s*\)$/

const ORDER_DIRECTIONS = new Set(['ASC', 'DESC'])
const NULLS_POSITIONS = new Set(['FIRST', 'LAST'])

/**
 * Points a rejected value at the tool that does accept arbitrary SOQL, so the
 * guard reads as a routing decision rather than an arbitrary restriction.
 */
const ESCAPE_HATCH_HINT =
  'Use the Salesforce Query tool if you need a full SOQL statement (functions, subqueries, WHERE clauses).'

/**
 * Validates one dotted field path (`Name`, `Account.Name`, `Custom__r.Value__c`).
 * @param path - The trimmed field path
 * @param label - Human-readable parameter name used in the error message
 * @throws SoqlValidationError if the path is not a plain relationship field path
 */
function assertFieldPath(path: string, label: string): void {
  const segments = path.split('.')
  const levels = segments.length - 1
  if (levels > MAX_RELATIONSHIP_LEVELS) {
    throw new SoqlValidationError(
      `Invalid ${label}: "${path}" spans ${levels} relationship levels; SOQL allows at most ${MAX_RELATIONSHIP_LEVELS}.`
    )
  }
  for (const segment of segments) {
    if (!SOQL_IDENTIFIER.test(segment)) {
      throw new SoqlValidationError(
        `Invalid ${label}: "${path}" is not a Salesforce field API name. Expected names like "Name" or "Account.Name". ${ESCAPE_HATCH_HINT}`
      )
    }
  }
}

/**
 * Normalizes one SELECT `fieldList` entry: a bare field path, a documented
 * field-group selector, or a documented single-field function wrapping one.
 *
 * The wrapper allowlist is closed — the function name must be one of three
 * documented spellings and its argument recurses back into this same check, so
 * the only thing that can reach the emitted statement is still a validated
 * field API name. Anything else (`COUNT()`, `DISTANCE()`, a subquery) falls
 * through to `assertFieldPath` and is rejected.
 * @param entry - One trimmed comma-separated entry
 * @param depth - Current wrapper nesting depth
 * @returns The normalized entry
 * @throws SoqlValidationError if the entry is not an allowed SELECT expression
 * @see https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_fields.htm
 */
function normalizeSelectEntry(entry: string, depth: number): string {
  if (depth === 0 && SOQL_FIELD_GROUPS.has(entry.toUpperCase())) {
    return entry.toUpperCase()
  }
  const call = SOQL_FUNCTION_CALL.exec(entry)
  if (call) {
    const name = SOQL_SELECT_FUNCTIONS.get(call[1].toLowerCase())
    if (!name || depth >= MAX_SELECT_FUNCTION_DEPTH) {
      throw new SoqlValidationError(
        `Invalid fields: "${entry}" is not an allowed SELECT expression. Allowed functions are toLabel(), FORMAT(), and convertCurrency(), plus FIELDS(STANDARD|CUSTOM|ALL). ${ESCAPE_HATCH_HINT}`
      )
    }
    return `${name}(${normalizeSelectEntry(call[2].trim(), depth + 1)})`
  }
  assertFieldPath(entry, 'fields')
  return entry
}

/**
 * Validates a comma-separated SELECT field list before it is interpolated into
 * a SOQL statement.
 *
 * `fields` is `visibility: 'user-or-llm'`, so a prompt-injected agent controls
 * it. Each entry must be a bare field API name, a `FIELDS(...)` group selector,
 * or one of three documented single-field functions whose argument is itself a
 * validated field path — no spaces, quotes, operators, or free parentheses
 * reach the statement, so there is no room to append a clause, open a subquery,
 * or retarget the FROM object. Anything richer belongs in the
 * separately-permissioned `salesforce_query` tool.
 * @param value - The raw `fields` param
 * @param fallback - The tool's default field list, used when `value` is unset
 * @returns The normalized, comma-separated field list
 * @throws SoqlValidationError if any entry is not a plain field API name
 * @see https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select.htm
 */
export function sanitizeSoqlFieldList(value: string | undefined, fallback: string): string {
  const raw = value?.trim() ? value : fallback
  const fields = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (fields.length === 0) {
    throw new SoqlValidationError('Invalid fields: at least one field API name is required.')
  }
  return fields.map((field) => normalizeSelectEntry(field, 0)).join(', ')
}

/**
 * Validates a comma-separated ORDER BY clause before interpolation.
 *
 * Accepts exactly the documented grammar — `fieldOrderByList {ASC|DESC}
 * [NULLS {FIRST|LAST}]` — one field path per entry with optional direction and
 * null placement, and nothing else. Keywords are normalized to upper case so
 * the emitted statement is stable regardless of how the caller wrote them.
 * @param value - The raw `orderBy` param
 * @param fallback - The tool's default order clause, used when `value` is unset
 * @returns The normalized ORDER BY clause
 * @throws SoqlValidationError if any entry is not a valid order expression
 * @see https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_orderby.htm
 */
export function sanitizeSoqlOrderBy(value: string | undefined, fallback: string): string {
  const raw = value?.trim() ? value : fallback
  const clauses = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (clauses.length === 0) {
    throw new SoqlValidationError('Invalid orderBy: at least one field API name is required.')
  }

  return clauses
    .map((clause) => {
      const tokens = clause.split(/\s+/)
      const [field, ...rest] = tokens
      assertFieldPath(field, 'orderBy')

      const parts = [field]
      let index = 0

      if (rest[index] && ORDER_DIRECTIONS.has(rest[index].toUpperCase())) {
        parts.push(rest[index].toUpperCase())
        index += 1
      }
      if (rest[index]?.toUpperCase() === 'NULLS') {
        const position = rest[index + 1]?.toUpperCase()
        if (!position || !NULLS_POSITIONS.has(position)) {
          throw new SoqlValidationError(
            `Invalid orderBy: "${clause}" — NULLS must be followed by FIRST or LAST.`
          )
        }
        parts.push('NULLS', position)
        index += 2
      }
      if (index !== rest.length) {
        throw new SoqlValidationError(
          `Invalid orderBy: "${clause}" is not a valid sort expression. Expected "Field [ASC|DESC] [NULLS FIRST|LAST]". ${ESCAPE_HATCH_HINT}`
        )
      }
      return parts.join(' ')
    })
    .join(', ')
}

/**
 * Validates the row limit before interpolation.
 *
 * `Number.parseInt` alone yields `NaN` for junk, which previously emitted
 * `LIMIT NaN` and an opaque Salesforce 400. This rejects non-integers up front.
 * It deliberately does *not* cap the value at the REST batch size: a `LIMIT`
 * larger than one batch is how a caller asks for a full result set, which
 * `salesforce_query_more` then pages through via `nextRecordsUrl`.
 * @param value - The raw `limit` param (string from block inputs, number from the LLM)
 * @returns The validated row count, or the default when unset
 * @throws SoqlValidationError if the value is not a positive integer within the sanity ceiling
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm
 */
export function sanitizeSoqlLimit(value: string | number | undefined): number {
  if (value === undefined || value === null || String(value).trim() === '') {
    return SOQL_DEFAULT_LIMIT
  }
  const raw = String(value).trim()
  if (!/^\d+$/.test(raw)) {
    throw new SoqlValidationError(
      `Invalid limit: "${raw}" is not a whole number. Provide a positive integer (at most ${SOQL_MAX_LIMIT}).`
    )
  }
  const parsed = Number(raw)
  if (parsed < 1 || parsed > SOQL_MAX_LIMIT) {
    throw new SoqlValidationError(
      `Invalid limit: ${parsed} is out of range. Provide a positive integer of at most ${SOQL_MAX_LIMIT}.`
    )
  }
  return parsed
}
