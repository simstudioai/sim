import { truncate } from '@sim/utils/string'

export const DATAVERSE_MAX_ERROR_BODY_BYTES = 64 * 1024

const DATAVERSE_MAX_ERROR_MESSAGE_CHARACTERS = 2_000
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647
const DATAVERSE_ORGANIZATION_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const DATAVERSE_PUBLIC_HOST_PATTERN = new RegExp(
  `^(${DATAVERSE_ORGANIZATION_LABEL})(?:\\.api)?\\.crm\\d*\\.dynamics\\.com$`
)
const RESERVED_DATAVERSE_ORGANIZATION_LABELS = new Set(['disco', 'globaldisco'])

const DYNAMICS_365_RECORD_ENTITY_SETS = {
  accounts: 'accountid',
  contacts: 'contactid',
  leads: 'leadid',
  opportunities: 'opportunityid',
  incidents: 'incidentid',
} as const

const DYNAMICS_365_LIST_ENTITY_SETS = new Set([
  ...Object.keys(DYNAMICS_365_RECORD_ENTITY_SETS),
  'systemusers',
  'teams',
])

const DYNAMICS_365_SEARCH_LOGICAL_NAMES = new Set([
  'account',
  'contact',
  'lead',
  'opportunity',
  'incident',
])

/**
 * Validates and canonicalizes an online Dataverse environment root URL. Restricting the host to
 * Microsoft's public-cloud Dynamics domains prevents OAuth bearer tokens from being forwarded to
 * a user-controlled origin. National clouds require different OAuth authorities and app
 * registrations, so the existing public-cloud Dataverse credential cannot be used for them.
 */
export function getDynamics365BaseUrl(environmentUrl: string, instanceUrl: string): string {
  const requestedEnvironment = normalizeDynamics365EnvironmentUrl(environmentUrl)
  let credentialEnvironment: string

  try {
    credentialEnvironment = normalizeDynamics365EnvironmentUrl(instanceUrl)
  } catch {
    throw new Error(
      'This Dynamics 365 credential is not bound to a trusted environment. Connect a separate credential for this environment.'
    )
  }

  if (credentialEnvironment !== requestedEnvironment) {
    throw new Error(
      'The selected Dynamics 365 credential belongs to a different environment. Connect or select a credential for this environment.'
    )
  }

  return requestedEnvironment
}

function normalizeDynamics365EnvironmentUrl(environmentUrl: unknown): string {
  if (typeof environmentUrl !== 'string' || environmentUrl.trim().length === 0) {
    throw new Error('Dataverse environment URL must be a non-empty HTTPS URL')
  }

  let url: URL
  try {
    url = new URL(environmentUrl.trim())
  } catch {
    throw new Error('Dataverse environment URL must be a valid HTTPS URL')
  }

  const hostMatch = url.hostname.match(DATAVERSE_PUBLIC_HOST_PATTERN)
  const organizationLabel = hostMatch?.[1]
  const hasTrustedHost =
    organizationLabel !== undefined &&
    !RESERVED_DATAVERSE_ORGANIZATION_LABELS.has(organizationLabel)

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== '' ||
    !hasTrustedHost
  ) {
    throw new Error(
      'Dataverse environment URL must be an HTTPS root URL on a supported public-cloud Microsoft Dynamics host'
    )
  }

  return url.origin
}

export function normalizeDynamics365ListEntitySetName(value: unknown): string {
  if (typeof value !== 'string' || !DYNAMICS_365_LIST_ENTITY_SETS.has(value.trim())) {
    throw new Error('entitySetName must be a supported Dynamics 365 CRM entity set')
  }
  return value.trim()
}

export function getDynamics365RecordEntity(value: unknown): {
  entitySetName: keyof typeof DYNAMICS_365_RECORD_ENTITY_SETS
  primaryIdAttribute: string
} {
  if (typeof value !== 'string' || !Object.hasOwn(DYNAMICS_365_RECORD_ENTITY_SETS, value.trim())) {
    throw new Error('entitySetName must be a supported Dynamics 365 CRM record entity set')
  }
  const entitySetName = value.trim() as keyof typeof DYNAMICS_365_RECORD_ENTITY_SETS
  return {
    entitySetName,
    primaryIdAttribute: DYNAMICS_365_RECORD_ENTITY_SETS[entitySetName],
  }
}

