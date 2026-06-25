import { createLogger } from '@sim/logger'

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
      if (decoded.profile) {
        const match = decoded.profile.match(/^(https:\/\/[^/]+)/)
        if (match) return match[1]
      } else if (decoded.sub) {
        const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
        if (match && match[1] !== 'https://login.salesforce.com') return match[1]
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
 * Builds the `Metadata` object for a Tooling API CustomField create/update body.
 * Applies type-specific defaults so common field types work without the caller
 * supplying every property (e.g. Text defaults to length 255).
 * @param params - The custom field metadata params
 * @param fallbackLabel - Label to use when none is provided
 * @returns The Salesforce CustomField Metadata object
 * @throws Error if the field type is missing
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customfield.htm
 */
export function buildCustomFieldMetadata(
  params: {
    fieldType?: string
    label?: string
    length?: string
    precision?: string
    scale?: string
    visibleLines?: string
    required?: boolean | string
    unique?: boolean | string
    externalId?: boolean | string
    defaultValue?: string
    description?: string
    inlineHelpText?: string
    picklistValues?: string
  },
  fallbackLabel: string
): Record<string, any> {
  const fieldType = params.fieldType?.trim()
  if (!fieldType) {
    throw new Error('Field Type is required (e.g., Text, Number, Checkbox, Date, Picklist).')
  }

  const toNumber = (value?: string): number | undefined => {
    if (value === undefined || value === null || String(value).trim() === '') return undefined
    const parsed = Number(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  const metadata: Record<string, any> = {
    type: fieldType,
    label: params.label?.trim() || fallbackLabel,
  }

  const length = toNumber(params.length)
  if (length !== undefined) metadata.length = length
  const precision = toNumber(params.precision)
  if (precision !== undefined) metadata.precision = precision
  const scale = toNumber(params.scale)
  if (scale !== undefined) metadata.scale = scale
  const visibleLines = toNumber(params.visibleLines)
  if (visibleLines !== undefined) metadata.visibleLines = visibleLines

  const required = normalizeBoolean(params.required)
  if (required !== undefined) metadata.required = required
  const unique = normalizeBoolean(params.unique)
  if (unique !== undefined) metadata.unique = unique
  const externalId = normalizeBoolean(params.externalId)
  if (externalId !== undefined) metadata.externalId = externalId

  if (params.description?.trim()) metadata.description = params.description.trim()
  if (params.inlineHelpText?.trim()) metadata.inlineHelpText = params.inlineHelpText.trim()

  if (params.defaultValue !== undefined && String(params.defaultValue).trim() !== '') {
    metadata.defaultValue =
      fieldType === 'Checkbox'
        ? (normalizeBoolean(params.defaultValue) ?? false)
        : params.defaultValue
  } else if (fieldType === 'Checkbox') {
    metadata.defaultValue = false
  }

  const picklistValues = parseDelimitedList(params.picklistValues)
  if (picklistValues.length > 0) {
    metadata.valueSet = {
      valueSetDefinition: {
        sorted: false,
        value: picklistValues.map((value) => ({ fullName: value, default: false, label: value })),
      },
    }
  }

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
