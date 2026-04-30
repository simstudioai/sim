import { z } from 'zod'
import { unknownRecordSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const internalToolResponseSchema = z
  .object({
    success: z.boolean().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    details: z.array(z.unknown()).optional(),
  })
  .passthrough()

const a2aBaseBodySchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  apiKey: z.string().optional(),
})

const a2aTaskBodySchema = a2aBaseBodySchema.extend({
  taskId: z.string().min(1, 'Task ID is required'),
})

export const a2aGetAgentCardBodySchema = a2aBaseBodySchema

export const a2aSendMessageFileSchema = z.object({
  type: z.enum(['file', 'url']),
  data: z.string(),
  name: z.string(),
  mime: z.string().optional(),
})

export const a2aSendMessageBodySchema = a2aBaseBodySchema.extend({
  message: z.string().min(1, 'Message is required'),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  data: z.string().optional(),
  files: z.array(a2aSendMessageFileSchema).optional(),
})

export const a2aGetTaskBodySchema = a2aTaskBodySchema.extend({
  historyLength: z.number().optional(),
})

export const a2aCancelTaskBodySchema = a2aTaskBodySchema

export const a2aResubscribeBodySchema = a2aTaskBodySchema

export const a2aSetPushNotificationBodySchema = a2aTaskBodySchema.extend({
  webhookUrl: z.string().min(1, 'Webhook URL is required'),
  token: z.string().optional(),
})

export const a2aGetPushNotificationBodySchema = a2aTaskBodySchema

export const a2aDeletePushNotificationBodySchema = a2aTaskBodySchema.extend({
  pushNotificationConfigId: z.string().optional(),
})

export const stagehandProviderSchema = z.enum(['openai', 'anthropic'])

export const stagehandAgentBodySchema = z.object({
  task: z.string().min(1),
  startUrl: z.string().url(),
  outputSchema: z.unknown(),
  variables: z.unknown(),
  provider: stagehandProviderSchema.optional().default('openai'),
  apiKey: z.string(),
  mode: z.enum(['dom', 'hybrid', 'cua']).optional().default('dom'),
  maxSteps: z.number().int().min(1).max(200).optional().default(20),
})

export const stagehandExtractBodySchema = z.object({
  instruction: z.string(),
  schema: unknownRecordSchema,
  provider: stagehandProviderSchema.optional().default('openai'),
  apiKey: z.string(),
  url: z.string().url(),
})

export const cursorDownloadArtifactBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  agentId: z.string().min(1, 'Agent ID is required'),
  path: z.string().min(1, 'Artifact path is required'),
})

export const docusignToolBodySchema = z
  .object({
    accessToken: z.string().min(1, 'Access token is required'),
    operation: z.string().min(1, 'Operation is required'),
  })
  .passthrough()

const quiverCommonBodySchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional().nullable(),
  top_p: z.number().min(0).max(1).optional().nullable(),
  max_output_tokens: z.number().int().min(1).max(131072).optional().nullable(),
  presence_penalty: z.number().min(-2).max(2).optional().nullable(),
})

export const quiverTextToSvgBodySchema = quiverCommonBodySchema.extend({
  prompt: z.string().min(1),
  instructions: z.string().optional().nullable(),
  references: z
    .union([z.array(FileInputSchema), FileInputSchema, z.string()])
    .optional()
    .nullable(),
  n: z.number().int().min(1).max(16).optional().nullable(),
})

export const quiverImageToSvgBodySchema = quiverCommonBodySchema.extend({
  image: z.union([FileInputSchema, z.string()]),
  auto_crop: z.boolean().optional().nullable(),
  target_size: z.number().int().min(128).max(4096).optional().nullable(),
})

export const onePasswordCredentialsBodySchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
})

export const onePasswordListVaultsBodySchema = onePasswordCredentialsBodySchema.extend({
  filter: z.string().nullish(),
})

export const onePasswordGetVaultBodySchema = onePasswordCredentialsBodySchema.extend({
  vaultId: z.string().min(1, 'Vault ID is required'),
})

export const onePasswordListItemsBodySchema = onePasswordGetVaultBodySchema.extend({
  filter: z.string().nullish(),
})

export const onePasswordGetItemBodySchema = onePasswordGetVaultBodySchema.extend({
  itemId: z.string().min(1, 'Item ID is required'),
})

