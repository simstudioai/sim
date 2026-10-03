/**
 * Shared utilities for Jira Service Management tools
 */

import {
  atlassianDiscoveryKey,
  createAtlassianDiscoveryCache,
  fetchAtlassianDiscoveryJson,
} from '@/lib/atlassian/discovery'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { AssetObject, RawAssetObject } from '@/tools/jsm/types'

/**
 * Atlassian provisions a single Assets workspace per site, so the answer is a
 * property of the `cloudId` — but whether a token may read it is not, so entries
 * are keyed by credential like every other discovery answer.
 */
const assetsWorkspaceCache = createAtlassianDiscoveryCache()

/**
 * Resolve the Jira `cloudId` and Assets `workspaceId` needed for an Assets API
 * call, using the request params when present and falling back to discovery.
 * @param domain - The Jira site domain
 * @param accessToken - The OAuth access token
 * @param cloudIdParam - Optional cloudId already supplied by the caller
 * @param workspaceIdParam - Optional workspaceId already supplied by the caller
 */
export async function resolveAssetsContext(
  domain: string,
  accessToken: string,
  cloudIdParam?: string,
  workspaceIdParam?: string
): Promise<{ cloudId: string; workspaceId: string }> {
  const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))
  const workspaceId = workspaceIdParam || (await getAssetsWorkspaceId(cloudId, accessToken))
  return { cloudId, workspaceId }
}

/**
 * Normalize a raw Assets object (from get/create/update) into the trimmed
 * {@link AssetObject} shape returned by the tools.
 * @param data - The raw object payload from the Assets API
 */
export function mapAssetObject(data: RawAssetObject): AssetObject {
  return {
    id: data.id,
    label: data.label ?? null,
    objectKey: data.objectKey ?? null,
    globalId: data.globalId ?? null,
    created: data.created ?? null,
    updated: data.updated ?? null,
    hasAvatar: data.hasAvatar ?? false,
    objectType: data.objectType ?? null,
    attributes: (data.attributes ?? []).map((attr) => ({
      id: attr.id ?? '',
      objectTypeAttributeId: attr.objectTypeAttributeId ?? '',
      objectAttributeValues: (attr.objectAttributeValues ?? []).map((v) => ({
        value: v.value ?? null,
        displayValue: v.displayValue ?? null,
        searchValue: v.searchValue ?? null,
        referencedType: v.referencedType ?? false,
        referencedObject: v.referencedObject ?? null,
      })),
    })),
    link: data._links?.self ?? null,
  }
}

/**
 * Build the base URL for JSM Service Desk API
 * @param cloudId - The Jira Cloud ID
 * @returns The base URL for the Service Desk API
 */
export function getJsmApiBaseUrl(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi`
}

/**
 * Build the base URL for JSM Forms (ProForma) API
 * @param cloudId - The Jira Cloud ID
 * @returns The base URL for the JSM Forms API
 */
export function getJsmFormsApiBaseUrl(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/forms`
}

/**
 * Build common headers for JSM API requests
 * @param accessToken - The OAuth access token
 * @returns Headers object for API requests
 */
export function getJsmHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-ExperimentalApi': 'opt-in',
  }
}

/**
 * Build the base URL for the JSM Assets (Insight/CMDB) API.
 *
 * Uses the OAuth 2.0 (3LO) gateway form `/ex/jira/{cloudId}/...` — matching
 * {@link getJsmApiBaseUrl} — keyed by both the Jira `cloudId` and the Assets
 * `workspaceId` (resolved via {@link getAssetsWorkspaceId}).
 * @param cloudId - The Jira Cloud ID
 * @param workspaceId - The Assets workspace ID
 * @returns The base URL for the Assets API (v1)
 */
export function getAssetsApiBaseUrl(cloudId: string, workspaceId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/jsm/assets/workspace/${workspaceId}/v1`
}

/**
 * Resolve the Assets `workspaceId` for a Jira site.
 *
 * Calls the Service Desk discovery endpoint and uses the first workspace.
 * Atlassian provisions a single Assets workspace per site, so this is the
 * canonical workspace; callers on a multi-workspace site can pass an explicit
 * `workspaceId` to {@link resolveAssetsContext} to override it. Requires the
 * `read:servicedesk-request` scope (already granted by the `jira` provider).
 * @param cloudId - The Jira Cloud ID
 * @param accessToken - The OAuth access token
 * @returns The Assets workspace ID for the site
 * @throws If discovery fails or no workspace is provisioned
 */
export function getAssetsWorkspaceId(cloudId: string, accessToken: string): Promise<string> {
  return assetsWorkspaceCache.resolve(atlassianDiscoveryKey(cloudId, accessToken), async () => {
    const data = await fetchAtlassianDiscoveryJson<{ values?: Array<{ workspaceId?: string }> }>(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi/assets/workspace`,
      getJsmHeaders(accessToken),
      'Failed to resolve Assets workspace'
    )

    const workspaceId = data?.values?.[0]?.workspaceId

    if (!workspaceId) {
      throw new Error(
        'No Assets workspace found for this site. Assets (Insight) may not be enabled on the Jira instance.'
      )
    }

    return workspaceId
  })
}
