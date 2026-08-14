import { isPrivateIpHost } from '@sim/security/ssrf'
import { z } from 'zod'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Kusto service domains Sim will talk to, each paired with the Microsoft Entra
 * authority that issues tokens for it.
 *
 * A cluster URI is user-supplied, so the proxy is pinned to the documented Azure
 * Data Explorer and Fabric Eventhouse domains rather than trusting any HTTPS
 * host. Host and authority are declared together on purpose: a sovereign cloud
 * authenticates against its own isolated Entra instance, so accepting a cluster
 * host without its authority would pass validation and then fail to get a token.
 *
 * Apex hosts match as well as subdomains, because the documented token
 * audiences (`https://api.kusto.windows.net`,
 * `https://kusto.fabric.microsoft.com`) sit at the apex.
 *
 * Every entry is a domain Microsoft documents: the Kusto connection-string
 * reference for `kusto.windows.net`, the national-cloud endpoint tables for the
 * two sovereign domains, and the Fabric KQL-database REST reference for
 * `kusto.fabric.microsoft.com` (both its `queryServiceUri` and
 * `ingestionServiceUri` sit under it). Do not add a host without one.
 */
const KUSTO_CLOUDS = [
  { hostSuffix: 'kusto.windows.net', authority: 'https://login.microsoftonline.com' },
  { hostSuffix: 'kusto.fabric.microsoft.com', authority: 'https://login.microsoftonline.com' },
  { hostSuffix: 'kusto.usgovcloudapi.net', authority: 'https://login.microsoftonline.us' },
  { hostSuffix: 'kusto.chinacloudapi.cn', authority: 'https://login.partner.microsoftonline.cn' },
] as const

const ALLOWED_CLUSTER_HOSTS = KUSTO_CLOUDS.map((cloud) => cloud.hostSuffix).join(', ')

function matchKustoCloud(host: string): (typeof KUSTO_CLOUDS)[number] | null {
  return (
    KUSTO_CLOUDS.find(
      (cloud) => host === cloud.hostSuffix || host.endsWith(`.${cloud.hostSuffix}`)
    ) ?? null
  )
}

/**
 * Resolves the Entra authority that issues tokens for a cluster host. Callers
 * pass a host already accepted by {@link checkAzureDataExplorerClusterUri}, so
 * an unmatched host here means the two fell out of sync and is a bug, not input.
 */
export function resolveEntraAuthority(clusterHost: string): string {
  const cloud = matchKustoCloud(clusterHost.toLowerCase())
  if (!cloud) {
    throw new Error(`No Microsoft Entra authority is configured for cluster host ${clusterHost}`)
  }
  return cloud.authority
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
  if (!matchKustoCloud(host)) {
    return {
      ok: false,
      message: `${label} host must be an Azure Data Explorer or Fabric Eventhouse endpoint (${ALLOWED_CLUSTER_HOSTS})`,
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
