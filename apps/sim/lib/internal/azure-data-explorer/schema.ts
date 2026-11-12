import { isPrivateIpHost } from '@sim/security/ssrf'
import { z } from 'zod'
import { MICROSOFT_CLOUDS, type MicrosoftCloudId } from '@/lib/credentials/microsoft-clouds'

/**
 * Cluster host suffixes per Azure cloud, and the Microsoft app credential clouds whose tokens the
 * cluster accepts. The first of those clouds' Entra endpoint signs in an inline client secret.
 */
const KUSTO_CLOUDS: readonly {
  hostSuffix: string
  credentialClouds: readonly [MicrosoftCloudId, ...MicrosoftCloudId[]]
}[] = [
  { hostSuffix: 'kusto.windows.net', credentialClouds: ['global'] },
  { hostSuffix: 'kusto.fabric.microsoft.com', credentialClouds: ['global'] },
  { hostSuffix: 'kusto.usgovcloudapi.net', credentialClouds: ['usgov', 'usgov_dod'] },
  { hostSuffix: 'kusto.chinacloudapi.cn', credentialClouds: ['china'] },
]

const ALLOWED_CLUSTER_HOSTS = KUSTO_CLOUDS.map((cloud) => cloud.hostSuffix).join(', ')

function matchKustoCloud(host: string): (typeof KUSTO_CLOUDS)[number] | null {
  return (
    KUSTO_CLOUDS.find(
      (cloud) => host === cloud.hostSuffix || host.endsWith(`.${cloud.hostSuffix}`)
    ) ?? null
  )
}

/** The Microsoft app credential clouds an allowlisted cluster host accepts tokens from. */
export function kustoCredentialClouds(clusterHost: string): readonly MicrosoftCloudId[] {
  return matchKustoCloud(clusterHost.toLowerCase())?.credentialClouds ?? []
}

export function resolveEntraAuthority(clusterHost: string): string {
  const cloud = matchKustoCloud(clusterHost.toLowerCase())
  if (!cloud) {
    throw new Error(`No Microsoft Entra authority is configured for cluster host ${clusterHost}`)
  }
  return MICROSOFT_CLOUDS[cloud.credentialClouds[0]].loginOrigin
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

/** What every request carries, however it authenticates. */
const requestShape = {
  clusterUri: z.string().min(1, 'clusterUri is required'),
  resource: z.string().optional(),
  endpoint: z.enum(['query', 'mgmt']),
  database: entityNameSchema.optional(),
  csl: z.string().min(1, 'csl is required').max(1_000_000, 'csl is too long'),
  properties: z.record(z.string(), z.unknown()).optional(),
  readOnly: z.boolean().optional(),
}

function refineHosts(
  input: { clusterUri: string; resource?: string },
  context: z.RefinementCtx
): void {
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
    return
  }
  if (!clusterCheck.ok) return
  const clusterClouds = kustoCredentialClouds(clusterCheck.url.hostname)
  const sharesCloud = kustoCredentialClouds(resourceCheck.url.hostname).some((cloud) =>
    clusterClouds.includes(cloud)
  )
  if (!sharesCloud) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resource'],
      message: 'resource must be in the same Microsoft cloud as clusterUri',
    })
  }
}

/** A request that signs in with the inline client secret it carries. */
export const azureDataExplorerInputSchema = z
  .object({
    ...requestShape,
    tenantId: tenantIdSchema,
    clientId: z.string().min(1, 'clientId is required'),
    clientSecret: z.string().min(1, 'clientSecret is required'),
  })
  .superRefine(refineHosts)

export type AzureDataExplorerInput = z.output<typeof azureDataExplorerInputSchema>

/**
 * A request that runs as the executor-authorized Microsoft app credential. Any inline sign-in
 * fields are dropped unread: the credential, not the caller, decides who the request runs as.
 */
export const azureDataExplorerRequestSchema = z.object(requestShape).superRefine(refineHosts)

export type AzureDataExplorerRequest = z.output<typeof azureDataExplorerRequestSchema>
