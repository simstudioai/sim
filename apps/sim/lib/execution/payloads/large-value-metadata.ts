import { db } from '@sim/db'
import {
  executionLargeValueDependencies,
  executionLargeValueReferences,
  executionLargeValues,
  pausedExecutions,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { chunkArray } from '@/lib/cleanup/batch-delete'
import { collectLargeValueKeys } from '@/lib/execution/payloads/large-execution-value'

const logger = createLogger('LargeValueMetadata')

type LargeValueMetadataClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export const MAX_LARGE_VALUE_REFERENCES_PER_SCOPE = 5_000
const LARGE_VALUE_METADATA_WRITE_CHUNK_SIZE = 500
const LARGE_VALUE_METADATA_WORKSPACE_CHUNK_SIZE = 50
const LARGE_VALUE_METADATA_PRUNE_BATCH_SIZE = 1_000
const LARGE_VALUE_METADATA_PRUNE_MAX_ROWS_PER_TABLE = 5_000
export const LIVE_PAUSED_REFERENCE_STATUSES = ['paused', 'partially_resumed', 'cancelling'] as const

export interface LargeValueOwner {
  key: string
  workspaceId: string
  workflowId: string
  executionId: string
  size: number
}

export interface LargeValueReferenceScope {
  workspaceId?: string
  workflowId?: string | null
  executionId?: string
  source: 'execution_log' | 'paused_snapshot'
}

interface LargeValueStorageKeyParts {
  workspaceId: string
  workflowId: string
  executionId: string
}

export interface LargeValueMetadataPruneResult {
  referencesDeleted: number
  dependenciesDeleted: number
  tombstonesDeleted: number
}

interface PruneLargeValueMetadataOptions {
  workspaceIds: string[]
  tombstonesDeletedBefore: Date
  batchSize?: number
  maxRowsPerTable?: number
}

function parseLargeValueStorageKey(key: string): LargeValueStorageKeyParts | null {
  const parts = key.split('/')
  if (
    parts.length !== 5 ||
    parts[0] !== 'execution' ||
    !parts[1] ||
    !parts[2] ||
    !parts[3] ||
    !/^large-value-lv_[A-Za-z0-9_-]{12}\.json$/.test(parts[4])
  ) {
    return null
  }

  return {
    workspaceId: parts[1],
    workflowId: parts[2],
    executionId: parts[3],
  }
}

function getBoundedUniqueKeys(keys: string[], label: string): string[] {
  const uniqueKeys = Array.from(new Set(keys))
  if (uniqueKeys.length > MAX_LARGE_VALUE_REFERENCES_PER_SCOPE) {
    throw new Error(
      `${label} contains ${uniqueKeys.length} large value references, exceeding the limit of ${MAX_LARGE_VALUE_REFERENCES_PER_SCOPE}`
    )
  }
  return uniqueKeys
}

function getCount(rows: unknown): number {
  const [row] = Array.isArray(rows) ? rows : []
  if (!row || typeof row !== 'object' || !('count' in row)) {
    return 0
  }
  return Number((row as { count: unknown }).count) || 0
}

export function collectLargeValueReferenceKeys(value: unknown, workspaceId?: string): string[] {
  return getBoundedUniqueKeys(
    collectLargeValueKeys(value).filter((key) => {
      const parsed = parseLargeValueStorageKey(key)
      return workspaceId ? parsed?.workspaceId === workspaceId : Boolean(parsed)
    }),
    'Large value reference set'
  )
}

async function getDependencyClosure(
  client: LargeValueMetadataClient,
  ownerKey: string,
  workspaceId: string,
  referencedKeys: string[]
): Promise<string[]> {
  const directKeys = getBoundedUniqueKeys(
    referencedKeys.filter((key) => {
      const parsed = parseLargeValueStorageKey(key)
      return parsed?.workspaceId === workspaceId && key !== ownerKey
    }),
    'Large value dependency set'
  )

  if (directKeys.length === 0) {
    return []
  }

  const closureKeys = new Set(directKeys)
  let frontier = directKeys

  while (frontier.length > 0) {
    const nextFrontier: string[] = []

    for (const keyChunk of chunkArray(frontier, LARGE_VALUE_METADATA_WRITE_CHUNK_SIZE)) {
      const remainingBudget = MAX_LARGE_VALUE_REFERENCES_PER_SCOPE - closureKeys.size
      const rows = await client
        .selectDistinct({ childKey: executionLargeValueDependencies.childKey })
        .from(executionLargeValueDependencies)
        .where(
          and(
            eq(executionLargeValueDependencies.workspaceId, workspaceId),
            inArray(executionLargeValueDependencies.parentKey, keyChunk),
            notInArray(executionLargeValueDependencies.childKey, Array.from(closureKeys))
          )
        )
        .limit(remainingBudget + 1)

      for (const row of rows) {
        if (closureKeys.has(row.childKey)) {
          continue
        }
        closureKeys.add(row.childKey)
        nextFrontier.push(row.childKey)
        if (closureKeys.size > MAX_LARGE_VALUE_REFERENCES_PER_SCOPE) {
          throw new Error(
            `Large value dependency closure exceeds the limit of ${MAX_LARGE_VALUE_REFERENCES_PER_SCOPE}`
          )
        }
      }
    }

    frontier = nextFrontier
  }

  return Array.from(closureKeys)
}

export async function registerLargeValueOwner(
  owner: LargeValueOwner,
  referencedKeys: string[] = []
): Promise<boolean> {
  if (!Number.isFinite(owner.size) || owner.size <= 0) {
    return false
  }

  const parsed = parseLargeValueStorageKey(owner.key)
  if (
    !parsed ||
    parsed.workspaceId !== owner.workspaceId ||
    parsed.workflowId !== owner.workflowId ||
    parsed.executionId !== owner.executionId
  ) {
    logger.warn('Skipping large value owner registration for malformed storage key', {
      key: owner.key,
      workspaceId: owner.workspaceId,
      workflowId: owner.workflowId,
      executionId: owner.executionId,
    })
    return false
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(executionLargeValues)
      .values({
        key: owner.key,
        workspaceId: owner.workspaceId,
        workflowId: owner.workflowId,
        ownerExecutionId: owner.executionId,
        size: Math.ceil(owner.size),
      })
      .onConflictDoNothing()

    const dependencyKeys = await getDependencyClosure(
      tx,
      owner.key,
      owner.workspaceId,
      referencedKeys
    )
    if (dependencyKeys.length === 0) {
      return
    }

    for (const keyChunk of chunkArray(dependencyKeys, LARGE_VALUE_METADATA_WRITE_CHUNK_SIZE)) {
      await tx
        .insert(executionLargeValueDependencies)
        .values(
          keyChunk.map((childKey) => ({
            parentKey: owner.key,
            childKey,
            workspaceId: owner.workspaceId,
          }))
        )
        .onConflictDoNothing()
    }
  })

  return true
}

