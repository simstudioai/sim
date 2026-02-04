import { createLogger } from '@sim/logger'
import * as ipaddr from 'ipaddr.js'

const logger = createLogger('InputValidation')

export interface ValidationResult {
  isValid: boolean
  error?: string
  sanitized?: string
}

export interface PathSegmentOptions {
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
    '.\\.', // Windows path traversal
    '%2e%2e', // URL encoded ..
    '%252e%252e', // Double URL encoded ..
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
 * Validates an integer value (from JSON body or other sources)
 *
 * This is stricter than validateNumericId - it requires:
 * - Value must already be a number type (not string)
 * - Must be an integer (no decimals)
 * - Must be finite (not NaN or Infinity)
 *
 * @param value - The value to validate
 * @param paramName - Name of the parameter for error messages
 * @param options - Additional options (min, max)
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateInteger(failedCount, 'failedCount', { min: 0 })
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateInteger(
  value: unknown,
  paramName = 'value',
  options: { min?: number; max?: number } = {}
): ValidationResult {
  if (value === null || value === undefined) {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (typeof value !== 'number') {
    logger.warn('Value is not a number', { paramName, valueType: typeof value })
    return {
      isValid: false,
      error: `${paramName} must be a number`,
    }
  }

  if (Number.isNaN(value) || !Number.isFinite(value)) {
    logger.warn('Invalid number value', { paramName, value })
    return {
      isValid: false,
      error: `${paramName} must be a valid number`,
    }
  }

  if (!Number.isInteger(value)) {
    logger.warn('Value is not an integer', { paramName, value })
    return {
      isValid: false,
      error: `${paramName} must be an integer`,
    }
  }

  if (options.min !== undefined && value < options.min) {
    return {
      isValid: false,
      error: `${paramName} must be at least ${options.min}`,
    }
  }

  if (options.max !== undefined && value > options.max) {
    return {
      isValid: false,
      error: `${paramName} must be at most ${options.max}`,
    }
  }

  return { isValid: true }
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
 * Validates a hostname to prevent SSRF attacks
 *
 * This function checks that a hostname is not a private IP, localhost, or other reserved address.
 * It complements the validateProxyUrl function by providing hostname-specific validation.
 *
 * @param hostname - The hostname to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateHostname(webhookDomain, 'webhook domain')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateHostname(
  hostname: string | null | undefined,
  paramName = 'hostname'
): ValidationResult {
  if (hostname === null || hostname === undefined || hostname === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  const lowerHostname = hostname.toLowerCase()

  // Block localhost
  if (lowerHostname === 'localhost') {
    logger.warn('Hostname is localhost', { paramName })
    return {
      isValid: false,
      error: `${paramName} cannot be a private IP address or localhost`,
    }
  }

  // Use ipaddr.js to check if hostname is an IP and if it's private/reserved
  if (ipaddr.isValid(lowerHostname)) {
    if (isPrivateOrReservedIP(lowerHostname)) {
      logger.warn('Hostname matches blocked IP range', {
        paramName,
        hostname: hostname.substring(0, 100),
      })
      return {
        isValid: false,
        error: `${paramName} cannot be a private IP address or localhost`,
      }
    }
  }

  // Basic hostname format validation
  const hostnamePattern =
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i

  if (!hostnamePattern.test(hostname)) {
    logger.warn('Invalid hostname format', {
      paramName,
      hostname: hostname.substring(0, 100),
    })
    return {
      isValid: false,
      error: `${paramName} is not a valid hostname`,
    }
  }

  return { isValid: true, sanitized: hostname }
}

/**
 * Validates a file extension
 *
 * @param extension - The file extension (with or without leading dot)
 * @param allowedExtensions - Array of allowed extensions (without dots)
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateFileExtension(ext, ['jpg', 'png', 'gif'], 'file extension')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateFileExtension(
  extension: string | null | undefined,
  allowedExtensions: readonly string[],
  paramName = 'file extension'
): ValidationResult {
  if (extension === null || extension === undefined || extension === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  // Remove leading dot if present
  const ext = extension.startsWith('.') ? extension.slice(1) : extension

  // Normalize to lowercase
  const normalizedExt = ext.toLowerCase()

  if (!allowedExtensions.map((e) => e.toLowerCase()).includes(normalizedExt)) {
    logger.warn('File extension not in allowed list', {
      paramName,
      extension: ext,
      allowedExtensions,
    })
    return {
      isValid: false,
      error: `${paramName} must be one of: ${allowedExtensions.join(', ')}`,
    }
  }

  return { isValid: true, sanitized: normalizedExt }
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

  // Check for path traversal patterns (../)
  const pathTraversalPatterns = [
    '../',
    '..\\',
    '%2e%2e%2f',
    '%2e%2e/',
    '..%2f',
    '%2e%2e%5c',
    '%2e%2e\\',
    '..%5c',
    '%252e%252e%252f', // double encoded
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

  // Check for control characters and null bytes
  if (/[\x00-\x1f\x7f]/.test(value) || value.includes('%00')) {
    logger.warn('Control characters in Microsoft Graph ID', { paramName })
    return {
      isValid: false,
      error: `${paramName} contains invalid control characters`,
    }
  }

  // Check for newlines (which could be used for header injection)
  if (value.includes('\n') || value.includes('\r')) {
    return {
      isValid: false,
      error: `${paramName} contains invalid newline characters`,
    }
  }

  // Microsoft Graph IDs can contain many characters, but not suspicious patterns
  // We've blocked path traversal, so allow the rest
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
  // Jira cloud IDs are alphanumeric with hyphens (UUID-like)
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
  // Jira issue keys: letters, numbers, hyphens (PROJECT-123 format)
  return validatePathSegment(value, {
    paramName,
    allowHyphens: true,
    allowUnderscores: false,
    allowDots: false,
    maxLength: 255,
  })
}

/**
 * Validates a URL to prevent SSRF attacks
 *
 * This function checks that URLs:
 * - Use https:// protocol only
 * - Do not point to private IP ranges or localhost
 * - Do not use suspicious ports
 *
 * @param url - The URL to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateExternalUrl(url, 'fileUrl')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateExternalUrl(
  url: string | null | undefined,
  paramName = 'url'
): ValidationResult {
  if (!url || typeof url !== 'string') {
    return {
      isValid: false,
      error: `${paramName} is required and must be a string`,
    }
  }

  // Must be a valid URL
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return {
      isValid: false,
      error: `${paramName} must be a valid URL`,
    }
  }

  // Only allow https protocol
  if (parsedUrl.protocol !== 'https:') {
    return {
      isValid: false,
      error: `${paramName} must use https:// protocol`,
    }
  }

  // Block private IP ranges and localhost
  const hostname = parsedUrl.hostname.toLowerCase()

  // Block localhost
  if (hostname === 'localhost') {
    return {
      isValid: false,
      error: `${paramName} cannot point to localhost`,
    }
  }

  // Use ipaddr.js to check if hostname is an IP and if it's private/reserved
  if (ipaddr.isValid(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      return {
        isValid: false,
        error: `${paramName} cannot point to private IP addresses`,
      }
    }
  }

  // Block suspicious ports commonly used for internal services
  const port = parsedUrl.port
  const blockedPorts = [
    '22', // SSH
    '23', // Telnet
    '25', // SMTP
    '3306', // MySQL
    '5432', // PostgreSQL
    '6379', // Redis
    '27017', // MongoDB
    '9200', // Elasticsearch
  ]

  if (port && blockedPorts.includes(port)) {
    return {
      isValid: false,
      error: `${paramName} uses a blocked port`,
    }
  }

  return { isValid: true }
}

/**
 * Validates an image URL to prevent SSRF attacks
 * Alias for validateExternalUrl for backward compatibility
 */
export function validateImageUrl(
  url: string | null | undefined,
  paramName = 'imageUrl'
): ValidationResult {
  return validateExternalUrl(url, paramName)
}

/**
 * Validates a proxy URL to prevent SSRF attacks
 * Alias for validateExternalUrl for backward compatibility
 */
export function validateProxyUrl(
  url: string | null | undefined,
  paramName = 'proxyUrl'
): ValidationResult {
  return validateExternalUrl(url, paramName)
}

/**
 * Checks if an IP address is private or reserved (not routable on the public internet)
 * Uses ipaddr.js for robust handling of all IP formats including:
 * - Octal notation (0177.0.0.1)
 * - Hex notation (0x7f000001)
 * - IPv4-mapped IPv6 (::ffff:127.0.0.1)
 * - Various edge cases that regex patterns miss
 */
function isPrivateOrReservedIP(ip: string): boolean {
  try {
    if (!ipaddr.isValid(ip)) {
      return true
    }

    const addr = ipaddr.process(ip)
    const range = addr.range()

    return range !== 'unicast'
  } catch {
    return true
  }
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

  // Airtable IDs: prefix (3 chars) + 14 alphanumeric characters = 17 chars total
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
 * - ISO partitions: us-iso-east-1, us-isob-east-1
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

  // AWS region patterns:
  // - Standard: af|ap|ca|eu|me|sa|us|il followed by direction and number
  // - GovCloud: us-gov-east-1, us-gov-west-1
  // - China: cn-north-1, cn-northwest-1
  // - ISO: us-iso-east-1, us-iso-west-1, us-isob-east-1
  const awsRegionPattern =
    /^(af|ap|ca|cn|eu|il|me|sa|us|us-gov|us-iso|us-isob)-(central|north|northeast|northwest|south|southeast|southwest|east|west)-\d{1,2}$/

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
 * Validates a Google Calendar ID
 *
 * Google Calendar IDs can be:
 * - "primary" (literal string for the user's primary calendar)
 * - Email addresses (for user calendars)
 * - Alphanumeric strings with hyphens, underscores, and dots (for other calendars)
 *
 * This validator allows these legitimate formats while blocking path traversal and injection attempts.
 *
 * @param value - The calendar ID to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateGoogleCalendarId(calendarId, 'calendarId')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateGoogleCalendarId(
  value: string | null | undefined,
  paramName = 'calendarId'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (value === 'primary') {
    return { isValid: true, sanitized: value }
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
      logger.warn('Path traversal attempt in Google Calendar ID', {
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
    logger.warn('Control characters in Google Calendar ID', { paramName })
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

  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  if (emailPattern.test(value)) {
    return { isValid: true, sanitized: value }
  }

  const calendarIdPattern = /^[a-zA-Z0-9._@%#+-]+$/
  if (!calendarIdPattern.test(value)) {
    logger.warn('Invalid Google Calendar ID format', {
      paramName,
      value: value.substring(0, 100),
    })
    return {
      isValid: false,
      error: `${paramName} format is invalid. Must be "primary", an email address, or an alphanumeric ID`,
    }
  }

  if (value.length > 255) {
    logger.warn('Google Calendar ID exceeds maximum length', {
      paramName,
      length: value.length,
    })
    return {
      isValid: false,
      error: `${paramName} exceeds maximum length of 255 characters`,
    }
  }

  return { isValid: true, sanitized: value }
}
