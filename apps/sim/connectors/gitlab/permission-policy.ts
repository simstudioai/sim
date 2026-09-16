import { isPlainRecord } from '@sim/utils/object'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'

const MAX_POLICY_RESPONSE_BYTES = 1024 * 1024
const MAX_POLICY_GROUPS = 512
const MAX_POLICY_TOTAL_BYTES = 16 * 1024 * 1024

export interface GitLabSourcePolicy {
  version: string
  /** False unless the instance explicitly disables session-specific Admin Mode. */
  implicitAdmin: boolean
  /** Applies to enabled repositories; private feature thresholds still apply separately. */
  plannerCanReadCode: boolean
}

export class GitLabUnsupportedPermissionPolicyError extends Error {
  constructor(reason: string) {
    super(`GitLab source permissions cannot be mirrored: ${reason}`)
    this.name = 'GitLabUnsupportedPermissionPolicyError'
  }
}

function unsupported(reason: string): never {
  throw new GitLabUnsupportedPermissionPolicyError(reason)
}

function identifier(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    unsupported(`the source did not expose a valid ${field}`)
  }
  return value
}

function parseVersion(value: unknown): { version: string; plannerCanReadCode: boolean } {
  const version = isPlainRecord(value) ? value.version : undefined
  if (typeof version !== 'string') unsupported('the instance version could not be verified')
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(?:ee|ce))?$/)
  if (!match) unsupported('the instance uses an unrecognized or prerelease version')
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major < 17 || (major === 17 && minor < 4)) {
    unsupported(
      'GitLab 17.4 or later is required to enumerate inherited and invited members reliably'
    )
  }
  return {
    version,
    plannerCanReadCode: major > 18 || (major === 18 && minor >= 7),
  }
}

function sharedGroupIds(value: unknown): number[] {
  if (!Array.isArray(value)) unsupported('the source did not expose its shared group policy')
  if (value.length > MAX_POLICY_GROUPS)
    unsupported('the shared group policy exceeded its size limit')
  return value.map((entry) => {
    if (!isPlainRecord(entry)) unsupported('the source returned an invalid shared group')
    return identifier(entry.group_id, 'shared group ID')
  })
}

/**
 * These fields are conditionally exposed only when the corresponding feature is
 * available. Successful administrator settings access establishes the permission
 * required for GroupDetail's download-ban and step-up fields. Absent paid-feature
 * fields therefore do not block an ordinary Free/CE source.
 * https://gitlab.com/gitlab-org/gitlab/-/raw/master/ee/lib/ee/api/entities/group_detail.rb
 */
function validateGroupPolicy(group: Record<string, unknown>): void {
  const ranges = group.ip_restriction_ranges
  if (ranges != null && (typeof ranges !== 'string' || ranges.trim())) {
    unsupported('a project or shared-group ancestor restricts access by IP address')
  }
  const limit = group.unique_project_download_limit
  if (limit != null && (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0)) {
    unsupported('a group download-ban setting could not be verified')
  }
  if (typeof limit === 'number' && limit > 0) {
    unsupported('a project or shared-group ancestor enforces namespace download bans')
  }
  const autoBan = group.auto_ban_user_on_excessive_projects_download
  if (autoBan != null && autoBan !== false) {
    unsupported('a project or shared-group ancestor enables automatic namespace bans')
  }
  const stepUp = group.step_up_auth_required_oauth_provider
  if (stepUp != null && (typeof stepUp !== 'string' || stepUp.trim())) {
    unsupported(
      'a project or shared-group ancestor requires session-specific step-up authentication'
    )
  }
}

/**
 * Inspects provider policy before publishing role-based ACLs. External policy
 * decisions, source IP and per-session authentication cannot be represented by
 * persistent email/group tokens, so such sources fail explicitly. Call once per
 * sync snapshot and during setup; never persist this result across sync runs.
 *
 * APIs: /application/settings, /version and /groups/:id (with_projects=false).
 * Planner repository access changed in 18.7: https://docs.gitlab.com/user/permissions/.
 */
export async function discoverGitLabPermissionPolicy(
  token: string,
  sourceConfig: Record<string, unknown>,
  project: unknown,
  validating = false
): Promise<GitLabSourcePolicy> {
  const base = `https://${normalizeGitLabHost(sourceConfig.host)}/api/v4`
  let retainedBytes = 0
  const read = async (path: string): Promise<Record<string, unknown>> => {
    const response = await secureFetchWithRetry(
      `${base}${path}`,
      {
        profile: 'configuredEndpoint',
        headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
      },
      { ...(validating ? VALIDATE_RETRY_OPTIONS : {}), maxResponseBytes: MAX_POLICY_RESPONSE_BYTES }
    )
    if (!response.ok) {
      unsupported(
        `policy discovery failed (${response.status}); an administrator PAT with read_api and, when required, admin_mode scopes must read instance settings and all related groups`
      )
    }
    const body: unknown = await response.json()
    if (!isPlainRecord(body)) unsupported('policy discovery returned an invalid response')
    retainedBytes += Buffer.byteLength(JSON.stringify(body), 'utf8')
    if (retainedBytes > MAX_POLICY_TOTAL_BYTES)
      unsupported('the source policy exceeded its size limit')
    return body
  }
  const version = parseVersion(await read('/version'))
  const settings = await read('/application/settings')
  if (settings.external_authorization_service_enabled !== false) {
    unsupported(
      settings.external_authorization_service_enabled === true
        ? 'the instance delegates project access to an external authorization service'
        : 'the external authorization setting could not be verified'
    )
  }
  if (settings.admin_mode !== undefined && typeof settings.admin_mode !== 'boolean') {
    unsupported('the Admin Mode setting could not be verified')
  }
  if (
    settings.auto_ban_user_on_excessive_projects_download != null &&
    settings.auto_ban_user_on_excessive_projects_download !== false
  ) {
    unsupported('the instance enables automatic repository-download bans')
  }
  if (!isPlainRecord(project) || !isPlainRecord(project.namespace)) {
    unsupported('the project namespace could not be verified')
  }
  const namespace = project.namespace
  if (namespace.kind !== 'group' && namespace.kind !== 'user') {
    unsupported('the project has an unrecognized namespace kind')
  }
  const namespaceId = identifier(namespace.id, 'namespace ID')
  const pending = new Set(sharedGroupIds(project.shared_with_groups))
  if (namespace.kind === 'group') pending.add(namespaceId)
  const visited = new Set<number>()
  const parents = new Map<number, number | null>()
  for (const groupId of pending) {
    if (visited.has(groupId)) continue
    if (pending.size > MAX_POLICY_GROUPS)
      unsupported('the source has too many related groups to verify')
    visited.add(groupId)
    const group = await read(`/groups/${groupId}?with_projects=false`)
    if (identifier(group.id, 'group ID') !== groupId)
      unsupported('policy discovery returned a different group')
    validateGroupPolicy(group)
    const parent = group.parent_id === null ? null : identifier(group.parent_id, 'parent group ID')
    parents.set(groupId, parent)
    const chain = new Set<number>([groupId])
    let ancestor = parent
    while (ancestor !== null && parents.has(ancestor)) {
      if (chain.has(ancestor)) unsupported('the group ancestry contains a cycle')
      chain.add(ancestor)
      ancestor = parents.get(ancestor) ?? null
    }
    if (parent !== null) pending.add(parent)
    for (const shared of sharedGroupIds(group.shared_with_groups)) pending.add(shared)
  }
  return { ...version, implicitAdmin: settings.admin_mode === false }
}
