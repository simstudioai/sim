import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { createUserKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { groupToken } from '@/lib/knowledge/access/tokens'
import {
  connectorsGrantingSubject,
  hasConnectorPermissionGrant,
  readConnectorPermissionGrants,
  readConnectorPermissionMetadata,
} from '@/lib/knowledge/connectors/permission-store'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'
import { readGitLab, searchGitLab } from '@/lib/sim-search/live/gitlab'
import { array, NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { collectNativePages, joinMessages } from '@/lib/sim-search/live/pages'
import type {
  LiveAccount,
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'
import {
  type GitLabGroupScope,
  gitLabGroupMatchesConfig,
  gitLabProjectInGroup,
} from '@/connectors/gitlab/group'
import {
  readGitLabPermissionMetadata,
  seedGitLabPermissionContext,
} from '@/connectors/gitlab/permission-config/repository'
import {
  type GitLabCsvSyncContext,
  getGitLabCsvContext,
  gitLabCsvGroupToken,
  setGitLabCsvContext,
} from '@/connectors/gitlab/permission-config/types'
import {
  getGitLabDocumentAcls,
  openGitLabDirectory,
  validateGitLabCsvToken,
} from '@/connectors/gitlab/permissions'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'

const logger = createLogger('SimSearchGitLabSources')
const PREFIX = 'gitlab-source:'

/** Canonical admin-managed sources only. Neither credentials nor indexed documents leave this module. */
async function sources(owner: ResourceOwner, connectorId?: string) {
  return db
    .select({
      id: knowledgeConnector.id,
      config: knowledgeConnector.sourceConfig,
      encryptedApiKey: knowledgeConnector.encryptedApiKey,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        resourceScopeCondition(knowledgeBase, resourceScopeFromOwner(owner)),
        eq(knowledgeBase.isSearchIndex, true),
        eq(knowledgeConnector.connectorType, 'gitlab'),
        eq(knowledgeConnector.accessMode, 'admin'),
        inArray(knowledgeConnector.status, ['active', 'pending', 'syncing', 'error']),
        isNull(knowledgeBase.deletedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeConnector.archivedAt),
        searchIntegrationAccessCondition(),
        connectorId ? eq(knowledgeConnector.id, connectorId) : undefined
      )
    )
}

/** The viewer's own identity token, the subject every GitLab grant is checked against. */
async function viewerToken(owner: ResourceOwner, userId: string): Promise<string | undefined> {
  const access = await createUserKnowledgeAccessProvider(userId, {
    workspaceId: owner.workspaceId ?? undefined,
    organizationId: owner.organizationId ?? undefined,
  }).get()
  return access.kind === 'user' ? access.tokens.find((value) => value.startsWith('u:')) : undefined
}

function hasCsvPermissions(metadata: unknown): boolean {
  try {
    return readGitLabPermissionMetadata(metadata).mode === 'csv'
  } catch {
    return false
  }
}

/** The IDs of CSV-permission sources that grant the viewer no project. */
async function ungrantedSources(
  owner: ResourceOwner,
  userId: string,
  ids: string[]
): Promise<Set<string>> {
  const csv = (await readConnectorPermissionMetadata(ids))
    .filter((row) => hasCsvPermissions(row.metadata))
    .map((row) => row.connectorId)
  const own = csv.length ? await viewerToken(owner, userId) : undefined
  if (!own) return new Set()
  const granted = await connectorsGrantingSubject(csv, own)
  return new Set(csv.filter((id) => !granted.has(id)))
}

/**
 * A source whose uploaded permissions grant the viewer nothing could never return a result, so it
 * is left out rather than reported unavailable on every search. Sources that check permissions
 * with GitLab, any whose stored permissions cannot be read, and every source when this check
 * itself fails stay listed: their session decides.
 */
export async function listAdminGitLabAccounts(
  owner: ResourceOwner,
  userId: string
): Promise<LiveAccount[]> {
  const rows = await sources(owner)
  if (!rows.length) return []
  const hidden = await ungrantedSources(
    owner,
    userId,
    rows.map((source) => source.id)
  ).catch((error: unknown) => {
    logger.warn('GitLab source grants could not be checked; listing every source', {
      error: describeError(error),
    })
    return new Set<string>()
  })
  return rows
    .filter((source) => !hidden.has(source.id))
    .map((source) => ({
      id: `${PREFIX}${source.id}`,
      provider: 'gitlab',
      providerId: 'gitlab',
      displayName: 'GitLab',
      type: 'admin_source',
      scopes: [],
    }))
}

/** Whether a live account ID names an administrator-managed GitLab source. */
export function isAdminGitLabAccountId(accountId: string): boolean {
  return accountId.startsWith(PREFIX)
}

export async function resolveAdminGitLabAccount(owner: ResourceOwner, account: LiveAccount) {
  const [source] = await sources(owner, account.id.slice(PREFIX.length))
  if (!isAdminGitLabAccountId(account.id) || !source?.encryptedApiKey)
    throw new NativeSearchError(
      'unavailable',
      'Ask an organization admin to check the GitLab connection.'
    )
  const config = object(source.config)
  const origin = `https://${normalizeGitLabHost(config.host)}`
  const { decrypted: accessToken } = await decryptApiKey(source.encryptedApiKey)
  return { account, accessToken, origin, adminSource: { id: source.id, config } }
}

type Reference = Pick<NativeDocument, 'id' | 'container' | 'kind' | 'revision'>
type AdminSource = { id: string; config: Record<string, unknown> }

export function gitLabSourceKinds(config: Record<string, unknown>): string[] {
  switch (config.contentTypes || 'both') {
    case 'all':
      return ['code', 'wiki', 'issues', 'merge_requests']
    case 'repo':
      return ['code']
    case 'wiki':
      return ['wiki']
    case 'issues':
      return ['issues']
    case 'merge_requests':
      return ['merge_requests']
    case 'both':
      return ['wiki', 'issues']
    default:
      return []
  }
}

/** Fresh source ACL evidence is request-local. CSV grants remain connector-local and administrator maintained. */
interface GitLabSessionInput {
  owner: ResourceOwner
  userId: string
  source: AdminSource
  token: string
  client: NativeClient
  signal: AbortSignal
}

export async function createAdminGitLabSession(input: GitLabSessionInput) {
  const own = await viewerToken(input.owner, input.userId)
  if (!own)
    throw new NativeSearchError(
      'unavailable',
      'GitLab search requires a verified organization identity.'
    )
  if (input.source.config.scope === 'group') return createGroupSession(input, own)
  return createProjectSession(input, own)
}

async function createProjectSession(
  input: GitLabSessionInput,
  own: string,
  groupProject?: { identity: GitLabCsvSyncContext; csv: boolean }
) {
  const { source, token, client, signal } = input
  const { config } = source
  const context = {}
  if (groupProject?.csv) setGitLabCsvContext(context, groupProject.identity)
  else if (!groupProject) await seedGitLabPermissionContext(source.id, context)
  const csv = getGitLabCsvContext(context)
  const tokens = new Set([own])
  let project: string
  let projectPath: string
  if (csv) {
    /** Indexed ACL rewrites do not govern current CSV grants for provider-backed reads. */
    if (
      !(await hasConnectorPermissionGrant(
        source.id,
        groupProject ? `project:${groupProject.identity.projectId}` : 'project',
        own
      ))
    )
      throw new NativeSearchError(
        'unavailable',
        'This GitLab source is not available to your account.'
      )
    const current = await validateGitLabCsvToken(token, config, signal)
    if (
      current.host !== csv.host ||
      current.projectId !== csv.projectId ||
      current.projectPath !== csv.projectPath
    )
      throw new NativeSearchError(
        'unavailable',
        'An admin must update permissions for this GitLab source.'
      )
    project = String(current.projectId)
    projectPath = current.projectPath
    tokens.add(gitLabCsvGroupToken(source.id))
  } else {
    const directory = await openGitLabDirectory(token, config, context, signal)
    for (const group of await directory.listGroups()) {
      signal.throwIfAborted()
      const membership = await directory.listGroupMembers(group)
      if (!membership.complete)
        throw new NativeSearchError('unavailable', 'GitLab permissions could not be verified.')
      if (membership.memberTokens.includes(own)) {
        const grant = groupToken({
          providerId: directory.providerId,
          tenantId: directory.tenantId,
          groupId: group.id,
        })
        if (grant) tokens.add(grant)
      }
    }
    const current = object(await client.json(`/api/v4/projects/${segment(string(config.project))}`))
    project = string(current.id)
    projectPath = string(current.path_with_namespace)
  }
  if (
    groupProject &&
    (project !== String(groupProject.identity.projectId) ||
      projectPath !== groupProject.identity.projectPath)
  )
    throw new NativeSearchError(
      'unavailable',
      'An admin must refresh permissions for this GitLab project.'
    )
  if (!project || !projectPath)
    throw new NativeSearchError('unavailable', 'GitLab project identity could not be verified.')
  signal.throwIfAborted()
  const kinds = gitLabSourceKinds(config)
  const permittedReference = (reference: Reference) => {
    if (
      ![project, projectPath].includes(reference.container ?? '') ||
      !kinds.includes(reference.kind ?? '')
    )
      return false
    if (reference.kind !== 'code') return true
    const path = reference.id
    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').some((part) => !part || part === '..' || part === '.')
    )
      return false
    const prefix = string(config.pathPrefix).replace(/^\/+|\/+$/g, '')
    if (prefix && !path.startsWith(`${prefix}/`)) return false
    const extensions = string(config.fileExtensions)
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
    if (
      extensions.length &&
      !extensions.some((extension) =>
        path.toLowerCase().endsWith(extension.startsWith('.') ? extension : `.${extension}`)
      )
    )
      return false
    const branch = string(config.ref)
    return !branch || reference.revision === branch
  }
  const verify = async (
    reference: Reference,
    evidence?: Record<string, unknown>
  ): Promise<boolean> => {
    signal.throwIfAborted()
    if (!permittedReference(reference)) return false
    let metadata: Record<string, unknown> = {}
    if (reference.kind === 'issues' || reference.kind === 'merge_requests') {
      if (!/^[1-9]\d*$/.test(reference.id)) return false
      const row =
        evidence ??
        object(
          await client.json(
            `/api/v4/projects/${segment(project)}/${reference.kind}/${reference.id}`
          )
        )
      if (!evidence && (string(row.project_id) !== project || string(row.iid) !== reference.id))
        return false
      metadata = evidence ?? {
        confidential: row.confidential,
        authorId: object(row.author).id,
        assigneeIds: array(row.assignees).map((person) => person.id),
      }
      if (reference.kind === 'issues') {
        const state = string(config.issueState)
        if (state && state !== 'all' && row.state !== state) return false
        const labels = string(config.issueLabels)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
        if (labels.some((label) => !Array.isArray(row.labels) || !row.labels.includes(label)))
          return false
        if (config.issueMilestone && object(row.milestone).title !== config.issueMilestone)
          return false
      }
    }
    const prefix =
      reference.kind === 'code'
        ? 'file'
        : reference.kind === 'issues'
          ? 'issue'
          : reference.kind === 'merge_requests'
            ? 'merge_request'
            : 'wiki'
    const externalId = `${prefix}:${reference.id}`
    const acl = await getGitLabDocumentAcls(
      token,
      config,
      [{ externalId, title: '', content: '', contentHash: '', mimeType: 'text/plain', metadata }],
      context
    )
    signal.throwIfAborted()
    return (acl[externalId] ?? []).some((grant) => tokens.has(grant))
  }
  return {
    verify,
    async search(search: NativeSearchInput) {
      if (search.native?.project && ![project, projectPath].includes(search.native.project))
        return { documents: [] }
      const selected = search.native?.kind
        ? kinds.filter((kind) => kind === search.native?.kind)
        : kinds
      const scopedClient: NativeClient = {
        ...client,
        json: (path, options) =>
          client.json(path, {
            ...options,
            ...(path.endsWith('/search') &&
            string(config.ref) &&
            ['blobs', 'wiki_blobs'].includes(options?.query?.scope as string)
              ? { query: { ...options?.query, ref: string(config.ref) } }
              : {}),
          }),
      }
      const request = (kind: string) =>
        searchGitLab(scopedClient, {
          ...search,
          native: {
            provider: 'gitlab',
            query: search.query,
            ...search.native,
            project,
            kind: kind as 'code' | 'wiki' | 'issues' | 'merge_requests',
          },
        })
      const page =
        selected.length === 1
          ? await request(selected[0]!)
          : await collectNativePages(
              selected.map(request),
              'Searched administrator-configured GitLab sources with source ACLs.'
            )
      return page
    },
    async read(reference: Reference) {
      if (!(await verify(reference)))
        throw new NativeSearchError(
          'unavailable',
          'This document is no longer available to your account.'
        )
      const document = await readGitLab(
        client,
        reference.id,
        project,
        reference.kind,
        string(config.ref) || reference.revision
      )
      if (!(await verify(document, document.accessMetadata)))
        throw new NativeSearchError(
          'unavailable',
          'This document is no longer available to your account.'
        )
      return document
    },
  }
}

/** Traverse bounded project pages; every continuation and document read rechecks current grants. */
async function createGroupSession(input: GitLabSessionInput, own: string) {
  const { source, client } = input
  const [stored] = await readConnectorPermissionMetadata([source.id])
  const metadata = stored && readGitLabPermissionMetadata(stored.metadata)
  if (!metadata || !('group' in metadata) || !gitLabGroupMatchesConfig(metadata, source.config))
    throw new NativeSearchError('unavailable', 'An admin must update this GitLab group connection.')
  const grants =
    metadata.mode === 'csv'
      ? await readConnectorPermissionGrants(
          source.id,
          stored.revision,
          metadata.projects.map((project) => `project:${project.id}`),
          own
        )
      : null
  const projects = metadata.projects.filter(
    (project) => !grants || grants.has(`project:${project.id}`)
  )
  const group = object(await client.json(`/api/v4/groups/${metadata.group.id}`, { memo: true }))
  if (
    string(group.id) !== String(metadata.group.id) ||
    string(group.full_path) !== metadata.group.path
  )
    throw new NativeSearchError('unavailable', 'An admin must refresh the GitLab group connection.')
  const sessions = new Map<number, ReturnType<typeof createProjectSession>>()
  const session = (project: GitLabGroupScope['projects'][number]) => {
    if (!gitLabProjectInGroup(project.path, metadata.group))
      throw new NativeSearchError(
        'unavailable',
        'This project is outside the configured GitLab group.'
      )
    let result = sessions.get(project.id)
    if (!result) {
      result = createProjectSession(
        {
          ...input,
          source: {
            ...source,
            config: {
              ...source.config,
              scope: undefined,
              group: undefined,
              project: String(project.id),
            },
          },
        },
        own,
        {
          csv: metadata.mode === 'csv',
          identity: {
            connectorId: source.id,
            host: metadata.host,
            projectId: project.id,
            projectPath: project.path,
          },
        }
      )
      sessions.set(project.id, result)
    }
    return result
  }
  const referencedProject = (container?: string) =>
    projects.find((project) => container === String(project.id) || container === project.path)
  return {
    async verify(reference: Reference, evidence?: Record<string, unknown>) {
      const project = referencedProject(reference.container)
      return project ? (await session(project)).verify(reference, evidence) : false
    },
    async read(reference: Reference) {
      const project = referencedProject(reference.container)
      if (!project)
        throw new NativeSearchError(
          'unavailable',
          'This GitLab document is not available to your account.'
        )
      return (await session(project)).read(reference)
    },
    async search(search: NativeSearchInput): Promise<NativePage> {
      if (search.native?.project) {
        const project = referencedProject(search.native.project)
        return project ? (await session(project)).search(search) : { documents: [] }
      }
      const kinds = gitLabSourceKinds(source.config).filter(
        (kind) => !search.native?.kind || kind === search.native.kind
      )
      const raw = search.native?.cursor ?? `${stored.revision}:${search.limit}:0:0:1`
      if (!/^\d{1,10}:\d{1,3}:\d{1,4}:\d:\d{1,4}$/.test(raw))
        throw new NativeSearchError('unavailable', 'Invalid GitLab group page.')
      const [revision, pageSize, ...position] = raw.split(':').map(Number)
      if (revision !== stored.revision || pageSize !== search.limit)
        throw new NativeSearchError(
          'unavailable',
          'GitLab permissions or page size changed. Restart the search.'
        )
      let [projectIndex = 0, kindIndex = 0, page = 1] = position
      if (page < 1 || projectIndex > projects.length || (kinds.length && kindIndex >= kinds.length))
        throw new NativeSearchError('unavailable', 'Invalid GitLab group page.')
      const documents: NativeDocument[] = []
      const failures: string[] = []
      let partial = false
      let collections = 0
      while (
        projectIndex < projects.length &&
        kinds.length &&
        collections < 4 &&
        documents.length === 0
      ) {
        input.signal.throwIfAborted()
        const project = projects[projectIndex]
        const kind = kinds[kindIndex]
        if (!project || !kind) break
        try {
          const current = await (await session(project)).search({
            ...search,
            limit: search.limit,
            native: {
              provider: 'gitlab',
              query: search.query,
              ...search.native,
              project: String(project.id),
              kind: kind as 'code' | 'wiki' | 'issues' | 'merge_requests',
              cursor: String(page),
            },
          })
          documents.push(...current.documents)
          partial ||= Boolean(current.partial)
          if (current.nextCursor) page = Number(current.nextCursor)
          else {
            page = 1
            kindIndex += 1
            if (kindIndex >= kinds.length) {
              kindIndex = 0
              projectIndex += 1
            }
          }
        } catch (error) {
          input.signal.throwIfAborted()
          if (
            error instanceof NativeSearchError &&
            ['reconnect', 'rate_limited'].includes(error.status)
          )
            throw error
          partial = true
          failures.push(
            error instanceof NativeSearchError
              ? error.message
              : 'One GitLab collection could not be searched.'
          )
          page = 1
          kindIndex += 1
          if (kindIndex >= kinds.length) {
            kindIndex = 0
            projectIndex += 1
          }
        }
        collections += 1
      }
      return {
        documents,
        partial,
        ...(projectIndex < projects.length && kinds.length
          ? {
              nextCursor: `${stored.revision}:${search.limit}:${projectIndex}:${kindIndex}:${page}`,
            }
          : {}),
        message: joinMessages([
          'Searched configured GitLab group projects with per-project permissions. Continue with the cursor for remaining projects and results.',
          ...failures,
        ]),
      }
    },
  }
}
