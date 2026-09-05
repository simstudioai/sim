import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import {
  InsufficientWorkspacePermissionsError,
  requireCurrentHumanRole,
} from '@/lib/core/application/workspace-authorization'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import {
  requireKnowledgeMemberAccessAvailable,
  requireSourceMirroredAccessAvailable,
} from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { startKnowledgeConnectorMemberEnrollment } from '@/lib/knowledge/application/connector-access'
import { createKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import {
  type KnowledgeWorkspaceContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { createKnowledgeBase } from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { findWorkspaceSearchIndex } from '@/lib/knowledge/search/search-index'
import {
  canConnectPersonally,
  missingSetupFields,
  SIM_SEARCH_KNOWLEDGE_BASE_NAME,
} from '@/lib/sim-search/connectors'
import { SIM_SEARCH_SYNC_INTERVAL_MINUTES } from '@/lib/sim-search/constants'
import { searchSourceIdentity } from '@/lib/sim-search/source-identity'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

const SIM_SEARCH_KNOWLEDGE_BASE_DESCRIPTION =
  'What each person can open in the sources they connected, searched as them.'

export interface ConnectSimSearchConnectorInput {
  workspaceId: string
  /** `CONNECTOR_META_REGISTRY` key of the source to connect. */
  connectorType: string
  /** An existing source selected by the person, scoped to the canonical workspace index. */
  connectorId?: string
  /** Source settings identify a compatible configuration when creating or reusing a source. */
  sourceConfig?: Record<string, string>
}

export interface ConnectSimSearchConnectorResult {
  knowledgeBaseId: string
  connectorId: string
  /** The enrollment link that connects the caller's own account. */
  url: string
}

async function findSimSearchConnector(input: ConnectSimSearchConnectorInput) {
  const rows = await db
    .select({
      knowledgeBaseId: knowledgeBase.id,
      connectorId: knowledgeConnector.id,
      sourceConfig: knowledgeConnector.sourceConfig,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        eq(knowledgeBase.workspaceId, input.workspaceId),
        eq(knowledgeBase.isSearchIndex, true),
        isNull(knowledgeBase.deletedAt),
        eq(knowledgeConnector.connectorType, input.connectorType),
        input.connectorId ? eq(knowledgeConnector.id, input.connectorId) : undefined,
        eq(knowledgeConnector.accessMode, 'members'),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
  const meta = CONNECTOR_META_REGISTRY[input.connectorType]!
  const identity = searchSourceIdentity(meta, input.sourceConfig ?? {})
  const matches = rows.filter((row) =>
    input.connectorId && input.sourceConfig === undefined
      ? true
      : searchSourceIdentity(meta, row.sourceConfig) === identity
  )
  if (input.connectorId && matches.length === 0) {
    throw new OrchestrationError(
      'not_found',
      'This Search source is unavailable or its settings have changed'
    )
  }
  if (matches.length > 1) {
    throw new OrchestrationError(
      'conflict',
      'Several Search sources use these settings. Choose the source you want to connect.'
    )
  }
  const match = matches[0]
  return match ? { knowledgeBaseId: match.knowledgeBaseId, connectorId: match.connectorId } : null
}

/** Resolves the current workspace search index without creating one. */
export const readSearchIndex = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readSearchIndex,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ context }) {
    return {
      workspaceId: context.workspaceId,
      knowledgeBaseId: (await findWorkspaceSearchIndex(context.workspaceId))?.id ?? null,
    }
  },
})

/** Admin setup adopts legacy indexes; reads and deletion always use the persisted index marker. */
async function ensureSearchKnowledgeBase(
  workspaceId: string,
  principal: Principal,
  request?: OrchestrationRequestContext
): Promise<string> {
  return coalesceLocally(`sim-search:base:${workspaceId}`, async () => {
    const existing = await findWorkspaceSearchIndex(workspaceId)
    if (existing) return existing.id
    try {
      const [legacy] = await db
        .update(knowledgeBase)
        .set({ isSearchIndex: true, updatedAt: new Date() })
        .where(
          and(
            eq(knowledgeBase.workspaceId, workspaceId),
            eq(knowledgeBase.name, SIM_SEARCH_KNOWLEDGE_BASE_NAME),
            eq(knowledgeBase.isSearchIndex, false),
            isNull(knowledgeBase.deletedAt)
          )
        )
        .returning({ id: knowledgeBase.id })
      if (legacy) return legacy.id
      const created = await createKnowledgeBase.execute({
        principal,
        input: {
          workspaceId,
          name: SIM_SEARCH_KNOWLEDGE_BASE_NAME,
          isSearchIndex: true,
          description: SIM_SEARCH_KNOWLEDGE_BASE_DESCRIPTION,
          source: 'ui',
        },
        request,
      })
      return created.knowledgeBase.id
    } catch (error) {
      const concurrent = await findWorkspaceSearchIndex(workspaceId)
      if (concurrent) return concurrent.id
      throw error
    }
  })
}

