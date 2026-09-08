import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalSubject,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { memory, memorySecretProvenance } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { assertBillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type DurableSecretProvenance,
  mergeDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import {
  isDurableSecretProvenanceEnforced,
  reportUnrecordedDurableProvenance,
} from '@/lib/execution/durable-secret-provenance-enforcement'
import { memoryDelegationPolicy } from '@/lib/memory/application/authorization'
import { memoryOperations } from '@/lib/memory/application/operations'
import { lockMemoryConversationInTx } from '@/lib/memory/locks'
import {
  bindMemorySecretProvenanceToMessages,
  readBoundMemorySecretProvenance,
  replaceMemorySecretProvenanceInTx,
} from '@/lib/memory/secret-provenance'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const PRIVATE_MEMORY_QUERY_CHUNK_SIZE = 1_000
const MAX_MEMORY_LIST_LIMIT = 1_000

export interface MemoryRecord {
  id: string
  key: string
  data: unknown
  secretProvenanceVersion: number | null
}

export interface MemoryReadProvenance {
  data: unknown
  provenance: DurableSecretProvenance
}

interface WorkspaceInput {
  workspaceId: string
}

export interface MemoryLegacyProvenanceScope {
  userId: string
  workspaceId: string
}

interface ReadProvenanceInput {
  includePersistedSecretProvenance?: boolean
  resolveBillingAttribution?: (workspaceId: string) => Promise<BillingAttributionSnapshot>
  signal?: AbortSignal
}

async function resolveMemoryLegacyProvenanceScope(
  principal: Principal,
  workspaceId: string,
  resolveBillingAttribution?: ReadProvenanceInput['resolveBillingAttribution']
): Promise<MemoryLegacyProvenanceScope> {
  const subject = resolvePrincipalSubject(principal)
  if (subject?.kind === 'sim_user') return { userId: subject.userId, workspaceId }

  const billingAttribution = resolveBillingAttribution
    ? assertBillingAttributionSnapshot(await resolveBillingAttribution(workspaceId))
    : undefined
  if (billingAttribution && billingAttribution.workspaceId !== workspaceId) {
    throw new Error('Memory billing attribution does not match its canonical workspace')
  }
  const { attributedUserId } = resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: billingAttribution?.billedAccountUserId,
  })
  return { userId: attributedUserId, workspaceId }
}

function memoryMessageError(data: unknown): string | null {
  const messages = Array.isArray(data) ? data : [data]
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      return 'Memory requires messages with role and content'
    }
    const role = 'role' in message ? message.role : undefined
    if (role && !['user', 'assistant', 'system'].includes(String(role))) {
      return 'Message role must be user, assistant, or system'
    }
    if (!role || !('content' in message) || !message.content) {
      return 'Memory requires messages with role and content'
    }
  }
  return null
}

async function loadReadProvenance(
  records: MemoryRecord[],
  scope: MemoryLegacyProvenanceScope,
  signal?: AbortSignal
): Promise<MemoryReadProvenance[]> {
  if (records.length === 0) return []

  const recordsById = new Map<string, MemoryRecord[]>()
  for (const record of records) {
    const matching = recordsById.get(record.id) ?? []
    matching.push(record)
    recordsById.set(record.id, matching)
  }

  const result: MemoryReadProvenance[] = []
  const ids = [...recordsById.keys()]
  const enforced = isDurableSecretProvenanceEnforced('memory')
  let unrecordedCount = 0

  for (let index = 0; index < ids.length; index += PRIVATE_MEMORY_QUERY_CHUNK_SIZE) {
    signal?.throwIfAborted()
    const pageIds = ids.slice(index, index + PRIVATE_MEMORY_QUERY_CHUNK_SIZE)
    const sidecars = await db
      .select()
      .from(memorySecretProvenance)
      .where(inArray(memorySecretProvenance.memoryId, pageIds))
    const sidecarById = new Map(sidecars.map((sidecar) => [sidecar.memoryId, sidecar]))

    for (const memoryId of pageIds) {
      for (const record of recordsById.get(memoryId) ?? []) {
        const sidecar = sidecarById.get(memoryId)
        const provenance = readBoundMemorySecretProvenance({
          secretProvenanceVersion: record.secretProvenanceVersion,
          data: record.data,
          provenanceContentHash: sidecar?.contentHash ?? null,
          status: sidecar?.status ?? null,
          entries: sidecar?.entries,
        })
        if (provenance.status === 'unknown' && !enforced) unrecordedCount += 1
        result.push({ data: record.data, provenance })
      }
    }
  }

  if (unrecordedCount > 0) {
    reportUnrecordedDurableProvenance({
      surface: 'memory',
      cause: 'durable-provenance-unknown',
      affectedCount: unrecordedCount,
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
    })
  }

  return result
}