export const onePasswordCreateItemBodySchema = onePasswordGetVaultBodySchema.extend({
  category: z.string().min(1, 'Category is required'),
  title: z.string().nullish(),
  tags: z.string().nullish(),
  fields: z.string().nullish(),
})

export const onePasswordUpdateItemBodySchema = onePasswordGetItemBodySchema.extend({
  operations: z.string().min(1, 'Patch operations are required'),
})

export const onePasswordReplaceItemBodySchema = onePasswordGetItemBodySchema.extend({
  item: z.string().min(1, 'Item JSON is required'),
})

export const onePasswordDeleteItemBodySchema = onePasswordGetItemBodySchema

export const onePasswordResolveSecretBodySchema = onePasswordCredentialsBodySchema.extend({
  secretReference: z.string().min(1, 'Secret reference is required'),
})

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

export const a2aGetAgentCardContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/get-agent-card',
  body: a2aGetAgentCardBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aSendMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/send-message',
  body: a2aSendMessageBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aGetTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/get-task',
  body: a2aGetTaskBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aCancelTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/cancel-task',
  body: a2aCancelTaskBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aResubscribeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/resubscribe',
  body: a2aResubscribeBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aSetPushNotificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/set-push-notification',
  body: a2aSetPushNotificationBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aGetPushNotificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/get-push-notification',
  body: a2aGetPushNotificationBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aDeletePushNotificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/delete-push-notification',
  body: a2aDeletePushNotificationBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const stagehandAgentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/stagehand/agent',
  body: stagehandAgentBodySchema,
  response: {
    mode: 'json',
    schema: unknownRecordSchema,
  },
})

export const stagehandExtractContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/stagehand/extract',
  body: stagehandExtractBodySchema,
  response: {
    mode: 'json',
    schema: unknownRecordSchema,
  },
})

export const cursorDownloadArtifactContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cursor/download-artifact',
  body: cursorDownloadArtifactBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const docusignToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/docusign',
  body: docusignToolBodySchema,
  response: {
    mode: 'json',
    // untyped-response: forwards DocuSign API response unchanged; shape varies by operation (envelope, listing, base64 download, etc.)
    schema: z.unknown(),
  },
})

export const quiverTextToSvgContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quiver/text-to-svg',
  body: quiverTextToSvgBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const quiverImageToSvgContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/quiver/image-to-svg',
  body: quiverImageToSvgBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const onePasswordListVaultsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/list-vaults',
  body: onePasswordListVaultsBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns normalized vault shapes while connect-server mode forwards 1Password Connect /v1/vaults response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordGetVaultContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/get-vault',
  body: onePasswordGetVaultBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized vault shape while connect-server mode forwards 1Password Connect /v1/vaults/{id} response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordListItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/list-items',
  body: onePasswordListItemsBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns normalized item-overview shapes while connect-server mode forwards 1Password Connect /v1/vaults/{id}/items response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordGetItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/get-item',
  body: onePasswordGetItemBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized item shape while connect-server mode forwards 1Password Connect /v1/vaults/{vaultId}/items/{itemId} response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordCreateItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/create-item',
  body: onePasswordCreateItemBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized item shape while connect-server mode forwards 1Password Connect create-item response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordUpdateItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/update-item',
  body: onePasswordUpdateItemBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized item shape while connect-server mode forwards 1Password Connect PATCH item response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordReplaceItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/replace-item',
  body: onePasswordReplaceItemBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized item shape while connect-server mode forwards 1Password Connect PUT item response unchanged
    schema: z.unknown(),
  },
})

const onePasswordDeleteItemResponseSchema = z.object({
  success: z.literal(true),
})

export const onePasswordDeleteItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/delete-item',
  body: onePasswordDeleteItemBodySchema,
  response: {
    mode: 'json',
    schema: onePasswordDeleteItemResponseSchema,
  },
})

const onePasswordResolveSecretResponseSchema = z.object({
  value: z.string(),
  reference: z.string(),
})

export const onePasswordResolveSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/resolve-secret',
  body: onePasswordResolveSecretBodySchema,
  response: {
    mode: 'json',
    schema: onePasswordResolveSecretResponseSchema,
  },
})

export const sapS4HanaProxyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sap_s4hana/proxy',
  body: sapS4HanaProxyBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})
