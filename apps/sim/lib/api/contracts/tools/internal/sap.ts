import { z } from 'zod'
import { internalToolResponseSchema } from '@/lib/api/contracts/tools/internal/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

const sapHttpMethodSchema = z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'MERGE'])
const sapDeploymentTypeSchema = z.enum(['cloud_public', 'cloud_private', 'on_premise'])
const sapAuthTypeSchema = z.enum(['oauth_client_credentials', 'basic'])

const sapServiceNameSchema = z
  .string()
  .min(1, 'service is required')
  .regex(
    /^[A-Z][A-Z0-9_]*(;v=\d+)?$/,
    'service must be an uppercase OData service name optionally suffixed with ";v=NNNN" (e.g., API_BUSINESS_PARTNER, API_OUTBOUND_DELIVERY_SRV;v=0002)'
  )

const sapServicePathSchema = z
  .string()
  .min(1, 'path is required')
  .refine(
    (path) =>
      !path.split(/[/\\]/).some((segment) => segment === '..' || segment === '.') &&
      !path.includes('?') &&
      !path.includes('#') &&
      !/%(?:2[eEfF]|5[cC]|3[fF]|23)/.test(path),
    {
      message:
        'path must not contain ".." or "." segments, "?", "#", or percent-encoded path/query/fragment characters',
    }
  )

const sapSubdomainSchema = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i,
    'subdomain must contain only letters, digits, and hyphens (1-63 chars)'
  )

const FORBIDDEN_SAP_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
  '[::1]',
  '[::]',
  '[::ffff:127.0.0.1]',
  '[fd00:ec2::254]',
])

function isPrivateIPv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const octets = match.slice(1, 5).map(Number) as [number, number, number, number]
  if (octets.some((octet) => octet < 0 || octet > 255)) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 0) return true
  return false
}

function extractIPv4MappedHost(host: string): string | null {
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const lower = stripped.toLowerCase()
  for (const prefix of ['::ffff:', '::']) {
    if (lower.startsWith(prefix)) {
      const candidate = lower.slice(prefix.length)
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(candidate)) return candidate
    }
  }
  const hexMatch = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hexMatch) {
    const high = Number.parseInt(hexMatch[1] as string, 16)
    const low = Number.parseInt(hexMatch[2] as string, 16)
    if (high >= 0 && high <= 0xffff && low >= 0 && low <= 0xffff) {
      const a = (high >> 8) & 0xff
      const b = high & 0xff
      const c = (low >> 8) & 0xff
      const d = low & 0xff
      return `${a}.${b}.${c}.${d}`
    }
  }
  return null
}

function isPrivateOrLoopbackIPv6(host: string): boolean {
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const lower = stripped.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true
  if (lower.startsWith('fe80:')) return true
  return false
}

export function checkSapExternalUrlSafety(
  rawUrl: string,
  label: string
): { ok: true; url: URL } | { ok: false; message: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, message: `${label} must be a valid URL` }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, message: `${label} must use https://` }
  }
  const host = parsed.hostname.toLowerCase()
  if (FORBIDDEN_SAP_HOSTS.has(host) || FORBIDDEN_SAP_HOSTS.has(`[${host}]`)) {
    return { ok: false, message: `${label} host is not allowed` }
  }
  if (isPrivateIPv4(host)) {
    return { ok: false, message: `${label} host is not allowed (private/loopback range)` }
  }
  const mapped = extractIPv4MappedHost(host)
  if (mapped && isPrivateIPv4(mapped)) {
    return { ok: false, message: `${label} host is not allowed (IPv4-mapped private range)` }
  }
  if (isPrivateOrLoopbackIPv6(host)) {
    return { ok: false, message: `${label} host is not allowed (IPv6 private/loopback)` }
  }
  return { ok: true, url: parsed }
}

export function assertSafeSapExternalUrl(rawUrl: string, label: string): URL {
  const result = checkSapExternalUrlSafety(rawUrl, label)
  if (!result.ok) throw new Error(result.message)
  return result.url
}

export const sapS4HanaProxyBodySchema = z
  .object({
    deploymentType: sapDeploymentTypeSchema.default('cloud_public'),
    authType: sapAuthTypeSchema.default('oauth_client_credentials'),
    subdomain: sapSubdomainSchema.optional(),
    region: z
      .string()
      .regex(/^[a-z]{2,4}\d{1,3}$/i, 'region must be an SAP BTP region code (e.g., eu10, us30)')
      .optional(),
    baseUrl: z.string().optional(),
    tokenUrl: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    service: sapServiceNameSchema,
    path: sapServicePathSchema,
    method: sapHttpMethodSchema.default('GET'),
    query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    body: z.unknown().optional(),
    ifMatch: z.string().optional(),
  })
  .superRefine((req, ctx) => {
    if (req.deploymentType === 'cloud_public') {
      if (!req.subdomain) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['subdomain'],
          message: 'subdomain is required for cloud_public deployment',
        })
      }
      if (!req.region) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['region'],
          message: 'region is required for cloud_public deployment',
        })
      }
      if (req.authType !== 'oauth_client_credentials') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authType'],
          message: 'cloud_public deployment only supports oauth_client_credentials',
        })
      }
      if (!req.clientId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientId'],
          message: 'clientId is required',
        })
      }
      if (!req.clientSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientSecret'],
          message: 'clientSecret is required',
        })
      }
      return
    }

    if (!req.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'baseUrl is required for cloud_private and on_premise deployments',
      })
    } else {
      const baseUrlCheck = checkSapExternalUrlSafety(req.baseUrl, 'baseUrl')
      if (!baseUrlCheck.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['baseUrl'],
          message: baseUrlCheck.message,
        })
      }
    }

    if (req.authType === 'oauth_client_credentials') {
      if (!req.tokenUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tokenUrl'],
          message: 'tokenUrl is required for OAuth on cloud_private/on_premise',
        })
      } else {
        const tokenUrlCheck = checkSapExternalUrlSafety(req.tokenUrl, 'tokenUrl')
        if (!tokenUrlCheck.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tokenUrl'],
            message: tokenUrlCheck.message,
          })
        }
      }
      if (!req.clientId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientId'],
          message: 'clientId is required for OAuth',
        })
      }
      if (!req.clientSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientSecret'],
          message: 'clientSecret is required for OAuth',
        })
      }
      return
    }

    if (!req.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['username'],
        message: 'username is required for Basic auth',
      })
    }
    if (!req.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'password is required for Basic auth',
      })
    }
  })

export type SapS4HanaProxyRequest = z.infer<typeof sapS4HanaProxyBodySchema>

export const sapS4HanaProxyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sap_s4hana/proxy',
  body: sapS4HanaProxyBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})