async function readResultProvenance(
  records: MemoryRecord[],
  principal: Principal,
  workspaceId: string,
  input: ReadProvenanceInput,
  existingScope?: MemoryLegacyProvenanceScope
): Promise<{
  readProvenance?: MemoryReadProvenance[]
  provenanceScope?: MemoryLegacyProvenanceScope
}> {
  if (!input.includePersistedSecretProvenance) return {}
  const provenanceScope =
    existingScope ??
    (await resolveMemoryLegacyProvenanceScope(
      principal,
      workspaceId,
      input.resolveBillingAttribution
    ))
  return {
    readProvenance: await loadReadProvenance(records, provenanceScope, input.signal),
    provenanceScope,
  }
}

export interface ListMemoriesInput extends WorkspaceInput, ReadProvenanceInput {
  query?: string | null
  limit: number
}

export const listMemoriesUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.list,
  resolveContext: ({ input }: { input: ListMemoriesInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ principal, input, context }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_MEMORY_LIST_LIMIT) {
      throw new OrchestrationError('validation', 'Invalid memory list limit')
    }
    input.signal?.throwIfAborted()
    const conditions = [isNull(memory.deletedAt), eq(memory.workspaceId, context.workspaceId)]
    if (input.query) conditions.push(like(memory.key, `%${input.query}%`))
    const records = await db
      .select()
      .from(memory)
      .where(and(...conditions))
      .orderBy(memory.createdAt)
      .limit(input.limit)
    input.signal?.throwIfAborted()
    const provenance = await readResultProvenance(records, principal, context.workspaceId, input)
    return {
      records,
      ...provenance,
    }
  },
})

export interface ReadMemoryInput extends WorkspaceInput, ReadProvenanceInput {
  key: string
}

export const readMemoryUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.read,
  resolveContext: ({ input }: { input: ReadMemoryInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ principal, input, context }) {
    input.signal?.throwIfAborted()
    const records = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.key, input.key),
          eq(memory.workspaceId, context.workspaceId),
          isNull(memory.deletedAt)
        )
      )
      .orderBy(memory.createdAt)
      .limit(1)
    input.signal?.throwIfAborted()
    const provenance = await readResultProvenance(records, principal, context.workspaceId, input)
    return {
      record: records[0] ?? null,
      ...provenance,
    }
  },
})

export interface AppendMemoryInput extends WorkspaceInput, ReadProvenanceInput {
  key: string
  data: unknown
  writeProvenance?: DurableSecretProvenance
  resolveWriteProvenance?: (
    scope: MemoryLegacyProvenanceScope
  ) => DurableSecretProvenance | undefined
}