export function normalizeDynamics365SearchEntities(value: unknown): string {
  const fallback = [...DYNAMICS_365_SEARCH_LOGICAL_NAMES].map((name) => ({ name }))
  if (value === undefined || value === null || value === '') return JSON.stringify(fallback)
  if (typeof value !== 'string' || value.length > 10_000) {
    throw new Error('entities must be a bounded JSON array')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('entities must be valid JSON')
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5) {
    throw new Error('entities must contain between 1 and 5 CRM table definitions')
  }
  for (const entity of parsed) {
    if (
      !isDataverseObject(entity) ||
      typeof entity.name !== 'string' ||
      !DYNAMICS_365_SEARCH_LOGICAL_NAMES.has(entity.name)
    ) {
      throw new Error('entities contains an unsupported Dynamics 365 CRM table')
    }
  }
  return JSON.stringify(parsed)
}

/** Normalizes a Dataverse GUID for safe use in OData paths and entity-reference objects. */
export function normalizeDataverseGuid(value: string, fieldName = 'value'): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a valid GUID`)
  }

  const trimmed = value.trim()
  const hasOpeningBrace = trimmed.startsWith('{')
  const hasClosingBrace = trimmed.endsWith('}')
  if (hasOpeningBrace !== hasClosingBrace) {
    throw new Error(`${fieldName} must be a valid GUID`)
  }

  const normalized = hasOpeningBrace ? trimmed.slice(1, -1) : trimmed
  if (!GUID_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be a valid GUID`)
  }

  return normalized
}

/** Validates a direct-execution boolean without JavaScript truthiness coercion. */
export function parseDataverseBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`)
  }
  return value
}

/** Validates an Edm.Int32 input while preserving valid zero and negative status-reason values. */
export function parseDataverseInt32(value: unknown, fieldName: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < INT32_MIN ||
    value > INT32_MAX
  ) {
    throw new Error(`${fieldName} must be a 32-bit integer`)
  }
  return value
}

export function parseDataverseRequiredString(
  value: unknown,
  fieldName: string,
  maxLength?: number
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`)
  }

  const normalized = value.trim()
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} characters`)
  }
  return normalized
}

export function isDataverseObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Reads a bounded Dataverse error body and preserves its documented nested error message. */
export async function getDataverseErrorMessage(response: Response): Promise<string> {
  const fallback = response.statusText.trim()
    ? `Dataverse API error: ${response.status} ${response.statusText}`
    : `Dataverse API error: ${response.status}`

  const body = await readBoundedResponseText(response).catch(() => null)
  if (!body) return fallback

  try {
    const payload: unknown = JSON.parse(body)
    if (isDataverseObject(payload) && isDataverseObject(payload.error)) {
      const message = payload.error.message
      if (typeof message === 'string' && message.trim()) {
        return truncate(message.trim(), DATAVERSE_MAX_ERROR_MESSAGE_CHARACTERS)
      }
    }
  } catch {
    const message = body.replace(/\s+/g, ' ').trim()
    if (message) {
      return truncate(message, DATAVERSE_MAX_ERROR_MESSAGE_CHARACTERS)
    }
  }

  return fallback
}

async function readBoundedResponseText(response: Response): Promise<string | null> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number.parseInt(contentLength, 10)
    if (Number.isFinite(parsedLength) && parsedLength > DATAVERSE_MAX_ERROR_BODY_BYTES) {
      await response.body?.cancel().catch(() => {})
      return null
    }
  }

  if (!response.body) {
    const text = await response.text()
    return new TextEncoder().encode(text).byteLength <= DATAVERSE_MAX_ERROR_BODY_BYTES ? text : null
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      bytesRead += value.byteLength
      if (bytesRead > DATAVERSE_MAX_ERROR_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}
