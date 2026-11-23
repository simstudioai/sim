import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { groupToken, sortAccessTokens, userToken } from '@/lib/knowledge/access/tokens'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  GITLAB_GROUP_MAX_PROJECTS,
  type GitLabGroupScope,
  gitLabProjectInGroup,
} from '@/connectors/gitlab/group'
import {
  getGitLabCsvContext,
  gitLabCsvGroupToken,
} from '@/connectors/gitlab/permission-config/types'
import {
  discoverGitLabPermissionPolicy,
  type GitLabSourcePolicy,
} from '@/connectors/gitlab/permission-policy'
import type { ConnectorDirectory, ExternalDocument } from '@/connectors/types'
import { encodeGitLabResourceId, normalizeGitLabHost } from '@/tools/gitlab/utils'

const logger = createLogger('GitLabPermissions')

const MAX_DIRECTORY_PAGES = 500
const PAGE_SIZE = 100
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024
const FEATURES = ['repository', 'wiki', 'issues', 'confidential_issues', 'merge_requests'] as const
type Feature = (typeof FEATURES)[number]

export interface GitLabPermissionProject {
  id: number
  path_with_namespace?: string
  visibility: 'private' | 'internal' | 'public'
  repository_access_level?: string
  merge_requests_access_level?: string
  wiki_access_level?: string
  issues_access_level?: string
  namespace?: { id: number; kind: 'user' | 'group' }
  shared_with_groups?: Array<{ group_id: number }>
}

/** CSV access is managed by Sim administrators, so only identity and project reads are needed. */
export async function validateGitLabCsvToken(
  token: string,
  sourceConfig: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ host: string; projectId: number; projectPath: string }> {
  const { base, project } = sourceAddress(sourceConfig)
  const viewer = await read<GitLabPermissionUser>(`${base}/user`, token, 'account', true, signal)
  if (viewer.state !== 'active' || viewer.locked === true || !Number.isSafeInteger(viewer.id)) {
    throw new Error('An active GitLab identity with read_api access is required')
  }
  const record = await read<GitLabPermissionProject>(
    `${base}/projects/${project}`,
    token,
    'project',
    true,
    signal
  )
  if (!Number.isSafeInteger(record.id) || record.id <= 0 || !record.path_with_namespace) {
    throw new Error('GitLab did not return the project identity')
  }
  return {
    host: normalizeGitLabHost(sourceConfig.host),
    projectId: record.id,
    projectPath: record.path_with_namespace,
  }
}

/** Validate the current token and resolve the canonical group without enumerating its projects. */
export async function validateGitLabGroupToken(
  token: string,
  config: Record<string, unknown>,
  mode: 'csv' | 'administrator',
  signal?: AbortSignal
): Promise<Pick<GitLabGroupScope, 'host' | 'group'>> {
  const host = normalizeGitLabHost(config.host)
  const requested = typeof config.group === 'string' ? config.group.trim() : ''
  if (!requested || (config.project !== undefined && config.project !== ''))
    throw new Error('Provide a GitLab group ID or full path without a project.')
  if (![undefined, '', 'true', 'false'].includes(config.includeSubgroups as string | undefined))
    throw new Error('Invalid GitLab subgroup setting')
  const encodedGroup = encodeGitLabResourceId(requested)
  const base = `https://${host}/api/v4`
  const viewer = await read<GitLabPermissionUser>(`${base}/user`, token, 'account', true, signal)
  if (
    viewer.state !== 'active' ||
    viewer.locked === true ||
    !Number.isSafeInteger(viewer.id) ||
    (mode === 'administrator' && viewer.is_admin !== true)
  )
    throw new Error(
      mode === 'administrator'
        ? 'Use an active GitLab administrator token, or choose non-admin CSV permissions.'
        : 'An active GitLab identity with read_api access is required'
    )
  const record = await read<{ id: number; full_path: string }>(
    `${base}/groups/${encodedGroup}`,
    token,
    'group',
    true,
    signal
  )
  if (
    !Number.isSafeInteger(record.id) ||
    record.id <= 0 ||
    typeof record.full_path !== 'string' ||
    !record.full_path
  )
    throw new Error('GitLab did not return the group identity')
  const group = {
    id: record.id,
    path: record.full_path,
    includeSubgroups: config.includeSubgroups === 'true',
  }
  return { host, group }
}

