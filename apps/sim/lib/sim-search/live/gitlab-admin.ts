import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { createUserKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { groupToken } from '@/lib/knowledge/access/tokens'
import { hasConnectorPermissionGrant } from '@/lib/knowledge/connectors/permission-store'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'
import { readGitLab, searchGitLab } from '@/lib/sim-search/live/gitlab'
import { array, NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { collectNativePages } from '@/lib/sim-search/live/pages'
import type {
  LiveAccount,
  NativeClient,
  NativeDocument,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'
import { seedGitLabCsvContext } from '@/connectors/gitlab/permission-config/repository'
import {
  getGitLabCsvContext,
  gitLabCsvGroupToken,
} from '@/connectors/gitlab/permission-config/types'
import {
  getGitLabDocumentAcls,
  openGitLabDirectory,
  validateGitLabCsvToken,
} from '@/connectors/gitlab/permissions'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'

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

export async function listAdminGitLabAccounts(owner: ResourceOwner): Promise<LiveAccount[]> {
  return (await sources(owner)).map((source) => ({
    id: `${PREFIX}${source.id}`,
    provider: 'gitlab',
    providerId: 'gitlab',
    displayName: 'GitLab',
    type: 'admin_source',
    scopes: [],
  }))
}

export async function resolveAdminGitLabAccount(owner: ResourceOwner, account: LiveAccount) {
  const [source] = await sources(owner, account.id.slice(PREFIX.length))
  if (!account.id.startsWith(PREFIX) || !source?.encryptedApiKey)
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
export async function createAdminGitLabSession(input: {
  owner: ResourceOwner
  userId: string
  source: AdminSource
  token: string
  client: NativeClient
  signal: AbortSignal
}) {
  const { owner, userId, source, token, client, signal } = input
  const { config } = source
  const access = await createUserKnowledgeAccessProvider(userId, {
    workspaceId: owner.workspaceId ?? undefined,
    organizationId: owner.organizationId ?? undefined,
  }).get()
  if (access.kind !== 'user')
    throw new NativeSearchError(
      'unavailable',
      'GitLab search requires a verified organization identity.'
    )
  const own = access.tokens.find((value) => value.startsWith('u:'))
  if (!own)
    throw new NativeSearchError(
      'unavailable',
      'GitLab search requires a verified organization identity.'
    )
  const context = {}
  await seedGitLabCsvContext(source.id, context)
  const csv = getGitLabCsvContext(context)
  const tokens = new Set([own])
  let project: string
  let projectPath: string
  if (csv) {
    /** Indexed ACL rewrites do not govern current CSV grants for provider-backed reads. */
    if (!(await hasConnectorPermissionGrant(source.id, 'project', own)))
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
