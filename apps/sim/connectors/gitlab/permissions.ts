import { normalizeEmail } from '@sim/utils/string'
import { groupToken, sortAccessTokens, userToken } from '@/lib/knowledge/access/tokens'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  discoverGitLabPermissionPolicy,
  type GitLabSourcePolicy,
} from '@/connectors/gitlab/permission-policy'
import type { ConnectorDirectory, ExternalDocument } from '@/connectors/types'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'

const MAX_DIRECTORY_PAGES = 500
const PAGE_SIZE = 100
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024
const FEATURES = ['repository', 'wiki', 'issues', 'confidential_issues', 'merge_requests'] as const
type Feature = (typeof FEATURES)[number]

export interface GitLabPermissionProject {
  id: number
  visibility: 'private' | 'internal' | 'public'
  repository_access_level?: string
  merge_requests_access_level?: string
  wiki_access_level?: string
  issues_access_level?: string
  namespace?: { id: number; kind: 'user' | 'group' }
  shared_with_groups?: Array<{ group_id: number }>
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

async function read<T>(url: string, token: string, validating = false): Promise<T> {
  const response = await secureFetchWithRetry(
    url,
    {
      profile: 'configuredEndpoint',
      headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
    },
    { ...(validating ? VALIDATE_RETRY_OPTIONS : {}), maxResponseBytes: MAX_RESPONSE_BYTES }
  )
  if (!response.ok) throw new Error(`GitLab permission lookup failed (${response.status})`)
  return (await response.json()) as T
}

/** Mirroring requires private, verified user identities; public profile emails are not identity proof. */
export async function validateGitLabPermissionToken(
  token: string,
  sourceConfig: Record<string, unknown>
): Promise<void> {
  await requireAdministrator(token, sourceConfig)
  const { base, project } = sourceAddress(sourceConfig)
  const record = await read<GitLabPermissionProject>(`${base}/projects/${project}`, token, true)
  await discoverGitLabPermissionPolicy(token, sourceConfig, record, true)
}

async function requireAdministrator(
  token: string,
  sourceConfig: Record<string, unknown>
): Promise<void> {
  const { base } = sourceAddress(sourceConfig)
  const viewer = await read<GitLabPermissionUser>(`${base}/user`, token, true)
  if (viewer.is_admin !== true || viewer.state !== 'active' || viewer.locked === true) {
    throw new Error(
      'Mirror source permissions requires an active GitLab instance administrator token with read_api access'
    )
  }
}

/** Bounded complete enumeration. Never accept a partial directory as authoritative membership. */
async function listAll<T>(url: string, token: string): Promise<T[]> {
  const initial = new URL(url)
  initial.searchParams.set('per_page', String(PAGE_SIZE))
  let next: URL | null = initial
  const seen = new Set<string>()
  const items: T[] = []
  let retainedBytes = 0
  for (let page = 0; next && page < MAX_DIRECTORY_PAGES; page += 1) {
    if (seen.has(next.href)) throw new Error('GitLab permission pagination repeated a page')
    seen.add(next.href)
    const response = await secureFetchWithRetry(
      next.href,
      {
        profile: 'configuredEndpoint',
        headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
      },
      { maxResponseBytes: MAX_RESPONSE_BYTES }
    )
    if (!response.ok) throw new Error(`GitLab permission listing failed (${response.status})`)
    const body = (await response.json()) as T[]
    if (!Array.isArray(body)) throw new Error('GitLab permission listing was not an array')
    retainedBytes += Buffer.byteLength(JSON.stringify(body), 'utf8')
    if (body.length > PAGE_SIZE || retainedBytes > MAX_DIRECTORY_BYTES) {
      throw new Error('GitLab permission directory exceeded its response budget')
    }
    items.push(...body)
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
      next = candidate
    } else if (nextPage) {
      if (!/^\d+$/.test(nextPage)) throw new Error('Invalid GitLab permission page')
      next = new URL(initial)
      next.searchParams.set('page', nextPage)
    } else {
      next = null
    }
  }
  if (next) throw new Error('GitLab permission directory exceeded its page limit')
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
  config: Record<string, unknown>
): Promise<PermissionSnapshot> {
  await requireAdministrator(token, config)
  const { base, project } = sourceAddress(config)
  const [record, users, members] = await Promise.all([
    read<GitLabPermissionProject>(`${base}/projects/${project}`, token),
    listAll<GitLabPermissionUser>(`${base}/users?pagination=keyset&order_by=id&sort=asc`, token),
    listAll<GitLabPermissionMember>(`${base}/projects/${project}/members/all`, token),
  ])
  if (
    !Number.isInteger(record.id) ||
    !['private', 'internal', 'public'].includes(record.visibility)
  ) {
    throw new Error('GitLab did not return an authoritative project identity and visibility')
  }
  const policy = await discoverGitLabPermissionPolicy(token, config, record)
  return { project: record, users, members, policy }
}

function snapshot(
  token: string,
  config: Record<string, unknown>,
  context?: Record<string, unknown>,
  refresh = false
) {
  if (!context) return loadSnapshot(token, config)
  const source = sourceAddress(config)
  const address = `${source.base}/projects/${source.project}`
  const cached = snapshots.get(context)
  if (!refresh && cached?.token === token && cached.address === address) return cached.value
  const value = loadSnapshot(token, config)
  snapshots.set(context, { token, address, value })
  return value
}

/** A project's feature audiences reuse the shared external-directory refresh and expiry path. */
export async function openGitLabDirectory(
  token: string,
  config: Record<string, unknown>,
  context?: Record<string, unknown>
): Promise<ConnectorDirectory> {
  const { tenant, base, project } = sourceAddress(config)
  const identity = await read<{ id: number }>(`${base}/projects/${project}`, token)
  if (!Number.isInteger(identity.id)) throw new Error('GitLab did not return a project identity')
  const groups = FEATURES.map((feature) => ({ id: groupId(identity.id, feature) }))
  let pending: Promise<PermissionSnapshot> | undefined
  /** A new directory lease must never reuse an earlier content-ACL snapshot. */
  const currentSnapshot = () => {
    pending ??= snapshot(token, config, context, true).then((state) => {
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