/** Resolve a bounded, complete group scope before any permission snapshot can be replaced. */
export async function discoverGitLabGroup(
  token: string,
  config: Record<string, unknown>,
  mode: 'csv' | 'administrator',
  signal?: AbortSignal
): Promise<GitLabGroupScope> {
  const deadline = AbortSignal.timeout(5 * 60 * 1000)
  const discoverySignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  try {
    const { host, group } = await validateGitLabGroupToken(token, config, mode, discoverySignal)
    const base = `https://${host}/api/v4`
    const projects: GitLabGroupScope['projects'] = []
    const ids = new Set<number>()
    const paths = new Set<string>()
    let manifestBytes = 0
    for await (const rows of listPages<GitLabPermissionProject>(
      `${base}/groups/${group.id}/projects?with_shared=false&include_subgroups=${group.includeSubgroups}&simple=true&order_by=id&sort=asc`,
      token,
      discoverySignal,
      GITLAB_GROUP_MAX_PROJECTS
    )) {
      for (const row of rows) {
        if (
          !Number.isSafeInteger(row.id) ||
          row.id <= 0 ||
          typeof row.path_with_namespace !== 'string' ||
          row.path_with_namespace.length > 1024 ||
          !gitLabProjectInGroup(row.path_with_namespace, group) ||
          ids.has(row.id) ||
          paths.has(row.path_with_namespace)
        )
          throw new Error(
            'GitLab returned an inconsistent group project listing. Retry the update.'
          )
        const project = { id: row.id, path: row.path_with_namespace }
        manifestBytes += Buffer.byteLength(JSON.stringify(project), 'utf8') + 1
        if (manifestBytes > 16 * 1024 * 1024)
          throw new Error('GitLab group project paths exceed 16 MiB. Choose a narrower group.')
        ids.add(project.id)
        paths.add(project.path)
        projects.push(project)
      }
    }
    if (!projects.length)
      throw new Error('The GitLab token cannot read any projects in this group.')
    projects.sort((left, right) => left.id - right.id)
    return { host, group, projects }
  } catch (error) {
    if (deadline.aborted && !signal?.aborted)
      throw new Error(
        'GitLab group discovery exceeded five minutes. Retry or choose a narrower group.'
      )
    throw error
  }
}

export interface GitLabPermissionUser {
  id: number
  email?: string
  state: string
  locked?: boolean
  external?: boolean
  is_admin?: boolean
  confirmed_at?: string | null
}

export interface GitLabPermissionMember {
  id: number
  access_level: number
  state: string
  expires_at?: string | null
}

interface PermissionSnapshot {
  project: GitLabPermissionProject
  users: GitLabPermissionUser[]
  members: GitLabPermissionMember[]
  policy: GitLabSourcePolicy
}

/** A sync owns this cache; credentials and permission snapshots never survive into another run. */
const snapshots = new WeakMap<
  Record<string, unknown>,
  {
    token: string
    address: string
    value: Promise<PermissionSnapshot>
  }
>()

function sourceAddress(sourceConfig: Record<string, unknown>) {
  const host = normalizeGitLabHost(sourceConfig.host)
  const project = String(sourceConfig.project ?? '').trim()
  if (!project) throw new Error('GitLab project is required')
  let decoded = project
  try {
    decoded = decodeURIComponent(project)
  } catch {
    /** A literal percent sign is encoded with the rest of the project path. */
  }
  return {
    base: `https://${host}/api/v4`,
    tenant: encodeURIComponent(host),
    project: encodeURIComponent(decoded),
  }
}

