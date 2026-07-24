import { createLogger } from '@sim/logger'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { fetchWithRetry } from '@/lib/knowledge/documents/utils'

const logger = createLogger('JiraUtils')

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024

/**
 * Converts a value to ADF format. If the value is already an ADF document object,
 * it is returned as-is. If it is a plain string, it is wrapped in a single-paragraph ADF doc.
 */
export function toAdf(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value === 'object') {
    if (value.type === 'doc') {
      return value
    }
    if (value.type && Array.isArray(value.content)) {
      return { type: 'doc', version: 1, content: [value] }
    }
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && parsed.type === 'doc') {
        return parsed
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        parsed.type &&
        Array.isArray(parsed.content)
      ) {
        return { type: 'doc', version: 1, content: [parsed] }
      }
    } catch {
      // Not JSON — treat as plain text below
    }
  }
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
        ],
      },
    ],
  }
}

/**
 * Supported serialization modes for a Jira custom field. Each maps to the exact
 * value shape the Jira REST v3 `PUT /issue/{key}` endpoint expects under `fields`.
 */
export type JiraCustomFieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'userpicker'
  | 'multiuserpicker'
  | 'cascading'
  | 'raw'

/**
 * A single structured custom field to write. `fieldId` may be given with or
 * without the `customfield_` prefix; `child` is an optional explicit child value
 * for cascading selects (otherwise it is derived from `value`).
 */
export interface JiraCustomFieldEntry {
  fieldId: string
  type: JiraCustomFieldType
  value: unknown
  child?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyScalar(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * Coerces an unknown value into an array. Arrays pass through; empty scalars
 * become `[]`; any other single value is wrapped in a one-element array.
 */
function toValueArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isEmptyScalar(value)) return []
  return [value]
}

/**
 * Resolves the string an option is identified by. If the value is an option
 * object (`{ value }` / `{ id }`), that inner value is used; otherwise the value
 * is stringified.
 */
function optionValue(value: unknown): string {
  if (isRecord(value)) {
    if (value.value !== undefined) return String(value.value)
    if (value.id !== undefined) return String(value.id)
  }
  return String(value)
}

/**
 * Serializes a select option: a numeric-looking value is treated as an option
 * id (`{ id }`), everything else as an option value (`{ value }`). Mirrors the
 * priority id-or-name heuristic used elsewhere in the Jira tools.
 */
function toSelectOption(value: unknown): Record<string, string> {
  const resolved = optionValue(value)
  return /^\d+$/.test(resolved) ? { id: resolved } : { value: resolved }
}

/**
 * Serializes a cascading select into `{ value: <parent>, child: { value: <child> } }`.
 * The parent/child pair is taken from an explicit `entry.child`, a `{ parent, child }`
 * or `{ value, child }` object, or a two-element `[parent, child]` array.
 */
function toCascadingOption(entry: JiraCustomFieldEntry): Record<string, unknown> {
  let parent: unknown = entry.value
  let child: unknown = entry.child

  if (Array.isArray(entry.value)) {
    parent = entry.value[0]
    if (child === undefined) child = entry.value[1]
  } else if (isRecord(entry.value)) {
    const rec = entry.value
    parent = rec.parent !== undefined ? rec.parent : rec.value
    if (child === undefined) child = rec.child
  }

  const result: Record<string, unknown> = { value: optionValue(parent) }
  if (!isEmptyScalar(child)) {
    result.child = { value: optionValue(child) }
  }
  return result
}

/**
 * Serializes one custom-field entry into the Jira REST v3 value shape for its type:
 * - `text` / `raw` → value untouched
 * - `number` → numeric-string values coerced to a number, otherwise untouched
 * - `select` → `{ value }` (or `{ id }` for numeric option ids)
 * - `multiselect` → array of `{ value }` / `{ id }`
 * - `userpicker` → `{ accountId }`
 * - `multiuserpicker` → array of `{ accountId }`
 * - `cascading` → `{ value, child: { value } }`
 */
