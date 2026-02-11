import dns from 'dns/promises'
import http from 'http'
import https from 'https'
import type { LookupFunction } from 'net'
import { createLogger } from '@sim/logger'
import * as ipaddr from 'ipaddr.js'
import { type ValidationResult, validateExternalUrl } from '@/lib/core/security/input-validation'

const logger = createLogger('InputValidation')

/**
 * Result type for async URL validation with resolved IP
 */
export interface AsyncValidationResult extends ValidationResult {
  resolvedIP?: string
  originalHostname?: string
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
 * Validates a URL and resolves its DNS to prevent SSRF via DNS rebinding
 *
 * This function:
 * 1. Performs basic URL validation (protocol, format)
 * 2. Resolves the hostname to an IP address
 * 3. Validates the resolved IP is not private/reserved
 * 4. Returns the resolved IP for use in the actual request
 *
 * @param url - The URL to validate
 * @param paramName - Name of the parameter for error messages
 * @returns AsyncValidationResult with resolved IP for DNS pinning
 */
export async function validateUrlWithDNS(
  url: string | null | undefined,
  paramName = 'url'
): Promise<AsyncValidationResult> {
  const basicValidation = validateExternalUrl(url, paramName)
  if (!basicValidation.isValid) {
    return basicValidation
  }

  const parsedUrl = new URL(url!)
  const hostname = parsedUrl.hostname

  try {
    const { address } = await dns.lookup(hostname)

    if (isPrivateOrReservedIP(address)) {
      logger.warn('URL resolves to blocked IP address', {
        paramName,
        hostname,
        resolvedIP: address,
      })
      return {
        isValid: false,
        error: `${paramName} resolves to a blocked IP address`,
      }
    }

    return {
      isValid: true,
      resolvedIP: address,
      originalHostname: hostname,
    }
  } catch (error) {
    logger.warn('DNS lookup failed for URL', {
      paramName,
      hostname,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      isValid: false,
      error: `${paramName} hostname could not be resolved`,
    }
  }
}

export interface SecureFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer | Uint8Array
  timeout?: number
  maxRedirects?: number
  maxResponseBytes?: number
}

export class SecureFetchHeaders {
  private headers: Map<string, string>

  constructor(headers: Record<string, string>) {
    this.headers = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  }

  get(name: string): string | null {
    return this.headers.get(name.toLowerCase()) ?? null
  }

  toRecord(): Record<string, string> {
    const record: Record<string, string> = {}
    for (const [key, value] of this.headers) {
      record[key] = value
    }
    return record
  }

  [Symbol.iterator]() {
    return this.headers.entries()
  }
}

export interface SecureFetchResponse {
  ok: boolean
  status: number
  statusText: string
  headers: SecureFetchHeaders
  text: () => Promise<string>
  json: () => Promise<unknown>
  arrayBuffer: () => Promise<ArrayBuffer>
}

const DEFAULT_MAX_REDIRECTS = 5

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304
}

function resolveRedirectUrl(baseUrl: string, location: string): string {
  try {
    return new URL(location, baseUrl).toString()
  } catch {
    throw new Error(`Invalid redirect location: ${location}`)
  }
}

/**
 * Performs a fetch with IP pinning to prevent DNS rebinding attacks.
 * Uses the pre-resolved IP address while preserving the original hostname for TLS SNI.
 * Follows redirects securely by validating each redirect target.
 */
export async function secureFetchWithPinnedIP(
  url: string,
  resolvedIP: string,
  options: SecureFetchOptions = {},
  redirectCount = 0
): Promise<SecureFetchResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxResponseBytes = options.maxResponseBytes

  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const defaultPort = isHttps ? 443 : 80
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : defaultPort

    const isIPv6 = resolvedIP.includes(':')
    const family = isIPv6 ? 6 : 4

    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: resolvedIP, family }])
      } else {
        callback(null, resolvedIP, family)
      }
    }

    const agentOptions: http.AgentOptions = { lookup }

    const agent = isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions)

    // Remove accept-encoding since Node.js http/https doesn't auto-decompress
    // Headers are lowercase due to Web Headers API normalization in executeToolRequest
    const { 'accept-encoding': _, ...sanitizedHeaders } = options.headers ?? {}

    const requestOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: sanitizedHeaders,
      agent,
      timeout: options.timeout || 300000, // Default 5 minutes
    }

    const protocol = isHttps ? https : http
    const req = protocol.request(requestOptions, (res) => {
      const statusCode = res.statusCode || 0
      const location = res.headers.location

      if (isRedirectStatus(statusCode) && location && redirectCount < maxRedirects) {
        res.resume()
        const redirectUrl = resolveRedirectUrl(url, location)

        validateUrlWithDNS(redirectUrl, 'redirectUrl')
          .then((validation) => {
            if (!validation.isValid) {
              reject(new Error(`Redirect blocked: ${validation.error}`))
              return
            }
            return secureFetchWithPinnedIP(
              redirectUrl,
              validation.resolvedIP!,
              options,
              redirectCount + 1
            )
          })
          .then((response) => {
            if (response) resolve(response)
          })
          .catch(reject)
        return
      }

      if (isRedirectStatus(statusCode) && location && redirectCount >= maxRedirects) {
        res.resume()
        reject(new Error(`Too many redirects (max: ${maxRedirects})`))
        return
      }

      const chunks: Buffer[] = []
      let totalBytes = 0
      let responseTerminated = false

      res.on('data', (chunk: Buffer) => {
        if (responseTerminated) return

        totalBytes += chunk.length
        if (
          typeof maxResponseBytes === 'number' &&
          maxResponseBytes > 0 &&
          totalBytes > maxResponseBytes
        ) {
          responseTerminated = true
          res.destroy(new Error(`Response exceeded maximum size of ${maxResponseBytes} bytes`))
          return
        }

        chunks.push(chunk)
      })

      res.on('error', (error) => {
        reject(error)
      })

      res.on('end', () => {
        if (responseTerminated) return
        const bodyBuffer = Buffer.concat(chunks)
        const body = bodyBuffer.toString('utf-8')
        const headersRecord: Record<string, string> = {}
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            headersRecord[key.toLowerCase()] = value
          } else if (Array.isArray(value)) {
            headersRecord[key.toLowerCase()] = value.join(', ')
          }
        }

        resolve({
          ok: statusCode >= 200 && statusCode < 300,
          status: statusCode,
          statusText: res.statusMessage || '',
          headers: new SecureFetchHeaders(headersRecord),
          text: async () => body,
          json: async () => JSON.parse(body),
          arrayBuffer: async () =>
            bodyBuffer.buffer.slice(
              bodyBuffer.byteOffset,
              bodyBuffer.byteOffset + bodyBuffer.byteLength
            ),
        })
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Request timed out after ${requestOptions.timeout}ms`))
    })

    if (options.body) {
      req.write(options.body)
    }

    req.end()
  })
}

/**
 * Validates a URL and performs a secure fetch with DNS pinning in one call.
 * Combines validateUrlWithDNS and secureFetchWithPinnedIP for convenience.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options (method, headers, body, etc.)
 * @param paramName - Name of the parameter for error messages (default: 'url')
 * @returns SecureFetchResponse
 * @throws Error if URL validation fails
 */
export async function secureFetchWithValidation(
  url: string,
  options: SecureFetchOptions = {},
  paramName = 'url'
): Promise<SecureFetchResponse> {
  const validation = await validateUrlWithDNS(url, paramName)
  if (!validation.isValid) {
    throw new Error(validation.error)
  }
  return secureFetchWithPinnedIP(url, validation.resolvedIP!, options)
}
