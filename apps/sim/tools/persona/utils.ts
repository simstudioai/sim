import type {
  PersonaAccount,
  PersonaCase,
  PersonaDocument,
  PersonaImporter,
  PersonaInquiry,
  PersonaInquiryTemplate,
  PersonaReport,
  PersonaVerification,
} from '@/tools/persona/types'
import type { OutputProperty } from '@/tools/types'

export const PERSONA_API_BASE = 'https://api.withpersona.com/api/v1'

/**
 * Persona API version pinned for this integration so responses keep a stable
 * shape regardless of the organization's dashboard default.
 */
export const PERSONA_API_VERSION = '2025-12-08'

/**
 * Raw JSON:API resource object returned by the Persona API.
 */
export interface PersonaResourceData {
  type?: string
  id?: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, unknown>
}

/**
 * Top-level JSON:API envelope returned by the Persona API.
 */
export interface PersonaApiEnvelope {
  data?: unknown
  links?: unknown
  meta?: Record<string, unknown>
}

/**
 * Extracts a human-readable message from a Persona JSON:API error body.
 */
export function extractPersonaErrorMessage(body: unknown, fallback: string): string {
  if (body !== null && typeof body === 'object') {
    const errors = (body as Record<string, unknown>).errors
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0]
      if (first !== null && typeof first === 'object') {
        const title = (first as Record<string, unknown>).title
        if (typeof title === 'string' && title.length > 0) {
          return title
        }
      }
    }
  }
  return fallback
}

/**
 * Reads a Persona JSON response, throwing a descriptive error for non-2xx
 * responses using the JSON:API error format.
 */
export async function parsePersonaResponse(response: Response): Promise<PersonaApiEnvelope> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      extractPersonaErrorMessage(
        body,
        `Persona API error: ${response.status} ${response.statusText}`
      )
    )
  }
  return body !== null && typeof body === 'object' ? (body as PersonaApiEnvelope) : {}
}

/**
 * Narrows an unknown JSON:API `data` value to a single resource object.
 */
export function asResource(value: unknown): PersonaResourceData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PersonaResourceData)
    : {}
}

/**
 * Narrows an unknown JSON:API `data` value to a list of resource objects.
 */
export function asResourceList(value: unknown): PersonaResourceData[] {
  return Array.isArray(value) ? value.map(asResource) : []
}

/**
 * Builds the standard headers for Persona API requests.
 */
export function buildPersonaHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Persona-Version': PERSONA_API_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/**
 * Parses a JSON object param that may arrive as an object or a JSON string.
 * Throws a descriptive error when the value is not a JSON object.
 */
