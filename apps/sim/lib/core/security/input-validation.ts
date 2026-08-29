import { createLogger } from '@sim/logger'
import { evaluateUrl, isLiftableByVouching, policyDefersToAddress } from '@sim/security/egress'
import { isIpLiteral, unwrapIpv6Brackets } from '@sim/security/ssrf'
import {
  describeEgressDenial,
  type EgressProfile,
  resolveEgressPolicy,
} from '@/lib/core/security/egress/profiles'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('InputValidation')

export interface ValidationResult {
  isValid: boolean
  error?: string
  sanitized?: string
}

/** Options for {@link validatePathSegment}. */
interface PathSegmentOptions {
  /** Name of the parameter for error messages */
  paramName?: string
  /** Maximum length allowed (default: 255) */
  maxLength?: number
  /** Allow hyphens (default: true) */
  allowHyphens?: boolean
  /** Allow underscores (default: true) */
  allowUnderscores?: boolean
  /** Allow dots (default: false, to prevent directory traversal) */
  allowDots?: boolean
  /** Custom regex pattern to match */
  customPattern?: RegExp
}

/**
 * Validates a path segment to prevent path traversal and SSRF attacks
 *
 * This function ensures that user-provided input used in URL paths or file paths
 * cannot be used for directory traversal attacks or SSRF.
 *
 * Default behavior:
 * - Allows: letters (a-z, A-Z), numbers (0-9), hyphens (-), underscores (_)
 * - Blocks: dots (.), slashes (/, \), null bytes, URL encoding, and special characters
 *
 * @param value - The path segment to validate
 * @param options - Validation options
 * @returns ValidationResult with isValid flag and optional error message
 *
 * @example
 * ```typescript
 * const result = validatePathSegment(itemId, { paramName: 'itemId' })
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validatePathSegment(
  value: string | null | undefined,
  options: PathSegmentOptions = {}
): ValidationResult {
  const {
    paramName = 'path segment',
    maxLength = 255,
    allowHyphens = true,
    allowUnderscores = true,
    allowDots = false,
    customPattern,
  } = options

  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (value.length > maxLength) {
    logger.warn('Path segment exceeds maximum length', {
      paramName,
      length: value.length,
      maxLength,
    })
    return {
      isValid: false,
      error: `${paramName} exceeds maximum length of ${maxLength} characters`,
    }
  }

  if (value.includes('\0') || value.includes('%00')) {
    logger.warn('Path segment contains null bytes', { paramName })
    return {
      isValid: false,
      error: `${paramName} contains invalid characters`,
    }
  }

  const pathTraversalPatterns = [
    '..',
    './',
    '.\\.',
    '%2e%2e',
    '%252e%252e',
    '..%2f',
    '..%5c',
    '%2e%2e%2f',
    '%2e%2e/',
    '..%252f',
  ]

  const lowerValue = value.toLowerCase()
  for (const pattern of pathTraversalPatterns) {
    if (lowerValue.includes(pattern.toLowerCase())) {
      logger.warn('Path traversal attempt detected', {
        paramName,
        pattern,
        value: value.substring(0, 100),
      })
      return {
        isValid: false,
        error: `${paramName} contains invalid path traversal sequences`,
      }
    }
  }

  if (value.includes('/') || value.includes('\\')) {
    logger.warn('Path segment contains directory separators', { paramName })
    return {
      isValid: false,
      error: `${paramName} cannot contain directory separators`,
    }
  }

  if (customPattern) {
    if (!customPattern.test(value)) {
      logger.warn('Path segment failed custom pattern validation', {
        paramName,
        pattern: customPattern.toString(),
      })
      return {
        isValid: false,
        error: `${paramName} format is invalid`,
      }
    }
    return { isValid: true, sanitized: value }
  }

  let pattern = '^[a-zA-Z0-9'
  if (allowHyphens) pattern += '\\-'
  if (allowUnderscores) pattern += '_'
  if (allowDots) pattern += '\\.'
  pattern += ']+$'

  const regex = new RegExp(pattern)

  if (!regex.test(value)) {
    logger.warn('Path segment contains disallowed characters', {
      paramName,
      value: value.substring(0, 100),
    })
    return {
      isValid: false,
      error: `${paramName} can only contain alphanumeric characters${allowHyphens ? ', hyphens' : ''}${allowUnderscores ? ', underscores' : ''}${allowDots ? ', dots' : ''}`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates an alphanumeric ID (letters, numbers, hyphens, underscores only)
 *
 * @param value - The ID to validate
 * @param paramName - Name of the parameter for error messages
 * @param maxLength - Maximum length (default: 100)
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateAlphanumericId(userId, 'userId')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateAlphanumericId(
  value: string | null | undefined,
  paramName = 'ID',
  maxLength = 100
): ValidationResult {
  return validatePathSegment(value, {
    paramName,
    maxLength,
    allowHyphens: true,
    allowUnderscores: true,
    allowDots: false,
  })
}

/**
 * Validates a numeric ID
 *
 * @param value - The ID to validate
 * @param paramName - Name of the parameter for error messages
 * @param options - Additional options (min, max)
 * @returns ValidationResult with sanitized number as string
 *
 * @example
 * ```typescript
 * const result = validateNumericId(pageNumber, 'pageNumber', { min: 1, max: 1000 })
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateNumericId(
  value: string | number | null | undefined,
  paramName = 'ID',
  options: { min?: number; max?: number } = {}
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  const num = typeof value === 'number' ? value : Number(value)

  if (Number.isNaN(num) || !Number.isFinite(num)) {
    logger.warn('Invalid numeric ID', { paramName, value })
    return {
      isValid: false,
      error: `${paramName} must be a valid number`,
    }
  }

  if (options.min !== undefined && num < options.min) {
    return {
      isValid: false,
      error: `${paramName} must be at least ${options.min}`,
    }
  }

  if (options.max !== undefined && num > options.max) {
    return {
      isValid: false,
      error: `${paramName} must be at most ${options.max}`,
    }
  }

  return { isValid: true, sanitized: num.toString() }
}

/**
 * Validates that a value is in an allowed list (enum validation)
 *
 * @param value - The value to validate
 * @param allowedValues - Array of allowed values
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateEnum(type, ['note', 'contact', 'task'], 'type')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateEnum<T extends string>(
  value: string | null | undefined,
  allowedValues: readonly T[],
  paramName = 'value'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (!allowedValues.includes(value as T)) {
    logger.warn('Value not in allowed list', {
      paramName,
      value,
      allowedValues,
    })
    return {
      isValid: false,
      error: `${paramName} must be one of: ${allowedValues.join(', ')}`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates Microsoft Graph API resource IDs
 *
 * Microsoft Graph IDs can be complex - for example, SharePoint site IDs can include:
 * - "root" (literal string)
 * - GUIDs
 * - Hostnames with colons and slashes (e.g., "hostname:/sites/sitename")
 * - Group paths (e.g., "groups/{guid}/sites/root")
 *
 * This function allows these legitimate patterns while blocking path traversal.
 *
 * @param value - The Microsoft Graph ID to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateMicrosoftGraphId(siteId, 'siteId')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateMicrosoftGraphId(
  value: string | null | undefined,
  paramName = 'ID'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  const pathTraversalPatterns = [
    '../',
    '..\\',
    '%2e%2e%2f',
    '%2e%2e/',
    '..%2f',
    '%2e%2e%5c',
    '%2e%2e\\',
    '..%5c',
    '%252e%252e%252f',
  ]

  const lowerValue = value.toLowerCase()
  for (const pattern of pathTraversalPatterns) {
    if (lowerValue.includes(pattern)) {
      logger.warn('Path traversal attempt in Microsoft Graph ID', {
        paramName,
        value: value.substring(0, 100),
      })
      return {
        isValid: false,
        error: `${paramName} contains invalid path traversal sequence`,
      }
    }
  }

  if (/[\x00-\x1f\x7f]/.test(value) || value.includes('%00')) {
    logger.warn('Control characters in Microsoft Graph ID', { paramName })
    return {
      isValid: false,
      error: `${paramName} contains invalid control characters`,
    }
  }

  if (value.includes('\n') || value.includes('\r')) {
    return {
      isValid: false,
      error: `${paramName} contains invalid newline characters`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates SharePoint site IDs used in Microsoft Graph API.
 *
 * Site IDs are compound identifiers: `hostname,spsite-guid,spweb-guid`
 * (e.g. `contoso.sharepoint.com,2C712604-1370-44E7-A1F5-426573FDA80A,2D2244C3-251A-49EA-93A8-39E1C3A060FE`).
 * The API also accepts partial forms like a single GUID or just a hostname.
 *
 * Allowed characters: alphanumeric, periods, hyphens, and commas.
 *
 * @param value - The SharePoint site ID to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 */
