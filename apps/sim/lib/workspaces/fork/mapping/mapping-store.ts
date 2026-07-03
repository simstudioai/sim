import { workspaceForkResourceMap } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { forkResourceTypeSchema } from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'
import type {
  ForkReferenceResolver,
  ForkRemapKind,
} from '@/lib/workspaces/fork/remap/remap-references'

/** Mapping rows per insert; each row binds ~8 params, keeping well under PG's limit. */
const MAPPING_INSERT_CHUNK = 1000

/** Derived from the wire contract so the DB enum, Zod schema, and TS type stay in lockstep. */
export type ForkResourceType = z.infer<typeof forkResourceTypeSchema>

export interface ForkMappingRow {
  id: string
  childWorkspaceId: string
  resourceType: ForkResourceType
  parentResourceId: string
  childResourceId: string | null
}

export interface ForkMappingUpsert {
  resourceType: ForkResourceType
  parentResourceId: string
  childResourceId: string | null
}

const RESOURCE_TYPE_TO_FORK_KIND: Record<ForkResourceType, ForkRemapKind | null> = {
  workflow: null,
  oauth_credential: 'credential',
  service_account_credential: 'credential',
  env_var: 'env-var',
  table: 'table',
  knowledge_base: 'knowledge-base',
  knowledge_document: 'knowledge-document',
  file: 'file',
  mcp_server: 'mcp-server',
  custom_tool: 'custom-tool',
  skill: 'skill',
}

/** The remapper kind a stored resource type participates in, or null when it does not remap. */
export function resourceTypeToForkKind(resourceType: ForkResourceType): ForkRemapKind | null {
  return RESOURCE_TYPE_TO_FORK_KIND[resourceType]
}

// `as const satisfies` (not a `Record<K, V>` annotation) so each key keeps its precise literal
// value type - the generic accessor below then narrows its return per input kind (a uniform
// Record value type would collapse every key to the full value union).
const NON_CREDENTIAL_FORK_KIND_TO_RESOURCE_TYPE = {
  'env-var': 'env_var',
  table: 'table',
  'knowledge-base': 'knowledge_base',
  'knowledge-document': 'knowledge_document',
  file: 'file',
  'mcp-server': 'mcp_server',
  'custom-tool': 'custom_tool',
  skill: 'skill',
} as const satisfies Record<
  Exclude<ForkRemapKind, 'credential'>,
  Exclude<ForkResourceType, 'workflow'>
>

/**
 * Stored resource type for a non-credential remap kind. Credentials are resolved
 * separately via `classifyCredentialResourceType` since the type (oauth vs
 * service account) depends on the credential row.
 */
export function nonCredentialForkKindToResourceType<K extends Exclude<ForkRemapKind, 'credential'>>(
  kind: K
): (typeof NON_CREDENTIAL_FORK_KIND_TO_RESOURCE_TYPE)[K] {
  return NON_CREDENTIAL_FORK_KIND_TO_RESOURCE_TYPE[kind]
}

export async function getEdgeMappingRows(
  executor: DbOrTx,
  childWorkspaceId: string
): Promise<ForkMappingRow[]> {
  const rows = await executor
    .select({
      id: workspaceForkResourceMap.id,
      childWorkspaceId: workspaceForkResourceMap.childWorkspaceId,
      resourceType: workspaceForkResourceMap.resourceType,
      parentResourceId: workspaceForkResourceMap.parentResourceId,
      childResourceId: workspaceForkResourceMap.childResourceId,
    })
    .from(workspaceForkResourceMap)
    .where(eq(workspaceForkResourceMap.childWorkspaceId, childWorkspaceId))
    // Deterministic order so resolver/identity construction is stable if duplicates
    // ever exist (the push edit + rollback cleanup prevent them, this is defense).
    .orderBy(asc(workspaceForkResourceMap.createdAt), asc(workspaceForkResourceMap.id))
  return rows as ForkMappingRow[]
}