export function parseJsonObjectParam(
  value: Record<string, unknown> | string | undefined,
  label: string
): Record<string, unknown> | undefined {
  if (value === undefined || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${label} must be a valid JSON object`)
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object of key-value pairs`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Parses a string array param that may arrive as an array or a JSON string.
 * Throws a descriptive error when the value is not an array of strings.
 */
export function parseStringArrayParam(
  value: string[] | string | undefined,
  label: string
): string[] | undefined {
  if (value === undefined || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${label} must be a valid JSON array of strings`)
    }
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`${label} must be a JSON array of strings`)
  }
  return parsed
}

function getString(attrs: Record<string, unknown>, key: string): string | null {
  const value = attrs[key]
  return typeof value === 'string' ? value : null
}

function getBoolean(attrs: Record<string, unknown>, key: string): boolean | null {
  const value = attrs[key]
  return typeof value === 'boolean' ? value : null
}

function getNumber(attrs: Record<string, unknown>, key: string, fallback: number): number {
  const value = attrs[key]
  return typeof value === 'number' ? value : fallback
}

function getStringArray(attrs: Record<string, unknown>, key: string): string[] {
  const value = attrs[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function getObject(attrs: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = attrs[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Extracts the `page[after]` cursor from a JSON:API `links.next` URL.
 */
export function getNextCursor(links: unknown): string | null {
  if (links === null || typeof links !== 'object') return null
  const next = (links as Record<string, unknown>).next
  if (typeof next !== 'string' || next.length === 0) return null
  const queryIndex = next.indexOf('?')
  if (queryIndex === -1) return null
  const searchParams = new URLSearchParams(next.slice(queryIndex + 1))
  return searchParams.get('page[after]')
}

/**
 * Maps a raw Persona Inquiry resource to its flattened representation.
 */
export function mapInquiry(data: PersonaResourceData): PersonaInquiry {
  const attrs = data.attributes ?? {}
  return {
    id: data.id ?? '',
    status: getString(attrs, 'status'),
    referenceId: getString(attrs, 'reference-id'),
    note: getString(attrs, 'note'),
    tags: getStringArray(attrs, 'tags'),
    fields: getObject(attrs, 'fields'),
    createdAt: getString(attrs, 'created-at'),
    startedAt: getString(attrs, 'started-at'),
    completedAt: getString(attrs, 'completed-at'),
    failedAt: getString(attrs, 'failed-at'),
    expiredAt: getString(attrs, 'expired-at'),
    decisionedAt: getString(attrs, 'decisioned-at'),
  }
}

/**
 * Maps a raw Persona Account resource to its flattened representation.
 */
export function mapAccount(data: PersonaResourceData): PersonaAccount {
  const attrs = data.attributes ?? {}
  return {
    id: data.id ?? '',
    referenceId: getString(attrs, 'reference-id'),
    accountTypeName: getString(attrs, 'account-type-name'),
    accountStatus: getString(attrs, 'account-status'),
    tags: getStringArray(attrs, 'tags'),
    fields: getObject(attrs, 'fields'),
    createdAt: getString(attrs, 'created-at'),
    updatedAt: getString(attrs, 'updated-at'),
  }
}

/**
 * Maps a raw Persona Case resource to its flattened representation.
 */
export function mapCase(data: PersonaResourceData): PersonaCase {
  const attrs = data.attributes ?? {}
  return {
    id: data.id ?? '',
    status: getString(attrs, 'status'),
    name: getString(attrs, 'name'),
    resolution: getString(attrs, 'resolution'),
    assigneeId: getString(attrs, 'assignee-id'),
    tags: getStringArray(attrs, 'tags'),
    fields: getObject(attrs, 'fields'),
    createdAt: getString(attrs, 'created-at'),
    assignedAt: getString(attrs, 'assigned-at'),
    resolvedAt: getString(attrs, 'resolved-at'),
  }
}

/**
 * Maps a raw Persona Report resource to its flattened representation.
 */
export function mapReport(data: PersonaResourceData): PersonaReport {
  const attrs = data.attributes ?? {}
  return {
    id: data.id ?? '',
    type: data.type ?? '',
    status: getString(attrs, 'status'),
    hasMatch: getBoolean(attrs, 'has-match'),
    tags: getStringArray(attrs, 'tags'),
    createdAt: getString(attrs, 'created-at'),
    completedAt: getString(attrs, 'completed-at'),
    attributes: attrs,
  }
}

/**
 * Maps a raw Persona Verification resource to its flattened representation.
 */
export function mapVerification(data: PersonaResourceData): PersonaVerification {
  const attrs = data.attributes ?? {}
  const checks = attrs.checks
  return {
    id: data.id ?? '',
    type: data.type ?? '',
    status: getString(attrs, 'status'),
    checks: Array.isArray(checks)
      ? checks.filter(
          (check): check is Record<string, unknown> => check !== null && typeof check === 'object'
        )
      : [],
    countryCode: getString(attrs, 'country-code'),
    createdAt: getString(attrs, 'created-at'),
    submittedAt: getString(attrs, 'submitted-at'),
    completedAt: getString(attrs, 'completed-at'),
    attributes: attrs,
  }
}

/**
 * Maps a raw Persona Document resource to its flattened representation.
 */
export function mapDocument(data: PersonaResourceData): PersonaDocument {
  const attrs = data.attributes ?? {}
  const files = attrs.files
  return {
    id: data.id ?? '',
    type: data.type ?? '',
    status: getString(attrs, 'status'),
    kind: getString(attrs, 'kind'),
    files: Array.isArray(files)
      ? files
          .filter(
            (file): file is Record<string, unknown> => file !== null && typeof file === 'object'
          )
          .map((file) => ({
            filename: typeof file.filename === 'string' ? file.filename : null,
            url: typeof file.url === 'string' ? file.url : null,
            byteSize: typeof file['byte-size'] === 'number' ? file['byte-size'] : null,
          }))
      : [],
    createdAt: getString(attrs, 'created-at'),
    processedAt: getString(attrs, 'processed-at'),
    attributes: attrs,
  }
}

/**
 * Maps a raw Persona Inquiry Template resource to its flattened representation.
 */
export function mapInquiryTemplate(data: PersonaResourceData): PersonaInquiryTemplate {
  const attrs = data.attributes ?? {}
  return {
    id: data.id ?? '',
    name: getString(attrs, 'name'),
    status: getString(attrs, 'status'),
  }
}

/**
 * Maps a raw Persona Account Importer resource to its flattened representation.
 */
export function mapImporter(data: PersonaResourceData): PersonaImporter {
  const attrs = data.attributes ?? {}
  return {
    id: data.id ?? '',
    status: getString(attrs, 'status'),
    successfulCount: getNumber(attrs, 'successful-count', 0),
    errorCount: getNumber(attrs, 'error-count', 0),
    duplicateCount: getNumber(attrs, 'duplicate-count', 0),
    createdAt: getString(attrs, 'created-at'),
    completedAt: getString(attrs, 'completed-at'),
  }
}

export const INQUIRY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Inquiry ID (starts with inq_)' },
  status: {
    type: 'string',
    description:
      'Inquiry status (created, pending, completed, failed, expired, needs_review, approved, declined)',
    nullable: true,
  },
  referenceId: {
    type: 'string',
    description: 'Reference ID linking the inquiry to an entity in your user model',
    nullable: true,
  },
  note: { type: 'string', description: 'Free-form note on the inquiry', nullable: true },
  tags: {
    type: 'array',
    description: 'Tags associated with the inquiry',
    items: { type: 'string' },
  },
  fields: {
    type: 'json',
    description: 'Field name to field value pairs collected by the inquiry template',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', nullable: true },
  startedAt: { type: 'string', description: 'ISO 8601 start timestamp', nullable: true },
  completedAt: { type: 'string', description: 'ISO 8601 completion timestamp', nullable: true },
  failedAt: { type: 'string', description: 'ISO 8601 failure timestamp', nullable: true },
  expiredAt: { type: 'string', description: 'ISO 8601 expiration timestamp', nullable: true },
  decisionedAt: { type: 'string', description: 'ISO 8601 decision timestamp', nullable: true },
}

export const ACCOUNT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Account ID (starts with act_)' },
  referenceId: {
    type: 'string',
    description: 'Reference ID linking the account to an entity in your user model',
    nullable: true,
  },
  accountTypeName: { type: 'string', description: 'Name of the account type', nullable: true },
  accountStatus: { type: 'string', description: 'Status set on the account', nullable: true },
  tags: {
    type: 'array',
    description: 'Tags associated with the account',
    items: { type: 'string' },
  },
  fields: {
    type: 'json',
    description: 'Field name to field value pairs defined by the account type',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', nullable: true },
  updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp', nullable: true },
}

export const CASE_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Case ID (starts with case_)' },
  status: { type: 'string', description: 'Case status', nullable: true },
  name: { type: 'string', description: 'Case name', nullable: true },
  resolution: { type: 'string', description: 'Case resolution', nullable: true },
  assigneeId: { type: 'string', description: 'ID of the assigned reviewer', nullable: true },
  tags: { type: 'array', description: 'Tags associated with the case', items: { type: 'string' } },
  fields: {
    type: 'json',
    description: 'Field name to field value pairs defined by the case template',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', nullable: true },
  assignedAt: { type: 'string', description: 'ISO 8601 assignment timestamp', nullable: true },
  resolvedAt: { type: 'string', description: 'ISO 8601 resolution timestamp', nullable: true },
}

export const REPORT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Report ID (starts with rep_)' },
  type: { type: 'string', description: 'Report type (e.g. report/watchlist)' },
  status: {
    type: 'string',
    description: 'Report status (pending, ready, errored)',
    nullable: true,
  },
  hasMatch: {
    type: 'boolean',
    description: 'Whether the report found at least one match',
    nullable: true,
    optional: true,
  },
  tags: {
    type: 'array',
    description: 'Tags associated with the report',
    items: { type: 'string' },
  },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', nullable: true },
  completedAt: { type: 'string', description: 'ISO 8601 completion timestamp', nullable: true },
  attributes: {
    type: 'json',
    description: 'Full report attributes, which vary by report type',
  },
}

export const VERIFICATION_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Verification ID (starts with ver_)' },
  type: { type: 'string', description: 'Verification type (e.g. verification/government-id)' },
  status: {
    type: 'string',
    description:
      'Verification status (initiated, submitted, passed, failed, requires_retry, canceled)',
    nullable: true,
  },
  checks: {
    type: 'array',
    description: 'Individual checks run as part of the verification',
    items: { type: 'object' },
  },
  countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2 country code', nullable: true },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', nullable: true },
  submittedAt: { type: 'string', description: 'ISO 8601 submission timestamp', nullable: true },
  completedAt: { type: 'string', description: 'ISO 8601 completion timestamp', nullable: true },
  attributes: {
    type: 'json',
    description: 'Full verification attributes, which vary by verification type',
  },
}

export const DOCUMENT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Document ID (starts with doc_)' },
  type: { type: 'string', description: 'Document type (e.g. document/government-id)' },
  status: {
    type: 'string',
    description: 'Document status (initiated, submitted, processed, errored)',
    nullable: true,
  },
  kind: { type: 'string', description: 'Kind of document collected', nullable: true },
  files: {
    type: 'array',
    description: 'Files uploaded to the document, with Persona-hosted download URLs',
    items: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Original file name', nullable: true },
        url: {
          type: 'string',
          description: 'Persona-hosted file URL (requires API key to download)',
          nullable: true,
        },
        byteSize: { type: 'number', description: 'File size in bytes', nullable: true },
      },
    },
  },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', nullable: true },
  processedAt: { type: 'string', description: 'ISO 8601 processing timestamp', nullable: true },
  attributes: {
    type: 'json',
    description: 'Full document attributes, which vary by document type',
  },
}

export const INQUIRY_TEMPLATE_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Inquiry template ID (starts with itmpl_)' },
  name: { type: 'string', description: 'Name of the inquiry template', nullable: true },
  status: {
    type: 'string',
    description: 'Inquiry template status (active, inactive)',
    nullable: true,
  },
}

export const IMPORTER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Importer ID (starts with mprt_)' },
  status: {
    type: 'string',
    description: 'Importer status (pending, ready, errored)',
    nullable: true,
  },
  successfulCount: { type: 'number', description: 'Number of rows imported successfully' },
  errorCount: { type: 'number', description: 'Number of rows that failed to import' },
  duplicateCount: { type: 'number', description: 'Number of duplicate rows skipped' },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', nullable: true },
  completedAt: { type: 'string', description: 'ISO 8601 completion timestamp', nullable: true },
}
