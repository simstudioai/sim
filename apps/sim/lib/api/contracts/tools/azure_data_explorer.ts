import { isPrivateIpHost } from '@sim/security/ssrf'
import { z } from 'zod'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Kusto cluster host suffixes Sim will talk to. A cluster URI is user-supplied,
 * so the proxy is pinned to the documented Azure Data Explorer and Fabric
 * Eventhouse service domains rather than trusting any HTTPS host. Apex hosts
 * are allowed too, because the documented token audiences
 * (`https://api.kusto.windows.net`, `https://kusto.fabric.microsoft.com`) sit
 * at the apex.
 */
const ALLOWED_CLUSTER_HOST_SUFFIXES = [
  'kusto.windows.net',
  'kustomfa.windows.net',
  'kusto.chinacloudapi.cn',
  'kusto.usgovcloudapi.net',
  'kusto.fabric.microsoft.com',
] as const

function isAllowedKustoHost(host: string): boolean {
  return ALLOWED_CLUSTER_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  )
}

export function checkAzureDataExplorerClusterUri(
  rawUrl: string,
  label = 'clusterUri'
): { ok: true; url: URL } | { ok: false; message: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return {
      ok: false,
      message: `${label} must be a full URL (e.g., https://mycluster.eastus.kusto.windows.net)`,
    }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, message: `${label} must use https://` }
  }
  const host = parsed.hostname.toLowerCase()
  if (isPrivateIpHost(host)) {
    return { ok: false, message: `${label} host is not allowed (private/loopback range)` }
  }
  if (!isAllowedKustoHost(host)) {
    return {
      ok: false,
      message: `${label} host must be an Azure Data Explorer or Fabric Eventhouse endpoint (${ALLOWED_CLUSTER_HOST_SUFFIXES.join(', ')})`,
    }
  }
  return { ok: true, url: parsed }
}

export function assertSafeAzureDataExplorerClusterUri(rawUrl: string, label?: string): URL {
  const result = checkAzureDataExplorerClusterUri(rawUrl, label)
  if (!result.ok) throw new Error(result.message)
  return result.url
}

/**
 * The exact character set Kusto documents for an identifier: letters, digits,
 * underscores, spaces, dots, and dashes, 1-1024 characters. An allowlist rather
 * than a denylist, so nothing that could terminate `["..."]` name quoting — or
 * that Kusto would reject anyway — reaches a command string.
 */
const entityNameSchema = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(1024, 'name must be at most 1024 characters')
  .regex(
    /^[\p{L}\p{N}_ .-]+$/u,
    'name may contain only letters, digits, underscores, spaces, dots, and dashes'
  )

/** A Microsoft Entra tenant is addressed by GUID or by verified domain name. */
const tenantIdSchema = z
  .string()
  .trim()
  .min(1, 'tenantId is required')
  .max(253, 'tenantId is too long')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/,
    'tenantId must be a GUID or a domain name (e.g., contoso.onmicrosoft.com)'
  )

export const azureDataExplorerEndpointSchema = z.enum(['query', 'mgmt'])

export const azureDataExplorerProxyBodySchema = z
  .object({
    clusterUri: z.string().min(1, 'clusterUri is required'),
    tenantId: tenantIdSchema,
    clientId: z.string().min(1, 'clientId is required'),
    clientSecret: z.string().min(1, 'clientSecret is required'),
    /**
     * Microsoft Entra token audience. Defaults to the cluster's own origin, which
     * is the form the Kusto REST reference uses for client-credential tokens.
     */
    resource: z.string().optional(),
    endpoint: azureDataExplorerEndpointSchema,
    database: entityNameSchema.optional(),
    csl: z.string().min(1, 'csl is required').max(1_000_000, 'csl is too long'),
    properties: z.record(z.string(), z.unknown()).optional(),
    /** Sends `x-ms-readonly`, which makes the cluster reject data-changing requests. */
    readOnly: z.boolean().optional(),
  })
  .superRefine((req, ctx) => {
    const clusterCheck = checkAzureDataExplorerClusterUri(req.clusterUri)
    if (!clusterCheck.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clusterUri'],
        message: clusterCheck.message,
      })
    }
    if (req.resource === undefined) return
    const resourceCheck = checkAzureDataExplorerClusterUri(req.resource, 'resource')
    if (!resourceCheck.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resource'],
        message: resourceCheck.message,
      })
    }
  })

export type AzureDataExplorerProxyRequest = z.infer<typeof azureDataExplorerProxyBodySchema>

export const azureDataExplorerProxyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/azure_data_explorer/proxy',
  body: azureDataExplorerProxyBodySchema,
  response: {
    mode: 'json',
    schema: genericToolResponseSchema,
  },
})
