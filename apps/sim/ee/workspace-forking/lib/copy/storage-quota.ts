import { document, knowledgeBase, workspaceFiles } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import {
  checkStorageQuotaForBillingContext,
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage'
import type { DbOrTx } from '@/lib/db/types'
import type { WorkspaceCreationPolicy } from '@/lib/workspaces/policy'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'

/** Resource ids whose blob bytes a fork/sync copy would duplicate into the target. */
export interface ForkCopyBytesSelection {
  /** Workspace files selected by `workspace_files.id` (the fork modal's picker shape). */
  fileIds?: string[]
  /** Workspace files selected by storage key (the sync copy selection shape). */
  fileKeys?: string[]
  /** Knowledge bases whose live documents' stored blobs would be re-keyed into the target. */
  knowledgeBaseIds?: string[]
}

/**
 * Byte total a fork/sync copy selection would duplicate into the target: selected
 * workspace-file blobs plus the selected knowledge bases' stored document blobs. Sizes
 * come from the metadata rows (`workspace_files.size`, `document.file_size`) - no blob
 * reads. Both sums scope to the source workspace with the same filters the copy itself
 * applies, so an id that is not actually copyable can only over-count (block), never
 * under-count.
 */
export async function sumForkCopyBytes(
  executor: DbOrTx,
  sourceWorkspaceId: string,
  selection: ForkCopyBytesSelection
): Promise<number> {
  const fileIds = selection.fileIds ?? []
  const fileKeys = selection.fileKeys ?? []
  const knowledgeBaseIds = selection.knowledgeBaseIds ?? []
  if (fileIds.length === 0 && fileKeys.length === 0 && knowledgeBaseIds.length === 0) return 0

  const fileSelectors = [
    fileIds.length > 0 ? inArray(workspaceFiles.id, fileIds) : undefined,
    fileKeys.length > 0 ? inArray(workspaceFiles.key, fileKeys) : undefined,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined)
  const fileBytes =
    fileSelectors.length === 0
      ? sql<number>`0`
      : sql<number>`(
          SELECT coalesce(sum(${workspaceFiles.size}), 0)
          FROM ${workspaceFiles}
          WHERE ${and(
            fileSelectors.length === 1 ? fileSelectors[0] : or(...fileSelectors),
            eq(workspaceFiles.workspaceId, sourceWorkspaceId),
            eq(workspaceFiles.context, 'workspace'),
            isNull(workspaceFiles.deletedAt)
          )}
        )`
  const kbBytes =
    knowledgeBaseIds.length === 0
      ? sql<number>`0`
      : sql<number>`(
          SELECT coalesce(sum(${document.fileSize}), 0)
          FROM ${document}
          INNER JOIN ${knowledgeBase}
            ON ${eq(document.knowledgeBaseId, knowledgeBase.id)}
          WHERE ${and(
            inArray(knowledgeBase.id, knowledgeBaseIds),
            eq(knowledgeBase.workspaceId, sourceWorkspaceId),
            isNull(knowledgeBase.deletedAt),
            isNull(document.deletedAt),
            isNull(document.archivedAt),
            isNotNull(document.storageKey)
          )}
        )`
  const [row] = await executor.execute<{ total: number | string }>(
    sql`SELECT (${fileBytes} + ${kbBytes})::bigint AS total`
  )
  return Number(row?.total ?? 0)
}

type ForkCreationPayerPolicy = Pick<
  WorkspaceCreationPolicy,
  'workspaceMode' | 'organizationId' | 'billedAccountUserId'
>

type ForkStorageHeadroomParams =
  | { targetWorkspaceId: string; bytes: number }
  | {
      plannedWorkspaceId: string
      creationPolicy: ForkCreationPayerPolicy
      bytes: number
    }

/** Read the organization-only custom storage limit from subscription metadata. */
function readCustomStorageLimitGB(metadata: unknown): number | null {
  if (!isRecordLike(metadata)) return null
  const value = metadata.customStorageLimitGB
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Resolve the payer selected by a not-yet-created workspace's trusted creation policy.
 * The planned id is the same id the fork transaction will insert, so this context has
 * the same shape as one resolved from an existing workspace without consulting the actor.
 */
async function resolvePlannedWorkspaceStorageContext(
  plannedWorkspaceId: string,
  policy: ForkCreationPayerPolicy
): Promise<StorageBillingContext> {
  const subscription = policy.organizationId
    ? await getOrganizationSubscription(policy.organizationId, { onError: 'throw' })
    : await getHighestPriorityPersonalSubscription(policy.billedAccountUserId, {
        onError: 'throw',
      })
  const billingEntity = policy.organizationId
    ? ({ type: 'organization', id: policy.organizationId } as const)
    : ({ type: 'user', id: policy.billedAccountUserId } as const)

  return {
    workspaceId: plannedWorkspaceId,
    billedAccountUserId: policy.billedAccountUserId,
    billingEntity,
    plan: subscription?.plan ?? null,
    customStorageLimitGB:
      billingEntity.type === 'organization'
        ? readCustomStorageLimitGB(subscription?.metadata)
        : null,
  }
}

/**
 * UX-only preflight against the workspace that will receive the copied bytes. Sync
 * resolves the actual target workspace payer; fork creation derives the future payer
 * from the already-authorized creation policy. The actor is deliberately not accepted.
 * Authoritative quota admission still occurs in each metadata/accounting transaction.
 */
export async function assertForkStorageHeadroom(params: ForkStorageHeadroomParams): Promise<void> {
  const { bytes } = params
  if (bytes <= 0) return
  const context =
    'targetWorkspaceId' in params
      ? await resolveStorageBillingContext(params.targetWorkspaceId)
      : await resolvePlannedWorkspaceStorageContext(
          params.plannedWorkspaceId,
          params.creationPolicy
        )
  const quota = await checkStorageQuotaForBillingContext(context, bytes)
  if (quota.allowed) return
  throw new ForkError(
    `Not enough storage to copy the selected resources. ${quota.error ?? 'Storage limit exceeded'}`,
    413
  )
}
