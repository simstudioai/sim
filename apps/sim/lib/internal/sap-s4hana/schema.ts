import { isPrivateIpHost } from '@sim/security/ssrf'
import { z } from 'zod'

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
  if (isPrivateIpHost(host)) {
    return { ok: false, message: `${label} host is not allowed (private/loopback range)` }
  }
  return { ok: true, url: parsed }
}

export function assertSafeSapExternalUrl(rawUrl: string, label: string): URL {
  const result = checkSapExternalUrlSafety(rawUrl, label)
  if (!result.ok) throw new Error(result.message)
  return result.url
}

export const sapS4HanaOperationInputSchema = z
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
  .superRefine((input, context) => {
    if (input.deploymentType === 'cloud_public') {
      if (!input.subdomain) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['subdomain'],
          message: 'subdomain is required for cloud_public deployment',
        })
      }
      if (!input.region) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['region'],
          message: 'region is required for cloud_public deployment',
        })
      }
      if (input.authType !== 'oauth_client_credentials') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authType'],
          message: 'cloud_public deployment only supports oauth_client_credentials',
        })
      }
      if (!input.clientId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientId'],
          message: 'clientId is required',
        })
      }
      if (!input.clientSecret) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientSecret'],
          message: 'clientSecret is required',
        })
      }
      return
    }

    if (!input.baseUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'baseUrl is required for cloud_private and on_premise deployments',
      })
    } else {
      const baseUrlCheck = checkSapExternalUrlSafety(input.baseUrl, 'baseUrl')
      if (!baseUrlCheck.ok) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['baseUrl'],
          message: baseUrlCheck.message,
        })
      }
    }

    if (input.authType === 'oauth_client_credentials') {
      if (!input.tokenUrl) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tokenUrl'],
          message: 'tokenUrl is required for OAuth on cloud_private/on_premise',
        })
      } else {
        const tokenUrlCheck = checkSapExternalUrlSafety(input.tokenUrl, 'tokenUrl')
        if (!tokenUrlCheck.ok) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tokenUrl'],
            message: tokenUrlCheck.message,
          })
        }
      }
      if (!input.clientId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientId'],
          message: 'clientId is required for OAuth',
        })
      }
      if (!input.clientSecret) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientSecret'],
          message: 'clientSecret is required for OAuth',
        })
      }
      return
    }

    if (!input.username) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['username'],
        message: 'username is required for Basic auth',
      })
    }
    if (!input.password) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'password is required for Basic auth',
      })
    }
  })

export type SapS4HanaOperationInput = z.output<typeof sapS4HanaOperationInputSchema>
