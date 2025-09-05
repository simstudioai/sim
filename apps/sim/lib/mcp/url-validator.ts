/**
 * URL Validator for MCP Servers
 *
 * Provides SSRF (Server-Side Request Forgery) protection by validating
 * MCP server URLs against common attack patterns and dangerous destinations.
 */

import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('McpUrlValidator')

// Common private IP ranges (IPv4)
const PRIVATE_IP_RANGES = [
  /^127\./, // Loopback (127.0.0.0/8)
  /^10\./, // Private class A (10.0.0.0/8)
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // Private class B (172.16.0.0/12)
  /^192\.168\./, // Private class C (192.168.0.0/16)
  /^169\.254\./, // Link-local (169.254.0.0/16)
  /^0\./, // Invalid range
]

// IPv6 private ranges
const PRIVATE_IPV6_RANGES = [
  /^::1$/, // Localhost
  /^::ffff:/, // IPv4-mapped IPv6
  /^fc00:/, // Unique local (fc00::/7)
  /^fd00:/, // Unique local (fd00::/8)
  /^fe80:/, // Link-local (fe80::/10)
]

// Dangerous hostnames
const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal', // Google Cloud metadata
  '169.254.169.254', // AWS/Azure metadata service
  'metadata.azure.com', // Azure metadata
  'consul', // Service discovery
  'etcd', // etcd service
]

// Blocked ports (common internal services)
const BLOCKED_PORTS = [
  22, // SSH
  23, // Telnet
  25, // SMTP
  53, // DNS
  110, // POP3
  143, // IMAP
  993, // IMAPS
  995, // POP3S
  1433, // SQL Server
  1521, // Oracle
  3306, // MySQL
  5432, // PostgreSQL
  6379, // Redis
  9200, // Elasticsearch
  27017, // MongoDB
]

export interface UrlValidationResult {
  isValid: boolean
  error?: string
  normalizedUrl?: string
}

/**
 * Validate an MCP server URL for security and format
 */
export function validateMcpServerUrl(urlString: string): UrlValidationResult {
  if (!urlString || typeof urlString !== 'string') {
    return {
      isValid: false,
      error: 'URL is required and must be a string',
    }
  }

  let url: URL
  try {
    url = new URL(urlString.trim())
  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid URL format',
    }
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return {
      isValid: false,
      error: 'Only HTTP and HTTPS protocols are allowed',
    }
  }

  const hostname = url.hostname.toLowerCase()

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return {
      isValid: false,
      error: `Hostname '${hostname}' is not allowed for security reasons`,
    }
  }

  if (isIPv4(hostname)) {
    for (const range of PRIVATE_IP_RANGES) {
      if (range.test(hostname)) {
        return {
          isValid: false,
          error: `Private IP addresses are not allowed: ${hostname}`,
        }
      }
    }
  }

  if (isIPv6(hostname)) {
    for (const range of PRIVATE_IPV6_RANGES) {
      if (range.test(hostname)) {
        return {
          isValid: false,
          error: `Private IPv6 addresses are not allowed: ${hostname}`,
        }
      }
    }
  }

  if (url.port) {
    const port = Number.parseInt(url.port, 10)
    if (BLOCKED_PORTS.includes(port)) {
      return {
        isValid: false,
        error: `Port ${port} is not allowed for security reasons`,
      }
    }
  }

  if (urlString.length > 2048) {
    return {
      isValid: false,
      error: 'URL is too long (maximum 2048 characters)',
    }
  }

  if (url.protocol === 'https:' && url.port === '80') {
    return {
      isValid: false,
      error: 'HTTPS URLs should not use port 80',
    }
  }

  if (url.protocol === 'http:' && url.port === '443') {
    return {
      isValid: false,
      error: 'HTTP URLs should not use port 443',
    }
  }

  logger.debug(`Validated MCP server URL: ${hostname}`)

  return {
    isValid: true,
    normalizedUrl: url.toString(),
  }
}

/**
 * Check if a string is a valid IPv4 address
 */
function isIPv4(hostname: string): boolean {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
  return ipv4Regex.test(hostname)
}

/**
 * Check if a string is a valid IPv6 address
 */
function isIPv6(hostname: string): boolean {
  const cleanHostname = hostname.replace(/^\[|\]$/g, '')

  const ipv6Regex =
    /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$|^(?:[0-9a-fA-F]{1,4}:)*::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*$/

  return ipv6Regex.test(cleanHostname)
}

/**
 * Validate multiple URLs (for batch operations)
 */
export function validateMcpServerUrls(urls: string[]): {
  validUrls: string[]
  errors: Array<{ url: string; error: string }>
} {
  const validUrls: string[] = []
  const errors: Array<{ url: string; error: string }> = []

  for (const url of urls) {
    const result = validateMcpServerUrl(url)
    if (result.isValid && result.normalizedUrl) {
      validUrls.push(result.normalizedUrl)
    } else {
      errors.push({ url, error: result.error || 'Unknown validation error' })
    }
  }

  return { validUrls, errors }
}