export function serializeJiraCustomField(entry: JiraCustomFieldEntry): unknown {
  const { type, value } = entry
  switch (type) {
    case 'number': {
      if (typeof value === 'number') return value
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
      }
      return value
    }
    case 'select':
      return toSelectOption(value)
    case 'multiselect':
      return toValueArray(value).map(toSelectOption)
    case 'userpicker':
      return { accountId: String(value) }
    case 'multiuserpicker':
      return toValueArray(value).map((entryValue) => ({ accountId: String(entryValue) }))
    case 'cascading':
      return toCascadingOption(entry)
    default:
      return value
  }
}

function normalizeCustomFieldId(fieldId: string): string {
  return fieldId.startsWith('customfield_') ? fieldId : `customfield_${fieldId}`
}

/**
 * Merges the legacy single `customFieldId` + `customFieldValue` pair with the
 * structured `customFields` array into a `customfield_XXXXX` → serialized-value
 * map ready to spread onto the Jira `fields` object. The legacy pair is applied
 * first as a `raw` passthrough (preserving prior behavior); `customFields` entries
 * are applied second so they win on `fieldId` collision. Blank entries are skipped.
 */
export function buildJiraCustomFields(args: {
  customFields?: JiraCustomFieldEntry[]
  legacyFieldId?: string | null
  legacyValue?: unknown
}): Record<string, unknown> {
  const { customFields, legacyFieldId, legacyValue } = args
  const result: Record<string, unknown> = {}

  if (typeof legacyFieldId === 'string' && legacyFieldId !== '' && !isEmptyScalar(legacyValue)) {
    result[normalizeCustomFieldId(legacyFieldId)] = serializeJiraCustomField({
      fieldId: legacyFieldId,
      type: 'raw',
      value: legacyValue,
    })
  }

  if (Array.isArray(customFields)) {
    for (const entry of customFields) {
      if (!entry || typeof entry.fieldId !== 'string' || entry.fieldId === '') continue
      const valueIsEmpty = !Array.isArray(entry.value) && isEmptyScalar(entry.value)
      if (entry.type !== 'raw' && valueIsEmpty && entry.child === undefined) continue
      result[normalizeCustomFieldId(entry.fieldId)] = serializeJiraCustomField(entry)
    }
  }

  return result
}

/**
 * Extracts plain text from Atlassian Document Format (ADF) content.
 * Returns null if content is falsy.
 */
export function extractAdfText(content: any): string | null {
  if (!content) return null
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(extractAdfText).filter(Boolean).join(' ')
  }
  if (content.type === 'text') return content.text || ''
  if (content.type === 'hardBreak') return '\n'
  if (content.type === 'mention') return content.attrs?.text || ''
  if (content.type === 'emoji') return content.attrs?.shortName || content.attrs?.text || ''
  if (content.content) return extractAdfText(content.content)
  return ''
}

/**
 * Transforms a raw Jira API user object into a typed user output.
 * Returns null if user data is falsy.
 */
export function transformUser(user: any): {
  accountId: string
  displayName: string
  active: boolean | null
  emailAddress: string | null
  avatarUrl: string | null
  accountType: string | null
  timeZone: string | null
} | null {
  if (!user) return null
  return {
    accountId: user.accountId ?? '',
    displayName: user.displayName ?? '',
    active: user.active ?? null,
    emailAddress: user.emailAddress ?? null,
    avatarUrl: user.avatarUrls?.['48x48'] ?? null,
    accountType: user.accountType ?? null,
    timeZone: user.timeZone ?? null,
  }
}

/**
 * Downloads Jira attachment file content given attachment metadata and an access token.
 * Returns an array of downloaded files with base64-encoded data.
 */