async function read<T>(
  url: string,
  token: string,
  operation: 'account' | 'project' | 'group',
  validating = false,
  signal?: AbortSignal
): Promise<T> {
  const response = await secureFetchWithRetry(
    url,
    {
      profile: 'configuredEndpoint',
      signal,
      headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
    },
    { ...(validating ? VALIDATE_RETRY_OPTIONS : {}), maxResponseBytes: MAX_RESPONSE_BYTES, signal }
  )
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id')
    logger.warn('GitLab permission read failed', {
      operation,
      status: response.status,
      ...(requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)
        ? { providerRequestId: requestId }
        : {}),
    })
    if (response.status === 401) {
      throw new Error('GitLab did not accept the token. Use a valid token with read_api scope.')
    }
    if (response.status === 403) {
      throw new Error(
        'GitLab denied access. Check read_api scope, token access, and IP restrictions.'
      )
    }
    if (response.status === 404) {
      throw new Error(
        operation === 'group'
          ? 'Could not access this GitLab group. Check the group ID or full path, token access, and IP restrictions.'
          : operation === 'project'
            ? 'Could not access this GitLab project. Check the project ID or full path, token access, and IP restrictions.'
            : 'Could not verify the GitLab account. Check the host and API access.'
      )
    }
    throw new Error(
      `GitLab could not verify ${operation} access (HTTP ${response.status}). Try again.`
    )
  }
  return (await response.json()) as T
}

/** Mirroring requires private, verified user identities; public profile emails are not identity proof. */
export async function validateGitLabPermissionToken(
  token: string,
  sourceConfig: Record<string, unknown>
): Promise<void> {
  await requireAdministrator(token, sourceConfig)
  const { base, project } = sourceAddress(sourceConfig)
  const record = await read<GitLabPermissionProject>(
    `${base}/projects/${project}`,
    token,
    'project',
    true
  )
  await discoverGitLabPermissionPolicy(token, sourceConfig, record, true)
}

async function requireAdministrator(
  token: string,
  sourceConfig: Record<string, unknown>,
  signal?: AbortSignal
): Promise<void> {
  const { base } = sourceAddress(sourceConfig)
  const viewer = await read<GitLabPermissionUser>(`${base}/user`, token, 'account', true, signal)
  if (viewer.is_admin !== true || viewer.state !== 'active' || viewer.locked === true) {
    throw new Error(
      'Mirror source permissions requires an active GitLab instance administrator token with read_api access'
    )
  }
}

