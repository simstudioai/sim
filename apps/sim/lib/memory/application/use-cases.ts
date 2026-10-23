import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalSubject,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { memory, memorySecretProvenance } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, like, type SQL } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/attribution'
import { assertBillingAttributionSnapshot } from '@/lib/billing/core/attribution'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type DurableSecretProvenance,
  mergeDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import { memoryDelegationPolicy } from '@/lib/memory/application/authorization'
import { memoryOperations } from '@/lib/memory/application/operations'
import { appendMemoryMessages, readPlainMemoryTail } from '@/lib/memory/conversation-store'
import { lockMemoryConversationInTx } from '@/lib/memory/locks'
import { PlainMemoryReadBudget } from '@/lib/memory/read-budget'
import {
  MEMORY_SECRET_PROVENANCE_COLUMNS,
  readBoundMemorySecretProvenance,
} from '@/lib/memory/secret-provenance'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

const MAX_MEMORY_LIST_LIMIT = 1_000
const MEMORY_READ_COLUMNS = {
  id: memory.id,
  workspaceId: memory.workspaceId,
  key: memory.key,
  data: memory.data,
  storageVersion: memory.storageVersion,
  secretProvenanceVersion: memory.secretProvenanceVersion,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
  deletedAt: memory.deletedAt,
}

function selectMemoryRows(where: SQL | undefined, limit: number) {
  return db
    .select({ ...MEMORY_READ_COLUMNS, ...MEMORY_SECRET_PROVENANCE_COLUMNS })
    .from(memory)
    .leftJoin(memorySecretProvenance, eq(memorySecretProvenance.memoryId, memory.id))
    .where(where)
    .orderBy(memory.createdAt)
    .limit(limit)
}

type MemoryReadRow = Awaited<ReturnType<typeof selectMemoryRows>>[number]

export interface MemoryRecord {
  id: string
  key: string
  data: unknown
  secretProvenanceVersion: number | null
  storageVersion?: number
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

/** Keeps the legacy public projection separate from private Agent exchanges and checkpoints. */
async function readMemoryResults(
  rows: MemoryReadRow[],
  principal: Principal,
  workspaceId: string,
  input: ReadProvenanceInput,
  existingScope?: MemoryLegacyProvenanceScope
): Promise<{
  records: MemoryRecord[]
  readProvenance?: MemoryReadProvenance[]
  provenanceScope?: MemoryLegacyProvenanceScope
}> {
  const provenanceScope = input.includePersistedSecretProvenance
    ? (existingScope ??
      (await resolveMemoryLegacyProvenanceScope(
        principal,
        workspaceId,
        input.resolveBillingAttribution
      )))
    : undefined
  input.signal?.throwIfAborted()
  const records: MemoryRecord[] = []
  const readProvenance: MemoryReadProvenance[] = []
  const tailBudget = new PlainMemoryReadBudget()
  for (const { provenanceContentHash, status, entries, ...record } of rows) {
    let provenance = provenanceScope
      ? readBoundMemorySecretProvenance({ ...record, provenanceContentHash, status, entries })
      : undefined
    if (record.storageVersion === 2) {
      input.signal?.throwIfAborted()
      const tail = await readPlainMemoryTail(record.id, workspaceId, tailBudget)
      record.data = [
        ...(Array.isArray(record.data) ? record.data : [record.data]),
        ...tail.messages,
      ]
      if (provenance) provenance = mergeDurableSecretProvenance(provenance, tail.provenance)
    }
    records.push(record)
    if (provenance) readProvenance.push({ data: record.data, provenance })
  }
  return provenanceScope ? { records, readProvenance, provenanceScope } : { records }
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
    const rows = await selectMemoryRows(and(...conditions), input.limit)
    input.signal?.throwIfAborted()
    return readMemoryResults(rows, principal, context.workspaceId, input)
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
    const rows = await selectMemoryRows(
      and(
        eq(memory.key, input.key),
        eq(memory.workspaceId, context.workspaceId),
        isNull(memory.deletedAt)
      ),
      1
    )
    input.signal?.throwIfAborted()
    const { records: projected, ...provenance } = await readMemoryResults(
      rows,
      principal,
      context.workspaceId,
      input
    )
    return { record: projected[0] ?? null, ...provenance }
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
    try {
      await appendMemoryMessages({
        workspaceId: context.workspaceId,
        key: input.key,
        messages: initialData,
        provenance: incomingProvenance,
        newMemoryId: `mem_${generateId().replace(/-/g, '')}`,
        requireFullResponse: true,
      })
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        throw new OrchestrationError('conflict', 'Memory with this key already exists')
      }
      throw error
    }

    input.signal?.throwIfAborted()
    const rows = await selectMemoryRows(
      and(
        eq(memory.key, input.key),
        eq(memory.workspaceId, context.workspaceId),
        isNull(memory.deletedAt)
      ),
      1
    )
    if (!rows[0]) throw new Error('Failed to retrieve memory after creation/update')
    input.signal?.throwIfAborted()
    const { records: projected, ...provenance } = await readMemoryResults(
      rows,
      principal,
      context.workspaceId,
      input,
      provenanceScope
    )
    return {
      record: projected[0],
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
    const deleted = await db.transaction(async (tx) => {
      await lockMemoryConversationInTx(tx, context.workspaceId, input.key)
      return tx
        .delete(memory)
        .where(
          and(
            eq(memory.key, input.key),
            eq(memory.workspaceId, context.workspaceId),
            isNull(memory.deletedAt)
          )
        )
        .returning({ id: memory.id })
    })
    input.signal?.throwIfAborted()
    return { deletedCount: deleted.length }
  },
})