export async function replaceLargeValueReferencesWithClient(
  client: LargeValueMetadataClient,
  scope: LargeValueReferenceScope,
  value: unknown
): Promise<void> {
  if (!scope.workspaceId || !scope.executionId) {
    return
  }

  await replaceLargeValueReferenceKeysWithClient(
    client,
    scope,
    collectLargeValueReferenceKeys(value, scope.workspaceId)
  )
}

export async function replaceLargeValueReferenceKeysWithClient(
  client: LargeValueMetadataClient,
  scope: LargeValueReferenceScope,
  referenceKeys: string[]
): Promise<void> {
  const { workspaceId, workflowId, executionId, source } = scope
  if (!workspaceId || !executionId) {
    return
  }

  const keys = getBoundedUniqueKeys(
    referenceKeys.filter((key) => {
      const parsed = parseLargeValueStorageKey(key)
      return parsed?.workspaceId === workspaceId
    }),
    'Large value reference set'
  )

  await client
    .delete(executionLargeValueReferences)
    .where(
      and(
        eq(executionLargeValueReferences.workspaceId, workspaceId),
        eq(executionLargeValueReferences.executionId, executionId),
        eq(executionLargeValueReferences.source, source)
      )
    )

  if (keys.length === 0) {
    return
  }

  for (const keyChunk of chunkArray(keys, LARGE_VALUE_METADATA_WRITE_CHUNK_SIZE)) {
    await client
      .insert(executionLargeValueReferences)
      .values(
        keyChunk.map((key) => ({
          key,
          workspaceId,
          workflowId: workflowId ?? null,
          executionId,
          source,
        }))
      )
      .onConflictDoNothing()
  }
}