/** Bounded complete enumeration. Never accept a partial directory as authoritative membership. */
async function* listPages<T>(
  url: string,
  token: string,
  signal?: AbortSignal,
  maxItems?: number
): AsyncGenerator<T[]> {
  const initial = new URL(url)
  initial.searchParams.set('per_page', String(PAGE_SIZE))
  let next: URL | null = initial
  const seen = new Set<string>()
  let itemCount = 0
  let retainedBytes = 0
  let expectedTotal: number | undefined
  const maxPages =
    maxItems === undefined ? MAX_DIRECTORY_PAGES : Math.ceil(maxItems / PAGE_SIZE) + 1
  for (let page = 0; next && page < maxPages; page += 1) {
    signal?.throwIfAborted()
    if (seen.has(next.href)) throw new Error('GitLab permission pagination repeated a page')
    seen.add(next.href)
    const response = await secureFetchWithRetry(
      next.href,
      {
        profile: 'configuredEndpoint',
        signal,
        headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
      },
      { maxResponseBytes: MAX_RESPONSE_BYTES, signal }
    )
    if (!response.ok) throw new Error(`GitLab permission listing failed (${response.status})`)
    const body = (await response.json()) as T[]
    if (!Array.isArray(body)) throw new Error('GitLab permission listing was not an array')
    if (maxItems === undefined) retainedBytes += Buffer.byteLength(JSON.stringify(body), 'utf8')
    if (
      body.length > PAGE_SIZE ||
      (maxItems === undefined && retainedBytes > MAX_DIRECTORY_BYTES)
    ) {
      throw new Error('GitLab permission directory exceeded its response budget')
    }
    itemCount += body.length
    if (maxItems !== undefined) {
      const totalHeader = response.headers.get('x-total')
      if (totalHeader !== null) {
        const total = Number(totalHeader)
        if (!/^\d+$/.test(totalHeader) || !Number.isSafeInteger(total))
          throw new Error('GitLab returned an invalid group project total.')
        if (total > maxItems)
          throw new Error('GitLab group exceeds 50,000 projects. Choose a narrower group.')
        if (expectedTotal !== undefined && total !== expectedTotal)
          throw new Error('GitLab group projects changed during discovery. Retry the update.')
        expectedTotal = total
      }
      if (itemCount > maxItems)
        throw new Error('GitLab group exceeds 50,000 projects. Choose a narrower group.')
    }
    yield body
    const link = response.headers
      .get('link')
      ?.split(',')
      .find((part) => /rel="?next"?/i.test(part))
    const linked = link?.match(/<([^>]+)>/)?.[1]
    const nextPage = response.headers.get('x-next-page')
    if (linked) {
      const candidate = new URL(linked, initial)
      if (candidate.origin !== initial.origin || candidate.pathname !== initial.pathname) {
        throw new Error('GitLab permission pagination changed its source')
      }
      if (
        maxItems !== undefined &&
        [...initial.searchParams].some(
          ([key, value]) => key !== 'page' && candidate.searchParams.get(key) !== value
        )
      )
        throw new Error('GitLab group pagination changed its scope')
      next = candidate
    } else if (nextPage) {
      if (!/^\d+$/.test(nextPage)) throw new Error('Invalid GitLab permission page')
      next = new URL(initial)
      next.searchParams.set('page', nextPage)
    } else if (
      maxItems !== undefined &&
      body.length === PAGE_SIZE &&
      response.headers.get('x-next-page') === null
    ) {
      next = new URL(initial)
      next.searchParams.set('page', String(page + 2))
    } else {
      next = null
    }
  }
  if (expectedTotal !== undefined && itemCount !== expectedTotal)
    throw new Error('GitLab group project listing was incomplete')
  if (next) throw new Error('GitLab permission directory exceeded its page limit')
}

async function listAll<T>(url: string, token: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = []
  for await (const page of listPages<T>(url, token, signal)) items.push(...page)
  return items
}

function verifiedEmail(person: GitLabPermissionUser): string | null {
  if (
    person.state !== 'active' ||
    person.locked === true ||
    typeof person.confirmed_at !== 'string' ||
    !Number.isFinite(Date.parse(person.confirmed_at))
  )
    return null
  return userToken(person.email) ? normalizeEmail(person.email as string) : null
}

function activeRole(member: GitLabPermissionMember | undefined, now: Date): number {
  if (!member || member.state !== 'active') return 0
  if (member.expires_at) {
    const expiry = Date.parse(`${member.expires_at}T00:00:00Z`)
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) return 0
  }
  return [10, 15, 20, 25, 30, 40, 50].includes(member.access_level) ? member.access_level : 0
}

function accessLevel(project: GitLabPermissionProject, feature: Feature): string | undefined {
  return feature === 'confidential_issues'
    ? project.issues_access_level
    : project[`${feature}_access_level`]
}

/** Base-role permissions only; custom roles can add access but never widen this conservative mirror. */
export function gitLabFeatureAudience(
  project: GitLabPermissionProject,
  users: readonly GitLabPermissionUser[],
  members: readonly GitLabPermissionMember[],
  feature: Feature,
  now = new Date(),
  policy: Pick<GitLabSourcePolicy, 'implicitAdmin' | 'plannerCanReadCode'> = {
    implicitAdmin: false,
    plannerCanReadCode: false,
  }
): string[] {
  const level = accessLevel(project, feature)
  if (level !== 'enabled' && level !== 'private') return []
  const roles = new Map(members.map((member) => [member.id, activeRole(member, now)]))
  const repositoryAudience =
    feature === 'merge_requests'
      ? new Set(gitLabFeatureAudience(project, users, members, 'repository', now, policy))
      : null
  const emails = new Set<string>()
  for (const person of users) {
    const email = verifiedEmail(person)
    if (!email) continue
    if (repositoryAudience && !repositoryAudience.has(email)) continue
    const role = roles.get(person.id) ?? 0
    const codeMinimum = policy.plannerCanReadCode ? 15 : 20
    const minimum =
      feature === 'repository'
        ? codeMinimum
        : feature === 'merge_requests'
          ? person.external === true && project.visibility === 'internal'
            ? 20
            : codeMinimum
          : feature === 'confidential_issues'
            ? 15
            : 10
    const broad =
      feature !== 'confidential_issues' &&
      (project.visibility === 'public' ||
        (project.visibility === 'internal' && person.external === false))
    const featureMinimum = feature === 'merge_requests' ? 20 : 10
    const featureAvailable = level === 'enabled' || role >= featureMinimum
    if (
      (person.is_admin === true && policy.implicitAdmin) ||
      (featureAvailable && (role >= minimum || broad))
    )
      emails.add(email)
  }
  return [...emails].sort()
}