/** Prepares the shared search index before the existing connector setup modal collects credentials. */
export const prepareSearchSource = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.prepareSearchSource,
  resolveContext: ({
    input,
  }: {
    input: { workspaceId: string; connectorType: string; accessMode?: 'admin' | 'members' }
  }) => resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context, request }) {
    const meta = CONNECTOR_META_REGISTRY[input.connectorType]
    if (input.accessMode === 'members') {
      if (!meta || !canConnectPersonally(meta))
        throw new OrchestrationError('validation', 'This source cannot connect member accounts')
      await requireKnowledgeMemberAccessAvailable({ workspaceId: context.workspaceId })
      const userId = resolvePrincipalSubjectUserId(principal)
      if (!userId)
        throw new OrchestrationError('forbidden', 'Sign in to configure workspace accounts')
      const group = await ensureWorkspaceAccountsGroup(context.workspaceId, userId)
      return {
        knowledgeBaseId: await ensureSearchKnowledgeBase(context.workspaceId, principal, request),
        credentialGroupId: group.id,
      }
    }
    if (!meta?.search || !meta.mirrorsSourceAcls)
      throw new OrchestrationError('validation', 'This source cannot mirror source permissions')
    await requireSourceMirroredAccessAvailable({ workspaceId: context.workspaceId })
    return {
      knowledgeBaseId: await ensureSearchKnowledgeBase(context.workspaceId, principal, request),
    }
  },
})

/**
 * The first connect of a source turns it on for the whole workspace, which is
 * an admin decision the same way a members-mode connector is. Refused with
 * the way forward rather than the nested operations' generic role error, so a
 * reader learns whom to ask and for what.
 */
async function requireSimSearchSetupAdmin(
  userId: string,
  context: KnowledgeWorkspaceContext,
  sourceName: string
): Promise<void> {
  try {
    await requireCurrentHumanRole(userId, context, 'admin')
  } catch (error) {
    if (!(error instanceof InsufficientWorkspacePermissionsError)) throw error
    throw new OrchestrationError(
      'forbidden',
      `${sourceName} is not connected in this workspace yet. Ask a workspace admin to connect ${sourceName} first; after that everyone connects their own account.`
    )
  }
}

/**
 * One click on a Sim Search source: the workspace's Sim Search knowledge base
 * and a per-member connector for that source exist after this, and the caller
 * gets the link that connects their own account. The first connect of a
 * source creates both, which takes a workspace admin and the source's setup
 * fields when it has any; every connect after that only enrolls. The OAuth
 * completion queues the member run, so indexing starts on its own.
 *
 * The database identifies one active search index per workspace. Local
 * singleflight also coalesces repeated setup clicks for each source; concurrent
 * source creation is serialized by the connector insert transaction before enrollment.
 */
export const connectSimSearchConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.simSearchConnect,
  resolveContext: ({ input }: { input: ConnectSimSearchConnectorInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context, request }): Promise<ConnectSimSearchConnectorResult> {
    const meta = CONNECTOR_META_REGISTRY[input.connectorType]
    if (!meta || !canConnectPersonally(meta)) {
      throw new OrchestrationError(
        'validation',
        'This source cannot be connected per person; a workspace admin sets it up from a knowledge base'
      )
    }
    const workspaceId = context.workspaceId
    let target = await findSimSearchConnector({ ...input, workspaceId })
    if (!target) {
      const userId = resolvePrincipalSubjectUserId(principal)
      if (!userId) throw new OrchestrationError('forbidden', 'Sign in to connect your account')
      const sourceConfig = input.sourceConfig ?? {}
      const missing = missingSetupFields(meta, sourceConfig)
      if (missing.length > 0) {
        throw new OrchestrationError(
          'validation',
          `${meta.name} needs ${missing.map((field) => field.title).join(' and ')} to connect`
        )
      }
      /**
       * Judged before anything is created: the connector creation below checks
       * the same availability, but only after the knowledge base exists.
       */
      await Promise.all([
        requireKnowledgeMemberAccessAvailable({ workspaceId }),
        requireSimSearchSetupAdmin(userId, context, meta.name),
      ])
      const knowledgeBaseId = await ensureSearchKnowledgeBase(workspaceId, principal, request)
      target = await coalesceLocally(
        `sim-search:connect:${workspaceId}:${input.connectorType}:${searchSourceIdentity(meta, sourceConfig)}`,
        async () => {
          const existing = await findSimSearchConnector({ ...input, workspaceId })
          if (existing) return existing
          const created = await createKnowledgeConnector.execute({
            principal,
            input: {
              knowledgeBaseId,
              assertedWorkspaceId: workspaceId,
              connectorType: input.connectorType,
              sourceConfig,
              syncIntervalMinutes: SIM_SEARCH_SYNC_INTERVAL_MINUTES,
              accessMode: 'members',
              reuseSearchSource: true,
              source: 'ui',
            },
            request,
          })
          return { knowledgeBaseId, connectorId: created.connector.id }
        }
      )
    }
    const { url } = await startKnowledgeConnectorMemberEnrollment.execute({
      principal,
      input: {
        knowledgeBaseId: target.knowledgeBaseId,
        connectorId: target.connectorId,
        assertedWorkspaceId: workspaceId,
      },
      request,
    })
    return { ...target, url }
  },
})