export async function addLargeValueReference(
  scope: LargeValueReferenceScope,
  key: string
): Promise<void> {
  const { workspaceId, workflowId, executionId, source } = scope
  if (!workspaceId || !executionId) {
    return
  }

  const [boundedKey] = getBoundedUniqueKeys(
    [key].filter((candidate) => {
      const parsed = parseLargeValueStorageKey(candidate)
      return parsed?.workspaceId === workspaceId
    }),
    'Large value reference set'
  )
  if (!boundedKey) {
    return
  }

  const [existingRef] = await db
    .select({ key: executionLargeValueReferences.key })
    .from(executionLargeValueReferences)
    .where(
      and(
        eq(executionLargeValueReferences.workspaceId, workspaceId),
        eq(executionLargeValueReferences.executionId, executionId),
        eq(executionLargeValueReferences.source, source),
        eq(executionLargeValueReferences.key, boundedKey)
      )
    )
    .limit(1)

  if (existingRef) {
    return
  }

  const existingRefs = await db
    .select({ key: executionLargeValueReferences.key })
    .from(executionLargeValueReferences)
    .where(
      and(
        eq(executionLargeValueReferences.workspaceId, workspaceId),
        eq(executionLargeValueReferences.executionId, executionId),
        eq(executionLargeValueReferences.source, source)
      )
    )
    .limit(MAX_LARGE_VALUE_REFERENCES_PER_SCOPE + 1)

  if (existingRefs.length >= MAX_LARGE_VALUE_REFERENCES_PER_SCOPE) {
    throw new Error(
      `Large value reference set contains at least ${existingRefs.length} references, exceeding the limit of ${MAX_LARGE_VALUE_REFERENCES_PER_SCOPE}`
    )
  }

  await db
    .insert(executionLargeValueReferences)
    .values({
      key: boundedKey,
      workspaceId,
      workflowId: workflowId ?? null,
      executionId,
      source,
    })
    .onConflictDoNothing()
}

export async function replaceLargeValueReferences(
  scope: LargeValueReferenceScope,
  value: unknown
): Promise<void> {
  const referenceKeys = scope.workspaceId
    ? collectLargeValueReferenceKeys(value, scope.workspaceId)
    : []
  await db.transaction(async (tx) => {
    await replaceLargeValueReferenceKeysWithClient(tx, scope, referenceKeys)
  })
}

export async function markLargeValuesDeleted(keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return
  }

  await db
    .update(executionLargeValues)
    .set({ deletedAt: new Date() })
    .where(inArray(executionLargeValues.key, keys))
}

async function pruneStaleReferences(workspaceIds: string[], batchSize: number): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM ${executionLargeValueReferences} AS ref
      WHERE ref.ctid IN (
        SELECT ref.ctid
        FROM ${executionLargeValueReferences} AS ref
        WHERE ref.workspace_id = ANY(${workspaceIds}::text[])
          AND (
            (
              ref.source = 'execution_log'
              AND NOT EXISTS (
                SELECT 1
                FROM ${workflowExecutionLogs} AS wel
                WHERE wel.execution_id = ref.execution_id
              )
            )
            OR (
              ref.source = 'paused_snapshot'
              AND NOT EXISTS (
                SELECT 1
                FROM ${pausedExecutions} AS pe
                WHERE pe.execution_id = ref.execution_id
                  AND pe.status = ANY(${LIVE_PAUSED_REFERENCE_STATUSES}::text[])
              )
            )
            OR ref.source NOT IN ('execution_log', 'paused_snapshot')
          )
        LIMIT ${batchSize}
      )
      RETURNING ref.key
    )
    SELECT count(*)::int AS count FROM deleted
  `)
  return getCount(rows)
}

async function pruneDeletedParentDependencies(
  workspaceIds: string[],
  batchSize: number
): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM ${executionLargeValueDependencies} AS dependency
      WHERE dependency.ctid IN (
        SELECT dependency.ctid
        FROM ${executionLargeValueDependencies} AS dependency
        WHERE dependency.workspace_id = ANY(${workspaceIds}::text[])
          AND (
            EXISTS (
              SELECT 1
              FROM ${executionLargeValues} AS parent_value
              WHERE parent_value.key = dependency.parent_key
                AND parent_value.deleted_at IS NOT NULL
            )
            OR NOT EXISTS (
              SELECT 1
              FROM ${executionLargeValues} AS parent_value
              WHERE parent_value.key = dependency.parent_key
            )
          )
        LIMIT ${batchSize}
      )
      RETURNING dependency.parent_key
    )
    SELECT count(*)::int AS count FROM deleted
  `)
  return getCount(rows)
}