export const appendMemoryUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.append,
  resolveContext: ({ input }: { input: AppendMemoryInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ principal, input, context }) {
    if (!input.key) throw new OrchestrationError('validation', 'Memory key is required')
    if (!input.data) throw new OrchestrationError('validation', 'Memory data is required')
    const messageError = memoryMessageError(input.data)
    if (messageError) throw new OrchestrationError('validation', messageError)

    input.signal?.throwIfAborted()
    const provenanceScope = input.resolveWriteProvenance
      ? await resolveMemoryLegacyProvenanceScope(
          principal,
          context.workspaceId,
          input.resolveBillingAttribution
        )
      : undefined
    const incomingProvenance =
      input.resolveWriteProvenance && provenanceScope
        ? input.resolveWriteProvenance(provenanceScope)
        : input.writeProvenance
    const initialData = Array.isArray(input.data) ? input.data : [input.data]
    const writeProvenance = incomingProvenance
      ? await bindMemorySecretProvenanceToMessages(initialData, incomingProvenance)
      : undefined
    const now = new Date()
    const id = `mem_${generateId().replace(/-/g, '')}`

    try {
      await db.transaction(async (tx) => {
        await lockMemoryConversationInTx(tx, context.workspaceId, input.key)
        const [existing] = await tx
          .select({
            id: memory.id,
            data: memory.data,
            secretProvenanceVersion: memory.secretProvenanceVersion,
          })
          .from(memory)
          .where(and(eq(memory.workspaceId, context.workspaceId), eq(memory.key, input.key)))
          .limit(1)
          .for('update')

        let previousProvenance: DurableSecretProvenance | undefined
        if (existing && writeProvenance) {
          const [sidecar] = await tx
            .select()
            .from(memorySecretProvenance)
            .where(eq(memorySecretProvenance.memoryId, existing.id))
            .limit(1)
          previousProvenance = readBoundMemorySecretProvenance({
            secretProvenanceVersion: existing.secretProvenanceVersion,
            data: existing.data,
            provenanceContentHash: sidecar?.contentHash ?? null,
            status: sidecar?.status ?? null,
            entries: sidecar?.entries,
          })
        }

        const [written] = await tx
          .insert(memory)
          .values({
            id,
            workspaceId: context.workspaceId,
            key: input.key,
            data: initialData,
            secretProvenanceVersion: writeProvenance ? 1 : null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [memory.workspaceId, memory.key],
            set: {
              data: sql`${memory.data} || ${JSON.stringify(initialData)}::jsonb`,
              secretProvenanceVersion: writeProvenance
                ? 1
                : (existing?.secretProvenanceVersion ?? null),
              updatedAt: now,
            },
          })
          .returning({ id: memory.id, data: memory.data })

        if (writeProvenance) {
          const nextProvenance = previousProvenance
            ? mergeDurableSecretProvenance(previousProvenance, writeProvenance)
            : writeProvenance
          await replaceMemorySecretProvenanceInTx(
            tx,
            written.id,
            written.data,
            nextProvenance,
            previousProvenance?.status === 'unknown'
              ? 'inherited-provenance-unknown'
              : writeProvenance.status === 'exact' && nextProvenance.status === 'unknown'
                ? 'merge-provenance-limit'
                : undefined
          )
        }
      })
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        throw new OrchestrationError('conflict', 'Memory with this key already exists')
      }
      throw error
    }

    input.signal?.throwIfAborted()
    const records = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.key, input.key),
          eq(memory.workspaceId, context.workspaceId),
          isNull(memory.deletedAt)
        )
      )
      .orderBy(memory.createdAt)
      .limit(1)
    const record = records[0]
    if (!record) throw new Error('Failed to retrieve memory after creation/update')
    input.signal?.throwIfAborted()
    const provenance = await readResultProvenance(
      records,
      principal,
      context.workspaceId,
      input,
      provenanceScope
    )
    return {
      record,
      ...provenance,
    }
  },
})

export interface DeleteMemoryInput extends WorkspaceInput {
  key: string
  signal?: AbortSignal
}

export const deleteMemoryUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.delete,
  resolveContext: ({ input }: { input: DeleteMemoryInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ input, context }) {
    if (!input.key) throw new OrchestrationError('validation', 'conversationId must be provided')
    input.signal?.throwIfAborted()
    const deleted = await db
      .delete(memory)
      .where(
        and(
          eq(memory.key, input.key),
          eq(memory.workspaceId, context.workspaceId),
          isNull(memory.deletedAt)
        )
      )
      .returning({ id: memory.id })
    input.signal?.throwIfAborted()
    return { deletedCount: deleted.length }
  },
})