function groupId(projectId: number, feature: Feature): string {
  return `project:${projectId}:${feature}`
}

async function loadSnapshot(
  token: string,
  config: Record<string, unknown>,
  signal?: AbortSignal
): Promise<PermissionSnapshot> {
  await requireAdministrator(token, config, signal)
  const { base, project } = sourceAddress(config)
  const [record, users, members] = await Promise.all([
    read<GitLabPermissionProject>(`${base}/projects/${project}`, token, 'project', false, signal),
    listAll<GitLabPermissionUser>(
      `${base}/users?pagination=keyset&order_by=id&sort=asc`,
      token,
      signal
    ),
    listAll<GitLabPermissionMember>(`${base}/projects/${project}/members/all`, token, signal),
  ])
  if (
    !Number.isInteger(record.id) ||
    !['private', 'internal', 'public'].includes(record.visibility)
  ) {
    throw new Error('GitLab did not return an authoritative project identity and visibility')
  }
  const policy = await discoverGitLabPermissionPolicy(token, config, record, false, signal)
  return { project: record, users, members, policy }
}

function snapshot(
  token: string,
  config: Record<string, unknown>,
  context?: Record<string, unknown>,
  refresh = false,
  signal?: AbortSignal
) {
  if (!context) return loadSnapshot(token, config, signal)
  const source = sourceAddress(config)
  const address = `${source.base}/projects/${source.project}`
  const cached = snapshots.get(context)
  if (!refresh && cached?.token === token && cached.address === address) return cached.value
  const value = loadSnapshot(token, config, signal)
  snapshots.set(context, { token, address, value })
  return value
}