async function pruneDeletedLargeValueTombstones(
  workspaceIds: string[],
  deletedBefore: Date,
  batchSize: number
): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM ${executionLargeValues} AS value
      WHERE value.ctid IN (
        SELECT value.ctid
        FROM ${executionLargeValues} AS value
        WHERE value.workspace_id = ANY(${workspaceIds}::text[])
          AND value.deleted_at IS NOT NULL
          AND value.deleted_at < ${deletedBefore}
          AND NOT EXISTS (
            SELECT 1
            FROM ${executionLargeValueDependencies} AS dependency
            WHERE dependency.parent_key = value.key
          )
        LIMIT ${batchSize}
      )
      RETURNING value.key
    )
    SELECT count(*)::int AS count FROM deleted
  `)
  return getCount(rows)
}

export async function pruneLargeValueMetadata({
  workspaceIds,
  tombstonesDeletedBefore,
  batchSize = LARGE_VALUE_METADATA_PRUNE_BATCH_SIZE,
  maxRowsPerTable = LARGE_VALUE_METADATA_PRUNE_MAX_ROWS_PER_TABLE,
}: PruneLargeValueMetadataOptions): Promise<LargeValueMetadataPruneResult> {
  const result: LargeValueMetadataPruneResult = {
    referencesDeleted: 0,
    dependenciesDeleted: 0,
    tombstonesDeleted: 0,
  }
  if (workspaceIds.length === 0) return result

  for (const workspaceChunk of chunkArray(
    workspaceIds,
    LARGE_VALUE_METADATA_WORKSPACE_CHUNK_SIZE
  )) {
    const referencesRemaining = maxRowsPerTable - result.referencesDeleted
    if (referencesRemaining > 0) {
      result.referencesDeleted += await pruneStaleReferences(
        workspaceChunk,
        Math.min(batchSize, referencesRemaining)
      )
    }

    const dependenciesRemaining = maxRowsPerTable - result.dependenciesDeleted
    if (dependenciesRemaining > 0) {
      result.dependenciesDeleted += await pruneDeletedParentDependencies(
        workspaceChunk,
        Math.min(batchSize, dependenciesRemaining)
      )
    }

    const tombstonesRemaining = maxRowsPerTable - result.tombstonesDeleted
    if (tombstonesRemaining > 0) {
      result.tombstonesDeleted += await pruneDeletedLargeValueTombstones(
        workspaceChunk,
        tombstonesDeletedBefore,
        Math.min(batchSize, tombstonesRemaining)
      )
    }

    if (
      result.referencesDeleted >= maxRowsPerTable &&
      result.dependenciesDeleted >= maxRowsPerTable &&
      result.tombstonesDeleted >= maxRowsPerTable
    ) {
      break
    }
  }

  return result
}

export function unreferencedLargeValuePredicate() {
  return sql`
    NOT EXISTS (
      SELECT 1
      FROM ${executionLargeValueReferences} AS elvr
      WHERE elvr.key = ${executionLargeValues.key}
        AND (
          (
            elvr.source = 'execution_log'
            AND EXISTS (
              SELECT 1
              FROM ${workflowExecutionLogs} AS wel
              WHERE wel.execution_id = elvr.execution_id
            )
          )
          OR (
            elvr.source = 'paused_snapshot'
            AND EXISTS (
              SELECT 1
              FROM ${pausedExecutions} AS pe
              WHERE pe.execution_id = elvr.execution_id
                AND pe.status = ANY(${LIVE_PAUSED_REFERENCE_STATUSES}::text[])
            )
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ${workflowExecutionLogs} AS owner_wel
      WHERE owner_wel.execution_id = ${executionLargeValues.ownerExecutionId}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ${pausedExecutions} AS owner_pe
      WHERE owner_pe.execution_id = ${executionLargeValues.ownerExecutionId}
        AND owner_pe.status = ANY(${LIVE_PAUSED_REFERENCE_STATUSES}::text[])
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ${executionLargeValueDependencies} AS dependency
      INNER JOIN ${executionLargeValues} AS parent_value
        ON parent_value.key = dependency.parent_key
       AND parent_value.deleted_at IS NULL
      WHERE dependency.workspace_id = ${executionLargeValues.workspaceId}
        AND dependency.child_key = ${executionLargeValues.key}
        AND (
          EXISTS (
            SELECT 1
            FROM ${workflowExecutionLogs} AS parent_owner_wel
            WHERE parent_owner_wel.execution_id = parent_value.owner_execution_id
          )
          OR EXISTS (
            SELECT 1
            FROM ${pausedExecutions} AS parent_owner_pe
            WHERE parent_owner_pe.execution_id = parent_value.owner_execution_id
              AND parent_owner_pe.status = ANY(${LIVE_PAUSED_REFERENCE_STATUSES}::text[])
          )
          OR EXISTS (
            SELECT 1
            FROM ${executionLargeValueReferences} AS parent_ref
            WHERE parent_ref.key = parent_value.key
              AND (
                (
                  parent_ref.source = 'execution_log'
                  AND EXISTS (
                    SELECT 1
                    FROM ${workflowExecutionLogs} AS parent_ref_wel
                    WHERE parent_ref_wel.execution_id = parent_ref.execution_id
                  )
                )
                OR (
                  parent_ref.source = 'paused_snapshot'
                  AND EXISTS (
                    SELECT 1
                    FROM ${pausedExecutions} AS parent_ref_pe
                    WHERE parent_ref_pe.execution_id = parent_ref.execution_id
                      AND parent_ref_pe.status = ANY(${LIVE_PAUSED_REFERENCE_STATUSES}::text[])
                  )
                )
              )
          )
        )
    )
  `
}
