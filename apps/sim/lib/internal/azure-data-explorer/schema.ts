import { isPrivateIpHost } from '@sim/security/ssrf'
import { z } from 'zod'

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

const entityNameSchema = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(1024, 'name must be at most 1024 characters')
  .regex(
    /^[\p{L}\p{N}_ .-]+$/u,
    'name may contain only letters, digits, underscores, spaces, dots, and dashes'
  )

const tenantIdSchema = z
  .string()
  .trim()
  .min(1, 'tenantId is required')
  .max(253, 'tenantId is too long')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/,
    'tenantId must be a GUID or a domain name (e.g., contoso.onmicrosoft.com)'
  )

export const azureDataExplorerInputSchema = z
  .object({
    clusterUri: z.string().min(1, 'clusterUri is required'),
    tenantId: tenantIdSchema,
    clientId: z.string().min(1, 'clientId is required'),
    clientSecret: z.string().min(1, 'clientSecret is required'),
    resource: z.string().optional(),
    endpoint: z.enum(['query', 'mgmt']),
    database: entityNameSchema.optional(),
    csl: z.string().min(1, 'csl is required').max(1_000_000, 'csl is too long'),
    properties: z.record(z.string(), z.unknown()).optional(),
    readOnly: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    const clusterCheck = checkAzureDataExplorerClusterUri(input.clusterUri)
    if (!clusterCheck.ok) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clusterUri'],
        message: clusterCheck.message,
      })
    }
    if (input.resource === undefined) return
    const resourceCheck = checkAzureDataExplorerClusterUri(input.resource, 'resource')
    if (!resourceCheck.ok) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resource'],
        message: resourceCheck.message,
      })
    }
  })

export type AzureDataExplorerInput = z.output<typeof azureDataExplorerInputSchema>