/** A project's feature audiences reuse the shared external-directory refresh and expiry path. */
export async function openGitLabDirectory(
  token: string,
  config: Record<string, unknown>,
  context?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ConnectorDirectory> {
  const csv = getGitLabCsvContext(context)
  if (csv) {
    return {
      providerId: 'gitlab',
      tenantId: `csv-${csv.connectorId}`,
      listGroups: async () => [],
      listGroupMembers: async (group) => ({ group, memberTokens: [], complete: true }),
    }
  }
  const { tenant, base, project } = sourceAddress(config)
  const identity = await read<{ id: number }>(
    `${base}/projects/${project}`,
    token,
    'project',
    false,
    signal
  )
  if (!Number.isInteger(identity.id)) throw new Error('GitLab did not return a project identity')
  const groups = FEATURES.map((feature) => ({ id: groupId(identity.id, feature) }))
  let pending: Promise<PermissionSnapshot> | undefined
  /** A new directory lease must never reuse an earlier content-ACL snapshot. */
  const currentSnapshot = () => {
    pending ??= snapshot(token, config, context, true, signal).then((state) => {
      if (state.project.id !== identity.id)
        throw new Error('GitLab project identity changed during directory sync')
      return state
    })
    return pending
  }
  return {
    providerId: 'gitlab',
    tenantId: `${tenant}/${identity.id}`,
    listGroups: async () => {
      await currentSnapshot()
      return groups
    },
    listGroupMembers: async (group) => {
      const state = await currentSnapshot()
      const feature = FEATURES.find(
        (candidate) => group.id === groupId(state.project.id, candidate)
      )
      if (!feature) throw new Error('Unknown GitLab permission group')
      return {
        group,
        memberTokens: gitLabFeatureAudience(
          state.project,
          state.users,
          state.members,
          feature,
          new Date(),
          state.policy
        ).map((email) => userToken(email)!),
        complete: true,
      }
    },
  }
}

/** Permissions are fetched independently from content hashes, including unchanged confidential issues. */
export async function getGitLabDocumentAcls(
  token: string,
  config: Record<string, unknown>,
  documents: readonly ExternalDocument[],
  context?: Record<string, unknown>
): Promise<Record<string, string[]>> {
  const csv = getGitLabCsvContext(context)
  if (csv) {
    const result: Record<string, string[]> = {}
    for (const doc of documents) {
      const known = /^(file|wiki|issue|merge_request):/.test(doc.externalId)
      const excluded =
        doc.skippedReason ||
        (doc.externalId.startsWith('issue:') && doc.metadata?.confidential !== false)
      result[doc.externalId] = known && !excluded ? [gitLabCsvGroupToken(csv.connectorId)] : []
    }
    return result
  }
  const state = await snapshot(token, config, context)
  const { tenant } = sourceAddress(config)
  const users = new Map(state.users.map((person) => [person.id, person]))
  const issueAudience = new Set(
    gitLabFeatureAudience(
      state.project,
      state.users,
      state.members,
      'issues',
      new Date(),
      state.policy
    )
  )
  const result: Record<string, string[]> = {}
  for (const doc of documents) {
    const feature = doc.externalId.startsWith('file:')
      ? 'repository'
      : doc.externalId.startsWith('merge_request:')
        ? 'merge_requests'
        : doc.externalId.startsWith('wiki:')
          ? 'wiki'
          : doc.externalId.startsWith('issue:')
            ? 'issues'
            : null
    if (
      !feature ||
      !['enabled', 'private'].includes(accessLevel(state.project, feature) ?? '') ||
      (feature === 'merge_requests' &&
        !['enabled', 'private'].includes(state.project.repository_access_level ?? ''))
    ) {
      result[doc.externalId] = []
      continue
    }
    const confidential = feature === 'issues' && doc.metadata?.confidential === true
    if (feature === 'issues' && typeof doc.metadata?.confidential !== 'boolean') {
      result[doc.externalId] = []
      continue
    }
    if (feature === 'issues' || feature === 'merge_requests') {
      const authorId = doc.metadata?.authorId
      const author = typeof authorId === 'number' ? users.get(authorId) : undefined
      if (!author || typeof author.state !== 'string') {
        result[doc.externalId] = []
        continue
      }
      /** GitLab hides work items by banned authors; other inactive authors do not hide content. */
      if (author.state === 'banned') {
        result[doc.externalId] = state.policy.implicitAdmin
          ? sortAccessTokens(
              state.users.flatMap((person) => {
                const grant = person.is_admin === true ? userToken(verifiedEmail(person)) : null
                return grant ? [grant] : []
              })
            )
          : []
        continue
      }
    }
    const sourceGroup = groupToken({
      providerId: 'gitlab',
      tenantId: `${tenant}/${state.project.id}`,
      groupId: groupId(state.project.id, confidential ? 'confidential_issues' : feature),
    })
    if (!sourceGroup) throw new Error('GitLab returned an invalid permission group identity')
    const acl = [sourceGroup]
    if (confidential) {
      const authorId = doc.metadata?.authorId
      const assignees = doc.metadata?.assigneeIds
      const ids = new Set<number>(
        Array.isArray(assignees)
          ? assignees.filter((id): id is number => typeof id === 'number')
          : []
      )
      if (typeof authorId === 'number') ids.add(authorId)
      for (const id of ids) {
        const person = users.get(id)
        const email = person ? verifiedEmail(person) : null
        const grant = userToken(email)
        if (grant && email && issueAudience.has(email)) acl.push(grant)
      }
    }
    result[doc.externalId] = sortAccessTokens(acl)
  }
  return result
}