/**
 * Delete workflow-identity mapping rows by the ids on one side (parent or child).
 * Used by rollback to dissolve the identity rows a promote created, so a later
 * re-promote of the same source converges instead of leaking a second row.
 */
export async function deleteWorkflowIdentityByIds(
  tx: DbOrTx,
  childWorkspaceId: string,
  side: 'parent' | 'child',
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return
  const sideColumn =
    side === 'parent'
      ? workspaceForkResourceMap.parentResourceId
      : workspaceForkResourceMap.childResourceId
  await tx
    .delete(workspaceForkResourceMap)
    .where(
      and(
        eq(workspaceForkResourceMap.childWorkspaceId, childWorkspaceId),
        eq(workspaceForkResourceMap.resourceType, 'workflow'),
        inArray(sideColumn, ids)
      )
    )
}

/**
 * Insert mapping rows that don't already exist (used at fork time to seed every
 * detected reference as unmapped). Existing rows are left untouched.
 */
export async function seedEdgeMappings(
  tx: DbOrTx,
  childWorkspaceId: string,
  userId: string,
  entries: ForkMappingUpsert[]
): Promise<void> {
  if (entries.length === 0) return
  const now = new Date()
  // Chunked so a fork copying many resources stays well under the Postgres bind
  // parameter limit (each row binds ~8 params).
  for (let i = 0; i < entries.length; i += MAPPING_INSERT_CHUNK) {
    const batch = entries.slice(i, i + MAPPING_INSERT_CHUNK)
    await tx
      .insert(workspaceForkResourceMap)
      .values(
        batch.map((entry) => ({
          id: generateId(),
          childWorkspaceId,
          resourceType: entry.resourceType,
          parentResourceId: entry.parentResourceId,
          childResourceId: entry.childResourceId,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing({
        target: [
          workspaceForkResourceMap.childWorkspaceId,
          workspaceForkResourceMap.resourceType,
          workspaceForkResourceMap.parentResourceId,
        ],
      })
  }
}

/**
 * Insert or update mapping rows in batched, chunked multi-row upserts, setting
 * `childResourceId` (the chosen target) from the incoming row. Used when a user
 * saves a mapping and to persist promote identity rows - one query per chunk
 * instead of one per row, so a large save stays a short transaction.
 *
 * Entries are deduped by the conflict key (resourceType, parentResourceId), keeping
 * the last (matching the prior per-row last-write-wins) so a batch can never trip
 * Postgres's "ON CONFLICT DO UPDATE cannot affect row a second time".
 */
export async function upsertEdgeMappings(
  tx: DbOrTx,
  childWorkspaceId: string,
  userId: string,
  entries: ForkMappingUpsert[]
): Promise<void> {
  if (entries.length === 0) return
  const now = new Date()
  const byConflictKey = new Map<string, ForkMappingUpsert>()
  for (const entry of entries) {
    byConflictKey.set(`${entry.resourceType}:${entry.parentResourceId}`, entry)
  }
  const deduped = Array.from(byConflictKey.values())
  for (let i = 0; i < deduped.length; i += MAPPING_INSERT_CHUNK) {
    const batch = deduped.slice(i, i + MAPPING_INSERT_CHUNK)
    await tx
      .insert(workspaceForkResourceMap)
      .values(
        batch.map((entry) => ({
          id: generateId(),
          childWorkspaceId,
          resourceType: entry.resourceType,
          parentResourceId: entry.parentResourceId,
          childResourceId: entry.childResourceId,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: [
          workspaceForkResourceMap.childWorkspaceId,
          workspaceForkResourceMap.resourceType,
          workspaceForkResourceMap.parentResourceId,
        ],
        set: { childResourceId: sql`excluded.child_resource_id`, updatedAt: now },
      })
  }
}

/**
 * Remove mapping rows matched by their child-side (source) resource id, grouped by
 * resource type into a single OR-of-INs - one query for the whole push save (the
 * unique key is on the parent side, so a changed push target must drop the old
 * (parent, source) row before the new one is inserted).
 */
export async function deleteEdgeMappingsByChildResources(
  tx: DbOrTx,
  childWorkspaceId: string,
  pairs: Array<{ resourceType: ForkResourceType; childResourceId: string }>
): Promise<void> {
  if (pairs.length === 0) return
  const idsByType = new Map<ForkResourceType, string[]>()
  for (const { resourceType, childResourceId } of pairs) {
    const list = idsByType.get(resourceType)
    if (list) list.push(childResourceId)
    else idsByType.set(resourceType, [childResourceId])
  }
  const conditions = Array.from(idsByType, ([resourceType, ids]) =>
    and(
      eq(workspaceForkResourceMap.resourceType, resourceType),
      inArray(workspaceForkResourceMap.childResourceId, ids)
    )
  )
  await tx
    .delete(workspaceForkResourceMap)
    .where(and(eq(workspaceForkResourceMap.childWorkspaceId, childWorkspaceId), or(...conditions)))
}

export interface BuildForkResolverOptions {
  /** When the source side of the promote is the parent workspace (a pull). */
  sourceIsParent: boolean
  /**
   * Env keys present in the target workspace. A workspace-secret env reference with
   * no explicit mapping resolves to itself when the same key exists in the target.
   */
  targetEnvKeys?: Set<string>
  /**
   * Env keys defined at the SOURCE workspace level. Only these are workspace secrets
   * that can be mapped; any other `{{KEY}}` is a personal (user-scoped) secret that
   * resolves identically in any workspace and is left as-is (never mapped/required).
   */
  sourceEnvKeys?: Set<string>
  /**
   * Target ids that still EXIST in the target workspace, per kind, among the mapped
   * targets. When a kind is present, a mapped target NOT in its set is treated as
   * unmapped (the target was deleted after the mapping was saved), so a dead id is
   * never written into the promoted workflow. Kinds absent here are not existence-
   * checked (resolved as before).
   */
  validTargetIdsByKind?: Partial<Record<ForkRemapKind, Set<string>>>
}

/**
 * Build a reference resolver from persisted mapping rows for the chosen
 * direction. Translates a source-space resource id to its mapped target id;
 * rows whose `childResourceId` is null (unmapped) are skipped. Env keys fall
 * back to an identity mapping when the target workspace already has the key.
 */
export function buildForkResolver(
  rows: ForkMappingRow[],
  options: BuildForkResolverOptions
): ForkReferenceResolver {
  const index = new Map<ForkRemapKind, Map<string, string>>()
  for (const row of rows) {
    const kind = resourceTypeToForkKind(row.resourceType)
    if (!kind) continue
    if (row.childResourceId == null) continue
    const sourceId = options.sourceIsParent ? row.parentResourceId : row.childResourceId
    const targetId = options.sourceIsParent ? row.childResourceId : row.parentResourceId
    let kindIndex = index.get(kind)
    if (!kindIndex) {
      kindIndex = new Map()
      index.set(kind, kindIndex)
    }
    kindIndex.set(sourceId, targetId)
  }

  return (kind, sourceId) => {
    const mapped = index.get(kind)?.get(sourceId)
    if (mapped != null) {
      const validSet = options.validTargetIdsByKind?.[kind]
      if (!validSet || validSet.has(mapped)) return mapped
      // The mapped target was deleted from the target workspace after the mapping was
      // saved. Fall through so the reference resolves as unmapped (surfaced as required
      // / cleared if optional) instead of writing a dead id into the promoted workflow.
    }
    if (kind === 'env-var') {
      // Personal/global env vars (not a source workspace secret) are user-scoped and
      // resolve identically in any workspace - leave them as-is, never map them.
      if (options.sourceEnvKeys && !options.sourceEnvKeys.has(sourceId)) return sourceId
      // Workspace secret already present in the target by the same name → identity.
      if (options.targetEnvKeys?.has(sourceId)) return sourceId
    }
    return null
  }
}
