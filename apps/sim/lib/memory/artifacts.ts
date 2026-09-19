import { dbFor } from '@sim/db'
import { executionLargeValues, memory, memoryArtifact } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  collectLargeValueReferenceKeys,
  registerLargeValueOwner,
} from '@/lib/execution/payloads/large-value-metadata'
import { isLargeValueRef, type LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'
import { stringifyBoundedMemoryJson } from '@/lib/memory/bounded-json'

export const MAX_MEMORY_ARTIFACT_BYTES = 8 * 1024 * 1024
export const MAX_MEMORY_ARTIFACT_STORED_BYTES = MAX_MEMORY_ARTIFACT_BYTES * 2 + 1024
const MEMORY_ARTIFACT_PREVIEW = 'Tool result retained in encrypted conversation storage.'

export interface MemoryArtifactScope {
  workspaceId: string
  memoryId: string
}

export interface StoreMemoryArtifactInput extends MemoryArtifactScope {
  workflowId: string
  executionId: string
  attributedUserId: string
  value: unknown
}

export interface ReadMemoryArtifactInput extends MemoryArtifactScope {
  ref: LargeValueRef
}

export interface StoredMemoryArtifact {
  ref: LargeValueRef
  preview: string
}

/** Resolves only an artifact owned by the original active conversation in this workspace. */
export async function readMemoryArtifactByHandle(
  input: MemoryArtifactScope & { artifactId: string }
): Promise<unknown> {
  if (!/^[a-f0-9]{64}$/.test(input.artifactId)) return undefined
  const [owner] = await dbFor('exec')
    .select({ key: memoryArtifact.key })
    .from(memoryArtifact)
    .innerJoin(memory, eq(memory.id, memoryArtifact.memoryId))
    .where(
      and(
        activeMemoryPredicate(input),
        eq(sql`encode(sha256(convert_to(${memoryArtifact.key}, 'UTF8')), 'hex')`, input.artifactId)
      )
    )
    .limit(1)
  const id = owner?.key.match(/\/large-value-(lv_[A-Za-z0-9_-]{12})\.json$/)?.[1]
  if (!id) return undefined
  return readMemoryArtifact({
    ...input,
    ref: { __simLargeValueRef: true, version: 1, id, kind: 'object', size: 1, key: owner.key },
  })
}

function activeMemoryPredicate(scope: MemoryArtifactScope) {
  return and(
    eq(memory.id, scope.memoryId),
    eq(memory.workspaceId, scope.workspaceId),
    isNull(memory.deletedAt)
  )
}

/** Called by the authorized memory use case; payload caches and storage only receive ciphertext. */
export async function storeMemoryArtifact(
  input: StoreMemoryArtifactInput
): Promise<StoredMemoryArtifact | undefined> {
  const json = stringifyBoundedMemoryJson(input.value, MAX_MEMORY_ARTIFACT_BYTES)
  if (json === undefined) return undefined
  const execDb = dbFor('exec')
  const [conversation] = await execDb
    .select({ id: memory.id })
    .from(memory)
    .where(activeMemoryPredicate(input))
    .limit(1)
  if (!conversation) return undefined

  const referencedKeys = collectLargeValueReferenceKeys(input.value, input.workspaceId)
  const envelope = { version: 1, encrypted: (await encryptSecret(json)).encrypted }
  const encoded = JSON.stringify(envelope)
  const size = Buffer.byteLength(encoded, 'utf8')
  if (size > MAX_MEMORY_ARTIFACT_STORED_BYTES) return undefined
  const ref = await storeLargeValue(envelope, encoded, size, {
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    executionId: input.executionId,
    userId: input.attributedUserId,
    requireDurable: true,
  })
  if (!ref.key) return undefined
  if (referencedKeys.length > 0) {
    await registerLargeValueOwner(
      {
        key: ref.key,
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        executionId: input.executionId,
        size,
      },
      referencedKeys
    )
  }

  const key = ref.key
  const attached = await execDb.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: memory.id })
      .from(memory)
      .where(activeMemoryPredicate(input))
      .for('update')
      .limit(1)
    if (!current) return false
    await tx.insert(memoryArtifact).values({ memoryId: current.id, key }).onConflictDoNothing()
    return true
  })
  if (!attached) return undefined
  return { ref: { ...ref, preview: MEMORY_ARTIFACT_PREVIEW }, preview: MEMORY_ARTIFACT_PREVIEW }
}

/** Reads one owned artifact with canonical metadata and a bounded download before decrypting. */
export async function readMemoryArtifact(input: ReadMemoryArtifactInput): Promise<unknown> {
  if (!isLargeValueRef(input.ref) || !input.ref.key) return undefined
  const [owner] = await dbFor('exec')
    .select({
      key: executionLargeValues.key,
      size: executionLargeValues.size,
      workflowId: executionLargeValues.workflowId,
      executionId: executionLargeValues.ownerExecutionId,
    })
    .from(memoryArtifact)
    .innerJoin(memory, eq(memory.id, memoryArtifact.memoryId))
    .innerJoin(executionLargeValues, eq(executionLargeValues.key, memoryArtifact.key))
    .where(
      and(
        activeMemoryPredicate(input),
        eq(memoryArtifact.key, input.ref.key),
        eq(executionLargeValues.workspaceId, input.workspaceId),
        isNull(executionLargeValues.deletedAt)
      )
    )
    .limit(1)
  if (!owner || owner.size <= 0 || owner.size > MAX_MEMORY_ARTIFACT_STORED_BYTES) return undefined
  const parts = owner.key.split('/')
  if (
    parts.length !== 5 ||
    parts[0] !== 'execution' ||
    parts[1] !== input.workspaceId ||
    !parts[2] ||
    (owner.workflowId !== null && parts[2] !== owner.workflowId) ||
    parts[3] !== owner.executionId
  ) {
    return undefined
  }

  const envelope = await materializeLargeValueRef(
    { ...input.ref, key: owner.key, size: owner.size, executionId: owner.executionId },
    {
      workspaceId: input.workspaceId,
      workflowId: parts[2],
      executionId: owner.executionId,
      maxBytes: MAX_MEMORY_ARTIFACT_STORED_BYTES,
      trackReference: false,
    }
  )
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    !('version' in envelope) ||
    envelope.version !== 1 ||
    !('encrypted' in envelope) ||
    typeof envelope.encrypted !== 'string' ||
    Buffer.byteLength(envelope.encrypted, 'utf8') > MAX_MEMORY_ARTIFACT_STORED_BYTES
  ) {
    return undefined
  }
  try {
    const { decrypted } = await decryptSecret(envelope.encrypted, { logFailure: false })
    if (Buffer.byteLength(decrypted, 'utf8') > MAX_MEMORY_ARTIFACT_BYTES) return undefined
    const value: unknown = JSON.parse(decrypted)
    return stringifyBoundedMemoryJson(value, MAX_MEMORY_ARTIFACT_BYTES) === undefined
      ? undefined
      : value
  } catch {
    return undefined
  }
}