export async function downloadJiraAttachments(
  attachments: Array<{
    content: string
    filename: string
    mimeType: string
    size: number
    id: string
  }>,
  accessToken: string
): Promise<Array<{ name: string; mimeType: string; data: string; size: number }>> {
  const downloaded: Array<{ name: string; mimeType: string; data: string; size: number }> = []

  for (const att of attachments) {
    if (!att.content) continue
    if (att.size > MAX_ATTACHMENT_SIZE) {
      logger.warn(`Skipping attachment ${att.filename} (${att.size} bytes): exceeds size limit`)
      continue
    }
    try {
      const response = await fetchWithRetry(att.content, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: '*/*',
        },
      })

      if (!response.ok) {
        logger.warn(`Failed to download attachment ${att.filename}: HTTP ${response.status}`)
        continue
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      downloaded.push({
        name: att.filename || `attachment-${att.id}`,
        mimeType: att.mimeType || 'application/octet-stream',
        data: buffer.toString('base64'),
        size: buffer.length,
      })
    } catch (error) {
      logger.warn(`Failed to download attachment ${att.filename}:`, error)
    }
  }

  return downloaded
}

/**
 * Normalizes an ISO timestamp into the format Jira's worklog API requires:
 * `YYYY-MM-DDTHH:mm:ss.sss±HHMM` (offset without colon). Accepts trailing `Z`
 * and `±HH:MM` offsets and rewrites them to `±HHMM`. If milliseconds are
 * missing, `.000` is inserted before the offset.
 */
export function normalizeJiraWorklogTimestamp(value: string): string {
  let s = value.trim()
  s = s.replace(/Z$/i, '+0000')
  s = s.replace(/([+-]\d{2}):(\d{2})$/, '$1$2')
  s = s.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{4})$/, '$1.000$2')
  return s
}

export function normalizeDomain(domain: string): string {
  return `https://${domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')}`.toLowerCase()
}

export async function getJiraCloudId(
  domain: string,
  accessToken: string,
  retryOptions?: RetryOptions
): Promise<string> {
  const response = await fetchWithRetry(
    'https://api.atlassian.com/oauth/token/accessible-resources',
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
    const errorText = await response.text()
    throw new Error(`Failed to fetch Jira accessible resources: ${response.status} - ${errorText}`)
  }

  const resources = await response.json()

  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('No Jira resources found')
  }

  const normalized = normalizeDomain(domain)
  const match = resources.find(
    (r: { url: string }) => r.url.toLowerCase().replace(/\/+$/, '') === normalized
  )

  if (match) {
    return match.id
  }

  if (resources.length === 1) {
    return resources[0].id
  }

  throw new Error(
    `Could not match Jira domain "${domain}" to any accessible resource. ` +
      `Available sites: ${resources.map((r: { url: string }) => r.url).join(', ')}`
  )
}

/**
 * Parse error messages from Atlassian API responses (Jira, JSM, Confluence).
 * Handles all known error formats: errorMessage, errorMessages[], errors[].title/detail,
 * field-level errors object, and generic message fallback.
 */
export function parseAtlassianErrorMessage(
  status: number,
  statusText: string,
  errorText: string
): string {
  try {
    const errorData = JSON.parse(errorText)
    if (errorData.errorMessage) {
      return errorData.errorMessage
    }
    if (Array.isArray(errorData.errorMessages) && errorData.errorMessages.length > 0) {
      return errorData.errorMessages.join(', ')
    }
    if (Array.isArray(errorData.errors) && errorData.errors.length > 0) {
      const err = errorData.errors[0]
      if (err?.title) {
        return err.detail ? `${err.title}: ${err.detail}` : err.title
      }
    }
    if (errorData.errors && !Array.isArray(errorData.errors)) {
      const fieldErrors = Object.entries(errorData.errors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join(', ')
      if (fieldErrors) return fieldErrors
    }
    if (errorData.message) {
      return errorData.message
    }
  } catch {
    if (errorText) {
      return errorText
    }
  }
  return `${status} ${statusText}`
}