export function validateSharePointSiteId(
  value: string | null | undefined,
  paramName = 'siteId'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (value.length > 512) {
    return {
      isValid: false,
      error: `${paramName} exceeds maximum length`,
    }
  }

  if (!/^[a-zA-Z0-9.\-,]+$/.test(value)) {
    logger.warn('Invalid characters in SharePoint site ID', {
      paramName,
      value: value.substring(0, 100),
    })
    return {
      isValid: false,
      error: `${paramName} contains invalid characters`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates Jira Cloud IDs (typically UUID format)
 *
 * @param value - The Jira Cloud ID to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateJiraCloudId(cloudId, 'cloudId')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateJiraCloudId(
  value: string | null | undefined,
  paramName = 'cloudId'
): ValidationResult {
  return validatePathSegment(value, {
    paramName,
    allowHyphens: true,
    allowUnderscores: false,
    allowDots: false,
    maxLength: 100,
  })
}

/**
 * Validates Jira issue keys (format: PROJECT-123 or PROJECT-KEY-123)
 *
 * @param value - The Jira issue key to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateJiraIssueKey(issueKey, 'issueKey')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateJiraIssueKey(
  value: string | null | undefined,
  paramName = 'issueKey'
): ValidationResult {
  return validatePathSegment(value, {
    paramName,
    allowHyphens: true,
    allowUnderscores: false,
    allowDots: false,
    maxLength: 255,
  })
}

/**
 * Synchronous, pre-DNS egress check for a URL.
 *
 * This is the cheap half of the guard: it rejects a bad scheme, a denied port,
 * and a disallowed IP literal without a lookup. A hostname it accepts is NOT
 * cleared to be dialed — only {@link validateUrlWithDNS} can do that, because
 * only a resolved address can be classified. Use this for form/contract
 * validation; use the DNS-resolving variant before connecting.
 *
 * It also declines to refuse anything the resolved address could permit, so a
 * destination allowlisted by IP range is still configurable.
 *
 * @param url - The URL to validate
 * @param paramName - Name of the parameter for error messages
 * @param profile - Where this URL came from; see {@link EgressProfile}
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateExternalUrl(url, 'fileUrl', 'configuredEndpoint')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateExternalUrl(
  url: string | null | undefined,
  paramName: string,
  profile: EgressProfile
): ValidationResult {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: `${paramName} is required and must be a string` }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { isValid: false, error: `${paramName} must be a valid URL` }
  }

  const policy = resolveEgressPolicy(profile)
  const decision = evaluateUrl(parsed, policy)
  if (decision.allowed) return { isValid: true }

  // A refusal the resolved address could lift is not this check's to make: a
  // host permitted only by EGRESS_ALLOWED_IP_RANGES cannot be recognised until
  // DNS runs, and refusing here would stop it being configured at all.
  // validateUrlWithDNS makes the authoritative call before anything is dialled.
  //
  // Only for a hostname. A literal was judged against its own address, so there
  // is nothing a lookup could add and deferring would accept a literal outside
  // every configured range.
  if (
    !isIpLiteral(unwrapIpv6Brackets(parsed.hostname)) &&
    policyDefersToAddress(policy) &&
    isLiftableByVouching(decision.reason)
  ) {
    return { isValid: true }
  }

  return { isValid: false, error: describeEgressDenial(decision, paramName, profile) }
}

/**
 * Validates an Airtable ID (base, table, or webhook ID)
 *
 * Airtable IDs have specific prefixes:
 * - Base IDs: "app" + 14 alphanumeric characters (e.g., appXXXXXXXXXXXXXX)
 * - Table IDs: "tbl" + 14 alphanumeric characters
 * - Webhook IDs: "ach" + 14 alphanumeric characters
 *
 * @param value - The ID to validate
 * @param expectedPrefix - The expected prefix ('app', 'tbl', or 'ach')
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateAirtableId(baseId, 'app', 'baseId')
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateAirtableId(
  value: string | null | undefined,
  expectedPrefix: 'app' | 'tbl' | 'ach',
  paramName = 'ID'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  const airtableIdPattern = new RegExp(`^${expectedPrefix}[a-zA-Z0-9]{14}$`)

  if (!airtableIdPattern.test(value)) {
    logger.warn('Invalid Airtable ID format', {
      paramName,
      expectedPrefix,
      value: value.substring(0, 20),
    })
    return {
      isValid: false,
      error: `${paramName} must be a valid Airtable ID starting with "${expectedPrefix}"`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates an AWS region identifier
 *
 * Supported region formats:
 * - Standard: us-east-1, eu-west-2, ap-southeast-1, sa-east-1, af-south-1
 * - GovCloud: us-gov-east-1, us-gov-west-1
 * - China: cn-north-1, cn-northwest-1
 * - Israel: il-central-1
 * - ISO partitions: us-iso-east-1, us-iso-west-1, us-isob-east-1
 * - Mexico: mx-central-1
 * - EU Sovereign Cloud: eu-isoe-west-1
 * - European Sovereign Cloud: eusc-de-east-1
 *
 * @param value - The AWS region to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateAwsRegion(region, 'region')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateAwsRegion(
  value: string | null | undefined,
  paramName = 'region'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  const awsRegionPattern =
    /^(eu-isoe|eusc-[a-z]{2}|us-isob|us-iso|us-gov|af|ap|ca|cn|eu|il|me|mx|sa|us)-(central|north|northeast|northwest|south|southeast|southwest|east|west)-\d{1,2}$/

  if (!awsRegionPattern.test(value)) {
    logger.warn('Invalid AWS region format', {
      paramName,
      value: value.substring(0, 50),
    })
    return {
      isValid: false,
      error: `${paramName} must be a valid AWS region (e.g., us-east-1, eu-west-2, us-gov-west-1)`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates a Google Cloud location (region) identifier.
 *
 * Google SDKs interpolate this value directly into the API hostname
 * (`https://{location}-aiplatform.googleapis.com/`), so an unvalidated value
 * containing `/`, `:`, `@`, or whitespace can terminate the authority component
 * and relocate the request — along with any attached credential — to an
 * attacker-controlled host.
 *
 * Accepts `global` plus the documented `{geography}-{direction}{index}` region
 * form (e.g. us-central1, europe-west4, northamerica-northeast1, me-central2).
 *
 * @param value - The location to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 */
export function validateGoogleCloudLocation(
  value: string | null | undefined,
  paramName = 'location'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return { isValid: false, error: `${paramName} is required` }
  }

  const googleLocationPattern =
    /^(global|(africa|asia|australia|europe|me|northamerica|southamerica|us)-(central|east|north|northeast|northwest|south|southeast|southwest|west)\d{1,2})$/

  if (!googleLocationPattern.test(value)) {
    logger.warn('Invalid Google Cloud location format', {
      paramName,
      value: value.substring(0, 50),
    })
    return {
      isValid: false,
      error: `${paramName} must be a valid Google Cloud location (e.g., us-central1, europe-west4, global)`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates a Google Cloud project identifier.
 *
 * Accepts either a project ID (6-30 chars, starts with a lowercase letter,
 * lowercase letters/digits/hyphens, no trailing hyphen) or a numeric project
 * number. This value is interpolated into the API URL path, so anything that
 * could introduce path or authority separators is rejected.
 *
 * @param value - The project to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 */
export function validateGoogleCloudProject(
  value: string | null | undefined,
  paramName = 'project'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return { isValid: false, error: `${paramName} is required` }
  }

  const projectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
  const projectNumberPattern = /^\d{1,20}$/

  if (!projectIdPattern.test(value) && !projectNumberPattern.test(value)) {
    logger.warn('Invalid Google Cloud project format', {
      paramName,
      value: value.substring(0, 50),
    })
    return {
      isValid: false,
      error: `${paramName} must be a valid Google Cloud project ID or project number`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates an S3 bucket name according to AWS naming rules
 *
 * S3 bucket names must:
 * - Be 3-63 characters long
 * - Start and end with a letter or number
 * - Contain only lowercase letters, numbers, and hyphens
 * - Not contain consecutive periods
 * - Not be formatted as an IP address
 *
 * @param value - The S3 bucket name to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateS3BucketName(bucket, 'bucket')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateS3BucketName(
  value: string | null | undefined,
  paramName = 'bucket'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (value.length < 3 || value.length > 63) {
    logger.warn('S3 bucket name length invalid', {
      paramName,
      length: value.length,
    })
    return {
      isValid: false,
      error: `${paramName} must be between 3 and 63 characters`,
    }
  }

  const bucketNamePattern = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/

  if (!bucketNamePattern.test(value)) {
    logger.warn('Invalid S3 bucket name format', {
      paramName,
      value: value.substring(0, 63),
    })
    return {
      isValid: false,
      error: `${paramName} must start and end with a letter or number, and contain only lowercase letters, numbers, hyphens, and periods`,
    }
  }

  if (value.includes('..')) {
    logger.warn('S3 bucket name contains consecutive periods', { paramName })
    return {
      isValid: false,
      error: `${paramName} cannot contain consecutive periods`,
    }
  }

  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/
  if (ipPattern.test(value)) {
    logger.warn('S3 bucket name formatted as IP address', { paramName })
    return {
      isValid: false,
      error: `${paramName} cannot be formatted as an IP address`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates a pagination cursor token
 *
 * Pagination cursors are opaque tokens returned by APIs (e.g., Confluence, Jira)
 * and passed back to get the next page. They are typically base64-encoded or
 * URL-safe strings. This validator ensures the cursor cannot contain characters
 * that could alter URL structure.
 *
 * @param value - The cursor token to validate
 * @param paramName - Name of the parameter for error messages
 * @param maxLength - Maximum length (default: 1024)
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * if (cursor) {
 *   const result = validatePaginationCursor(cursor, 'cursor')
 *   if (!result.isValid) {
 *     return NextResponse.json({ error: result.error }, { status: 400 })
 *   }
 * }
 * ```
 */
export function validatePaginationCursor(
  value: string | null | undefined,
  paramName = 'cursor',
  maxLength = 1024
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (value.length > maxLength) {
    logger.warn('Pagination cursor exceeds maximum length', {
      paramName,
      length: value.length,
      maxLength,
    })
    return {
      isValid: false,
      error: `${paramName} exceeds maximum length of ${maxLength} characters`,
    }
  }

  if (/[\x00-\x1f\x7f]/.test(value) || value.includes('%00')) {
    logger.warn('Pagination cursor contains control characters', { paramName })
    return {
      isValid: false,
      error: `${paramName} contains invalid characters`,
    }
  }

  const cursorPattern = /^[A-Za-z0-9+/=\-_.~%]+$/
  if (!cursorPattern.test(value)) {
    logger.warn('Pagination cursor contains disallowed characters', {
      paramName,
      value: value.substring(0, 100),
    })
    return {
      isValid: false,
      error: `${paramName} contains invalid characters`,
    }
  }

  return { isValid: true, sanitized: value }
}

const CALLBACK_URL_SERVER_BASE = 'https://callback-url-validator.invalid'

/**
 * Origin a callback URL is resolved and compared against.
 *
 * The browser uses its own origin. Server-side there is no `window`, so it uses
 * the deployment's configured origin — which is what the browser will compare
 * against once it hydrates. Using a sentinel here instead made the server reject
 * every absolute URL, including the same-origin ones this function documents as
 * valid, so a component deriving a callback URL during render produced one
 * destination in the SSR markup and a different one after hydration.
 *
 * Falls back to the sentinel when the app URL is unset or unparseable, which
 * keeps the server fail-closed: every absolute URL is rejected, as before.
 */
function getCallbackValidationOrigin(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  try {
    return new URL(getBaseUrl()).origin
  } catch {
    return CALLBACK_URL_SERVER_BASE
  }
}

/**
 * Validates a callback URL to prevent open redirect attacks.
 *
 * Accepts:
 * - Same-origin relative references (e.g. `/workspace`, `/invite/abc?foo=bar`, `?q=1`)
 * - Absolute URLs whose origin matches the current origin
 *
 * Rejects:
 * - Cross-origin absolute URLs
 * - Protocol-relative URLs (`//evil.com`) and backslash variants (`/\evil.com`,
 *   `\\evil.com`), which browsers resolve to an external origin
 * - Whitespace/control-character bypasses (`/\t/evil.com`, `/\n/evil.com`) — the
 *   WHATWG URL parser strips these everywhere in the input, collapsing the value
 *   to a protocol-relative reference
 * - Userinfo smuggling (`https://trusted.com@evil.com`)
 * - Opaque-origin schemes (`javascript:`, `data:`, `vbscript:`, etc.)
 *
 * Delegates parsing to `new URL()` so validation matches the browser's resolution
 * when the value is later assigned to `window.location.href`. This mirrors the
 * reference pattern from next-auth and follows the OWASP Unvalidated Redirects
 * cheat sheet guidance to never validate URLs with string operations.
 *
 * @param url - The callback URL to validate
 * @returns true if the URL is safe to redirect to
 */
export function validateCallbackUrl(url: string): boolean {
  try {
    if (typeof url !== 'string' || url.length === 0) return false

    const base = getCallbackValidationOrigin()
    const parsed = new URL(url, base)
    return parsed.origin === base
  } catch (error) {
    logger.error('Error validating callback URL:', { error, url })
    return false
  }
}

const OKTA_DOMAIN_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9-]*\.(okta|okta-gov|okta-emea|oktapreview|trexcloud)\.com$/

/**
 * Validates and sanitizes an Okta domain to prevent SSRF.
 * Ensures the domain matches a known Okta domain suffix.
 *
 * @param rawDomain - The raw domain string (may include protocol, trailing slash, or whitespace)
 * @returns The cleaned, validated domain string
 * @throws Error if the domain does not match a known Okta domain suffix
 *
 * @example
 * ```typescript
 * const domain = validateOktaDomain(params.domain)
 * // Returns: "dev-123456.okta.com"
 * ```
 */
export function validateOktaDomain(rawDomain: string): string {
  const domain = rawDomain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
  if (!OKTA_DOMAIN_PATTERN.test(domain)) {
    throw new Error(
      `Invalid Okta domain: "${domain}". Must be a valid Okta domain (e.g., dev-123456.okta.com)`
    )
  }
  return domain
}

const MICROSOFT_CONTENT_SUFFIXES = [
  'sharepoint.com',
  'sharepoint.us',
  'sharepoint.de',
  'sharepoint.cn',
  'sharepointonline.com',
  'onedrive.com',
  'onedrive.live.com',
  '1drv.ms',
  '1drv.com',
  'microsoftpersonalcontent.com',
] as const

/**
 * Returns true if the given URL is hosted on a trusted Microsoft SharePoint or
 * OneDrive domain. Validates the parsed hostname against an allowlist using exact
 * match or subdomain suffix, preventing incomplete-substring bypasses.
 *
 * Covers SharePoint Online (commercial, GCC/GCC High/DoD, Germany, China),
 * OneDrive business and consumer, OneDrive short-link and CDN domains,
 * and Microsoft personal content CDN.
 *
 * @see https://learn.microsoft.com/en-us/sharepoint/required-urls-and-ports
 * @see https://learn.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-u-s-government-gcc-high-endpoints
 *
 * @param url - The URL to check
 * @returns Whether the URL belongs to a trusted Microsoft content host
 */
/**
 * Validates a Monday.com numeric ID (board, item, webhook, workspace, user IDs).
 *
 * Monday.com uses numeric integer IDs for boards, items, webhooks, workspaces, and users.
 * These are always positive integers, represented as strings in GraphQL `ID!` scalars.
 *
 * @param value - The ID to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateMondayNumericId(boardId, 'boardId')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateMondayNumericId(
  value: string | number | null | undefined,
  paramName = 'ID'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  const str = String(value).trim()

  if (!/^\d+$/.test(str)) {
    logger.warn('Monday.com ID is not a valid numeric integer', {
      paramName,
      value: str.substring(0, 50),
    })
    return {
      isValid: false,
      error: `${paramName} must be a numeric integer`,
    }
  }

  return { isValid: true, sanitized: str }
}

/**
 * Validates a Supabase project ID.
 *
 * Supabase project IDs are 20-character lowercase alphanumeric strings
 * (e.g. "jdrkgepadsdopsntdlom"). This validator ensures the value cannot
 * contain URL-fragment (`#`), path-separator, or other characters that
 * would let an attacker break out of the `*.supabase.co` domain when the
 * ID is interpolated into a URL template.
 *
 * @param value - The project ID to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 */
export function validateSupabaseProjectId(
  value: string | null | undefined,
  paramName = 'projectId'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (!/^[a-z0-9]+$/.test(value)) {
    logger.warn('Invalid Supabase project ID format', {
      paramName,
      value: value.substring(0, 50),
    })
    return {
      isValid: false,
      error: `${paramName} must contain only lowercase alphanumeric characters`,
    }
  }

  if (value.length < 10 || value.length > 40) {
    logger.warn('Supabase project ID length invalid', {
      paramName,
      length: value.length,
    })
    return {
      isValid: false,
      error: `${paramName} must be between 10 and 40 characters`,
    }
  }

  return { isValid: true, sanitized: value }
}

export function isMicrosoftContentUrl(url: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return MICROSOFT_CONTENT_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  )
}

const SERVICENOW_ALLOWED_HOST_SUFFIXES = [
  '.service-now.com',
  '.servicenow.com',
  '.servicenowservices.com',
] as const

/**
 * Validates a vendor-hosted URL: an ordinary egress check, then a hostname
 * allowlist that pins it to the vendor's own domains.
 *
 * The allowlist is what makes these connectors safe to point at a
 * customer-supplied tenant: egress validation alone would accept any public
 * host, so a tenant field would otherwise be an open redirect for credentials
 * scoped to that vendor.
 *
 * @param url - The URL or bare host to validate
 * @param options.suffixes - Permitted host suffixes, each written with a leading dot
 * @param options.vendor - Vendor name, used in the error message
 * @param options.paramName - Name of the parameter for error messages
 * @param options.assumeHttps - Accept a bare host by prepending `https://`
 * @param options.sanitize - What to return as `sanitized`: the input, or the parsed origin
 * @param options.allowBareSuffix - Also accept the suffix itself as a hostname
 */
function validateVendorHostedUrl(
  url: string | null | undefined,
  options: {
    suffixes: readonly string[]
    vendor: string
    paramName: string
    assumeHttps?: boolean
    sanitize?: 'input' | 'origin'
    allowBareSuffix?: boolean
  }
): ValidationResult {
  const {
    suffixes,
    vendor,
    paramName,
    assumeHttps = false,
    sanitize = 'input',
    allowBareSuffix = true,
  } = options

  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) {
    return { isValid: false, error: `${paramName} is required` }
  }

  const candidate = assumeHttps && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw

  // These vendors are public SaaS reached over TLS. Enforced here rather than
  // left to the egress policy, which would permit plain HTTP to a host an
  // operator happened to put in their allowlist.
  if (/^http:\/\//i.test(candidate)) {
    return { isValid: false, error: `${paramName} must use https://` }
  }

  const urlResult = validateExternalUrl(candidate, paramName, 'configuredEndpoint')
  if (!urlResult.isValid) return urlResult

  const parsed = new URL(candidate)
  const hostname = parsed.hostname.toLowerCase()
  const allowed = suffixes.some(
    (suffix) => (allowBareSuffix && hostname === suffix.slice(1)) || hostname.endsWith(suffix)
  )

  if (!allowed) {
    logger.warn(`${vendor} host not on allowlist`, {
      paramName,
      hostname: hostname.substring(0, 100),
    })
    return {
      isValid: false,
      error: `${paramName} must be a ${vendor}-hosted domain (e.g., ${suffixes
        .map((suffix) => `*${suffix}`)
        .join(', ')})`,
    }
  }

  return { isValid: true, sanitized: sanitize === 'origin' ? parsed.origin : candidate }
}

/**
 * Validates a ServiceNow instance URL to prevent SSRF attacks.
 *
 * ServiceNow instances are SaaS endpoints hosted on ServiceNow-owned domains.
 * Example valid formats:
 * - https://acme.service-now.com (standard commercial instances)
 * - https://acme.servicenow.com (newer commercial domain)
 * - https://acme.servicenowservices.com (GovCloud/FedRAMP)
 *
 * This validator ensures the URL:
 * - Is a valid HTTPS URL (reuses validateExternalUrl for IP/localhost/port checks)
 * - Has a hostname ending in a trusted ServiceNow-owned domain suffix
 *
 * Note: Customers using the Custom URLs plugin to front their instance with a
 * vanity CNAME (e.g. support.acme.com) will be rejected. Point the connector at
 * the underlying `*.service-now.com` host instead.
 *
 * @param url - The instance URL to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateServiceNowInstanceUrl(instanceUrl)
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateServiceNowInstanceUrl(
  url: string | null | undefined,
  paramName = 'instanceUrl'
): ValidationResult {
  return validateVendorHostedUrl(url, {
    suffixes: SERVICENOW_ALLOWED_HOST_SUFFIXES,
    vendor: 'ServiceNow',
    paramName,
  })
}

const WORKDAY_ALLOWED_HOST_SUFFIXES = ['.workday.com', '.myworkday.com'] as const

/**
 * Validates a Workday tenant URL to prevent SSRF attacks.
 *
 * Workday tenant URLs are SaaS endpoints hosted on Workday-owned domains.
 * Example valid formats:
 * - https://wd2-impl-services1.workday.com (implementation/sandbox tenants)
 * - https://wd5-services1.workday.com (production)
 * - https://wd5-services1.myworkday.com (production, customer-facing endpoint)
 *
 * This validator ensures the URL:
 * - Is a valid HTTPS URL (reuses validateExternalUrl for IP/localhost/port checks)
 * - Has a hostname ending in a trusted Workday-owned domain suffix
 *
 * @param url - The tenant URL to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateWorkdayTenantUrl(tenantUrl)
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateWorkdayTenantUrl(
  url: string | null | undefined,
  paramName = 'tenantUrl'
): ValidationResult {
  return validateVendorHostedUrl(url, {
    suffixes: WORKDAY_ALLOWED_HOST_SUFFIXES,
    vendor: 'Workday',
    paramName,
  })
}

/**
 * Every production Databricks control-plane DNS zone, mirroring `ALL_ENVS` in the
 * Databricks SDK (`databricks/sdk/environments.py`). The SDK's `.dev.*`/`.staging.*`
 * zones are internal and deliberately omitted; the ones that are subdomains of a
 * zone listed here (e.g. `.staging.cloud.databricks.com`) match by suffix anyway.
 */
const DATABRICKS_ALLOWED_HOST_SUFFIXES = [
  '.cloud.databricks.com',
  '.cloud.databricks.us',
  '.gcp.databricks.com',
  '.azuredatabricks.net',
  '.databricks.azure.us',
  '.databricks.azure.cn',
] as const

/**
 * Validates a Databricks workspace host to prevent SSRF attacks.
 *
 * Databricks is host-scoped: every workspace has its own per-workspace URL, and
 * every REST call is made against it. Example valid hosts:
 * - dbc-1234abcd-5678.cloud.databricks.com (AWS)
 * - dbc-1234abcd-5678.cloud.databricks.us (AWS GovCloud)
 * - adb-1234567890123456.7.azuredatabricks.net (Azure)
 * - adb-1234567890123456.7.databricks.azure.us (Azure US Government)
 * - adb-1234567890123456.7.databricks.azure.cn (Azure China)
 * - 1234567890123456.7.gcp.databricks.com (GCP)
 *
 * The value is user-supplied and fetched server-side, so it is normalized to an
 * https origin and then checked against a Databricks-owned domain allowlist.
 * Users routinely paste a full console URL (a `#notebook/123` deep link, a
 * trailing slash, a `?o=<workspace-id>` query); every API path is built by
 * appending `/api/2.0/...`, so any surviving path, query or fragment would
 * produce a 404. `URL.origin` also lower-cases the host and drops the default
 * port.
 *
 * Note: legacy regional URLs (`https://oregon.cloud.databricks.com`) match the
 * allowlist but are not recommended by Databricks — point the connector at the
 * per-workspace URL instead.
 *
 * @param host - The workspace host or URL to validate, with or without a scheme
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult whose `sanitized` value is the https origin
 *
 * @example
 * ```typescript
 * const result = validateDatabricksWorkspaceHost(workspaceHost)
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateDatabricksWorkspaceHost(
  host: string | null | undefined,
  paramName = 'workspaceHost'
): ValidationResult {
  return validateVendorHostedUrl(host, {
    suffixes: DATABRICKS_ALLOWED_HOST_SUFFIXES,
    vendor: 'Databricks',
    paramName,
    assumeHttps: true,
    sanitize: 'origin',
    allowBareSuffix: false,
  })
}

/**
 * Validates a database identifier (table or column name) to prevent SQL injection.
 *
 * Accepts only identifiers that start with a letter or underscore and contain
 * only letters, digits, and underscores — the safe subset of SQL identifiers.
 *
 * @param value - The identifier to validate
 * @param paramName - Name of the parameter for error messages (e.g. 'table', 'column')
 * @returns ValidationResult with isValid flag and optional error message
 */
export function validateDatabaseIdentifier(
  value: unknown,
  paramName = 'identifier'
): ValidationResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { isValid: false, error: `${paramName} is required` }
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    logger.warn('Invalid database identifier', { paramName, value: value.substring(0, 100) })
    return {
      isValid: false,
      error: `Invalid ${paramName}: must start with a letter or underscore and contain only letters, digits, and underscores`,
    }
  }
  return { isValid: true, sanitized: value }
}
