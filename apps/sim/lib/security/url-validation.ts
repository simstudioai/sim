import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('URLValidation')

/**
 * Validates URLs for proxy requests to prevent SSRF attacks
 * while preserving legitimate external API functionality
 */

const BLOCKED_IP_RANGES = [
  // Private IPv4 ranges (RFC 1918)
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,

  // Loopback addresses
  /^127\./,
  /^localhost$/i,

  // Link-local addresses (RFC 3927)
  /^169\.254\./,

  // Cloud metadata endpoints
  /^169\.254\.169\.254$/,

  // Broadcast and other reserved ranges
  /^0\./,
  /^224\./,
  /^240\./,
  /^255\./,

  // IPv6 loopback and link-local
  /^::1$/,
  /^fe80:/i,
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./i,
  /^::ffff:192\.168\./i,
]

const ALLOWED_PROTOCOLS = ['http:', 'https:']

const BLOCKED_PROTOCOLS = [
  'file:',
  'ftp:',
  'ftps:',
  'gopher:',
  'ldap:',
  'ldaps:',
  'dict:',
  'sftp:',
  'ssh:',
  'jar:',
  'netdoc:',
  'data:',
]

/**
 * Validates a URL to prevent SSRF attacks
 * @param url - The URL to validate
 * @returns Object with isValid boolean and error message if invalid
 */
export function validateProxyUrl(url: string): { isValid: boolean; error?: string } {
  try {
    // Parse the URL
    const parsedUrl = new URL(url)

    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      logger.warn('Blocked request with disallowed protocol', {
        url: url.substring(0, 100),
        protocol: parsedUrl.protocol,
      })
      return {
        isValid: false,
        error: `Protocol '${parsedUrl.protocol}' is not allowed. Only HTTP and HTTPS are permitted.`,
      }
    }

    // Check for explicitly blocked protocols
    if (BLOCKED_PROTOCOLS.includes(parsedUrl.protocol)) {
      logger.warn('Blocked request with dangerous protocol', {
        url: url.substring(0, 100),
        protocol: parsedUrl.protocol,
      })
      return {
        isValid: false,
        error: `Protocol '${parsedUrl.protocol}' is blocked for security reasons.`,
      }
    }

    // Get hostname for validation
    const hostname = parsedUrl.hostname.toLowerCase()

    // Check if hostname matches blocked patterns
    for (const pattern of BLOCKED_IP_RANGES) {
      if (pattern.test(hostname)) {
        logger.warn('Blocked request to private/reserved IP range', {
          hostname,
          url: url.substring(0, 100),
        })
        return {
          isValid: false,
          error: 'Access to private networks, localhost, and reserved IP ranges is not allowed.',
        }
      }
    }

    // Additional hostname validation
    if (hostname === '' || hostname.includes('..')) {
      return {
        isValid: false,
        error: 'Invalid hostname format.',
      }
    }

    // Check for URL encoding attempts to bypass validation
    const decodedUrl = decodeURIComponent(url)
    if (decodedUrl !== url) {
      // Recursively validate the decoded URL
      return validateProxyUrl(decodedUrl)
    }

    logger.debug('URL validation passed', {
      hostname,
      protocol: parsedUrl.protocol,
      url: url.substring(0, 100),
    })

    return { isValid: true }
  } catch (error) {
    logger.warn('URL parsing failed during validation', {
      url: url.substring(0, 100),
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      isValid: false,
      error: 'Invalid URL format.',
    }
  }
}

/**
 * Enhanced validation specifically for image URLs with additional checks
 * @param url - The image URL to validate
 * @returns Object with isValid boolean and error message if invalid
 */
export function validateImageUrl(url: string): { isValid: boolean; error?: string } {
  // First run standard proxy URL validation
  const baseValidation = validateProxyUrl(url)
  if (!baseValidation.isValid) {
    return baseValidation
  }

  try {
    const parsedUrl = new URL(url)

    // Additional checks for image URLs
    // Ensure it's not trying to access internal services via common ports
    if (parsedUrl.port) {
      const port = Number.parseInt(parsedUrl.port, 10)
      const dangerousPorts = [
        22,
        23,
        25,
        53,
        80,
        110,
        143,
        443,
        993,
        995, // Common service ports
        3000,
        3001,
        5000,
        8000,
        8080,
        8443,
        9000, // Common dev ports
      ]

      // Only block if hostname suggests internal access
      if (
        BLOCKED_IP_RANGES.some((pattern) => pattern.test(parsedUrl.hostname)) &&
        dangerousPorts.includes(port)
      ) {
        return {
          isValid: false,
          error: 'Access to internal services on common ports is not allowed.',
        }
      }
    }

    return { isValid: true }
  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid image URL format.',
    }
  }
}

/**
 * Helper function to check if a hostname resolves to a private IP
 * Note: This is a basic check and doesn't perform actual DNS resolution
 * which could be added for enhanced security if needed
 */
export function isPrivateHostname(hostname: string): boolean {
  return BLOCKED_IP_RANGES.some((pattern) => pattern.test(hostname))
}
