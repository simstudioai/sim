import { db } from '@sim/db'
import { agentMemoryTurn, memory, memoryItem, memorySecretProvenance } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, gt, inArray, isNull, lt, type SQLWrapper, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { stringifyBoundedJson } from '@/lib/core/utils/bounded-json'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import {
  type DurableSecretProvenance,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  hashDurableSecretProvenanceValue,
  mergeDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import { lockMemoryConversationInTx } from '@/lib/memory/locks'
import { MAX_RICH_MEMORY_PAGE_BYTES, PlainMemoryReadBudget } from '@/lib/memory/read-budget'
import {
  bindMemorySecretProvenanceToMessages,
  readBoundMemorySecretProvenance,
  replaceMemorySecretProvenanceInTx,
} from '@/lib/memory/secret-provenance'

const MEMORY_ITEM_PAGE_SIZE = 100
const MAX_TURN_ITEMS = 100
const MAX_TURN_STATE_BYTES = 4 * 1024 * 1024
const MAX_MEMORY_ITEM_BYTES = 1024 * 1024

export interface AgentMemoryTurnIdentity {
  workspaceId: string
  workflowId: string
  executionId: string
  blockId: string
  nodeId: string
  executionOrder: number
  conversationId: string
}

export interface AgentMemoryTurnRecord {
  memoryId: string
  turnId: string
  encryptedState: string | null
  revision: number
}

export interface ConversationItemInput {
  appendKey: string
  turnId?: string
  kind: 'message' | 'exchange'
  data: unknown
  provenance?: DurableSecretProvenance
}

export interface ConversationItem {
  sequence: number
  appendKey: string
  turnId?: string
  kind: 'message' | 'exchange'
  data: unknown
  provenance: DurableSecretProvenance
}

export interface SaveAgentMemoryTurnInput extends AgentMemoryTurnIdentity {
  memoryId: string
  turnId: string
  expectedRevision: number
  encryptedState: string
  items?: readonly ConversationItemInput[]
}

export interface ReadConversationItemsInput {
  workspaceId: string
  memoryId: string
  beforeSequence?: number
  limit?: number
  /** Interactive retrieval can continue across byte-limited pages; context loading stops. */
  continueAfterByteLimit?: boolean
}

export interface ReadConversationPrefixInput {
  workspaceId: string
  conversationId: string
  memoryId?: string
}

export interface AppendAgentMemoryMessageInput extends ReadConversationPrefixInput {
  memoryId: string
  turnId: string
  appendKey: string
  data: unknown
  provenance?: DurableSecretProvenance
}

interface PlainMemoryWriteInput {
  workspaceId: string
  key: string
  messages: readonly unknown[]
  provenance?: DurableSecretProvenance
}

/** Both storage versions persist the same admitted snapshot of each new history item. */
function captureMemoryItem(value: unknown): unknown {
  const encoded = stringifyBoundedJson(value, MAX_MEMORY_ITEM_BYTES)
  if (encoded === undefined)
    throw new OrchestrationError(
      'payload_too_large',
      'Memory item is too large or cannot be serialized'
    )
  return JSON.parse(encoded)
}

/** Creates a legacy conversation once; an existing prefix or durable tail is never overwritten. */
export async function seedMemoryMessages(input: PlainMemoryWriteInput): Promise<void> {
  await db.transaction(async (tx) => {
    await lockMemoryConversationInTx(tx, input.workspaceId, input.key)
    const id = generateId()
    const now = new Date()
    const [inserted] = await tx
      .insert(memory)
      .values({
        id,
        workspaceId: input.workspaceId,
        key: input.key,
        data: input.messages,
        secretProvenanceVersion: input.provenance ? 1 : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: memory.id })
    if (inserted && input.provenance)
      await replaceMemorySecretProvenanceInTx(tx, id, input.messages, input.provenance)
  })
}

/**
 * All ordinary writers share the storage-version decision under the conversation lock.
 * Writers returning the complete compatibility view reserve its response budget before mutation.
 */
export async function appendMemoryMessages(
  input: PlainMemoryWriteInput & { newMemoryId?: string; requireFullResponse?: boolean }
): Promise<void> {
  const provenance = input.provenance
    ? await bindMemorySecretProvenanceToMessages(input.messages, input.provenance)
    : undefined
  await db.transaction(async (tx) => {
    await lockMemoryConversationInTx(tx, input.workspaceId, input.key)
    const [existing] = await tx
      .select({
        id: memory.id,
        data: memory.data,
        storageVersion: memory.storageVersion,
        secretProvenanceVersion: memory.secretProvenanceVersion,
      })
      .from(memory)
      .where(and(eq(memory.workspaceId, input.workspaceId), eq(memory.key, input.key)))
      .limit(1)
      .for('update')
    const now = new Date()
    if (existing?.storageVersion === 2) {
      if (input.requireFullResponse)
        await preflightPlainMemoryAppendInTx(
          tx,
          existing.id,
          input.workspaceId,
          input.messages,
          provenance
        )
      await appendPlainMemoryItemsInTx(tx, existing.id, input.messages, provenance)
      await tx.update(memory).set({ updatedAt: now }).where(eq(memory.id, existing.id))
      return
    }

    const messages = input.messages.map(captureMemoryItem)
    let previousProvenance: DurableSecretProvenance | undefined
    if (existing && provenance) {
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
        id: input.newMemoryId ?? generateId(),
        workspaceId: input.workspaceId,
        key: input.key,
        data: messages,
        secretProvenanceVersion: provenance ? 1 : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memory.workspaceId, memory.key],
        set: {
          data: sql`${memory.data} || ${JSON.stringify(messages)}::jsonb`,
          secretProvenanceVersion: provenance ? 1 : (existing?.secretProvenanceVersion ?? null),
          updatedAt: now,
        },
      })
      .returning({ id: memory.id, data: memory.data })
    if (provenance) {
      const nextProvenance = previousProvenance
        ? mergeDurableSecretProvenance(previousProvenance, provenance)
        : provenance
      await replaceMemorySecretProvenanceInTx(
        tx,
        written.id,
        written.data,
        nextProvenance,
        previousProvenance?.status === 'unknown'
          ? 'inherited-provenance-unknown'
          : provenance.status === 'exact' && nextProvenance.status === 'unknown'
            ? 'merge-provenance-limit'
            : undefined
      )
    } else if (existing?.secretProvenanceVersion === 1) {
      await replaceMemorySecretProvenanceInTx(tx, written.id, written.data, { status: 'unknown' })
    }
  })
}

/** Private prefix lookup used only by the authorized Agent history operation. */
export async function readConversationPrefix(input: ReadConversationPrefixInput) {
  const [row] = await db
    .select({
      id: memory.id,
      storageVersion: memory.storageVersion,
      data: memory.data,
      secretProvenanceVersion: memory.secretProvenanceVersion,
      provenanceContentHash: memorySecretProvenance.contentHash,
      provenanceStatus: memorySecretProvenance.status,
      provenanceEntries: memorySecretProvenance.entries,
    })
    .from(memory)
    .leftJoin(memorySecretProvenance, eq(memorySecretProvenance.memoryId, memory.id))
    .where(
      and(
        eq(memory.workspaceId, input.workspaceId),
        eq(memory.key, input.conversationId),
        input.memoryId ? eq(memory.id, input.memoryId) : undefined,
        isNull(memory.deletedAt)
      )
    )
    .limit(1)
  return row
}

/** A retry input belongs to its original turn and cannot recreate a deleted conversation. */
export async function appendAgentMemoryMessage(
  input: AppendAgentMemoryMessageInput & { workflowId: string; executionId: string }
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockMemoryConversationInTx(tx, input.workspaceId, input.conversationId)
    const [conversation] = await tx
      .select({ id: memory.id })
      .from(memory)
      .innerJoin(agentMemoryTurn, eq(agentMemoryTurn.memoryId, memory.id))
      .where(
        and(
          eq(memory.id, input.memoryId),
          eq(memory.workspaceId, input.workspaceId),
          eq(memory.key, input.conversationId),
          eq(memory.storageVersion, 2),
          isNull(memory.deletedAt),
          eq(agentMemoryTurn.id, input.turnId),
          eq(agentMemoryTurn.workflowId, input.workflowId),
          eq(agentMemoryTurn.executionId, input.executionId)
        )
      )
      .limit(1)
      .for('update')
    if (!conversation)
      throw new OrchestrationError('not_found', 'Agent memory turn no longer exists')
    await appendConversationItemsInTx(tx, conversation.id, [
      {
        appendKey: input.appendKey,
        turnId: input.turnId,
        kind: 'message',
        data: input.data,
        provenance: input.provenance,
      },
    ])
    await tx.update(memory).set({ updatedAt: new Date() }).where(eq(memory.id, conversation.id))
  })
}

function turnIdentityPredicate(identity: AgentMemoryTurnIdentity, memoryId: string) {
  return and(
    eq(agentMemoryTurn.memoryId, memoryId),
    eq(agentMemoryTurn.workflowId, identity.workflowId),
    eq(agentMemoryTurn.executionId, identity.executionId),
    eq(agentMemoryTurn.blockId, identity.blockId),
    eq(agentMemoryTurn.nodeId, identity.nodeId),
    eq(agentMemoryTurn.executionOrder, identity.executionOrder)
  )
}

function itemProvenance(item: typeof memoryItem.$inferSelect): DurableSecretProvenance {
  return readBoundMemorySecretProvenance({
    secretProvenanceVersion: 1,
    data: item.data,
    provenanceContentHash: item.contentHash,
    status: item.provenanceStatus,
    entries: item.provenanceEntries,
  })
}

/** Caller holds the conversation lock; repeated append keys cannot change their original data. */
async function appendConversationItemsInTx(
  tx: DbTransaction,
  memoryId: string,
  items: readonly ConversationItemInput[]
): Promise<void> {
  if (items.length === 0) return
  if (items.length > MAX_TURN_ITEMS) throw new Error('Too many memory items in one write')
  const values: (typeof memoryItem.$inferInsert)[] = []
  for (const item of items) {
    if (!item.appendKey) throw new Error('Memory append identity is required')
    const data = captureMemoryItem(item.data)
    const contentHash = hashDurableSecretProvenanceValue(data)
    if (!contentHash) throw new Error('Memory item cannot be serialized')
    const provenance = item.provenance
      ? await bindMemorySecretProvenanceToMessages([data], item.provenance)
      : EXACT_EMPTY_DURABLE_SECRET_PROVENANCE
    values.push({
      id: generateId(),
      memoryId,
      appendKey: item.turnId ? `${item.turnId}:${item.appendKey}` : item.appendKey,
      turnId: item.turnId,
      kind: item.kind,
      data,
      contentHash,
      provenanceStatus: provenance.status,
      provenanceEntries: provenance.status === 'exact' ? [...provenance.entries] : [],
    })
  }
  const existing = await tx
    .select({
      appendKey: memoryItem.appendKey,
      contentHash: memoryItem.contentHash,
      kind: memoryItem.kind,
    })
    .from(memoryItem)
    .where(
      and(
        eq(memoryItem.memoryId, memoryId),
        inArray(
          memoryItem.appendKey,
          values.map((item) => item.appendKey)
        )
      )
    )
  const existingByKey = new Map<string, { contentHash: string; kind: string }>(
    existing.map((item) => [item.appendKey, item])
  )
  for (const value of values) {
    const previous = existingByKey.get(value.appendKey)
    if (previous && (previous.contentHash !== value.contentHash || previous.kind !== value.kind)) {
      throw new OrchestrationError('conflict', 'Memory append identity was already used')
    }
    existingByKey.set(value.appendKey, { contentHash: value.contentHash, kind: value.kind })
  }
  await tx
    .insert(memoryItem)
    .values(values)
    .onConflictDoNothing({ target: [memoryItem.memoryId, memoryItem.appendKey] })
}

/** Preserves ordinary API/Pi message shapes while keeping their writes after the frozen prefix. */
async function appendPlainMemoryItemsInTx(
  tx: DbTransaction,
  memoryId: string,
  messages: readonly unknown[],
  provenance?: DurableSecretProvenance
): Promise<void> {
  for (let index = 0; index < messages.length; index += MAX_TURN_ITEMS) {
    await appendConversationItemsInTx(
      tx,
      memoryId,
      messages.slice(index, index + MAX_TURN_ITEMS).map((data) => ({
        appendKey: generateId(),
        kind: 'message',
        data,
        provenance,
      }))
    )
  }
}

function plainMemoryItemBytes(
  data: SQLWrapper,
  provenance: SQLWrapper,
  appendKey: SQLWrapper,
  contentHash: SQLWrapper
) {
  return sql<number>`octet_length((${data})::text) + octet_length((${provenance})::text) + octet_length(${appendKey}) + octet_length(${contentHash}) + 256`.mapWith(
    Number
  )
}

function plainMemoryScope(memoryId: string, workspaceId: string) {
  return and(
    eq(memory.id, memoryId),
    eq(memory.workspaceId, workspaceId),
    isNull(memory.deletedAt),
    eq(memoryItem.kind, 'message')
  )
}

function readPlainMemorySizePage(
  reader: DbOrTx,
  memoryId: string,
  workspaceId: string,
  afterSequence: number
) {
  return reader
    .select({
      id: memoryItem.id,
      sequence: memoryItem.sequence,
      bytes: plainMemoryItemBytes(
        memoryItem.data,
        memoryItem.provenanceEntries,
        memoryItem.appendKey,
        memoryItem.contentHash
      ),
    })
    .from(memoryItem)
    .innerJoin(memory, eq(memory.id, memoryItem.memoryId))
    .where(and(plainMemoryScope(memoryId, workspaceId), gt(memoryItem.sequence, afterSequence)))
    .orderBy(asc(memoryItem.sequence))
    .limit(MEMORY_ITEM_PAGE_SIZE)
}

/** The conversation lock makes admission and the following append one atomic operation. */
async function preflightPlainMemoryAppendInTx(
  tx: DbTransaction,
  memoryId: string,
  workspaceId: string,
  messages: readonly unknown[],
  provenance?: DurableSecretProvenance
): Promise<void> {
  const budget = new PlainMemoryReadBudget()
  budget.reserve(messages.length, 0)
  let afterSequence = 0
  while (true) {
    const page = await readPlainMemorySizePage(tx, memoryId, workspaceId, afterSequence)
    budget.reserve(
      page.length,
      page.reduce((bytes, row) => bytes + row.bytes, 0)
    )
    if (page.length < MEMORY_ITEM_PAGE_SIZE) break
    afterSequence = page[page.length - 1].sequence
  }
  for (let offset = 0; offset < messages.length; offset += MAX_TURN_ITEMS) {
    const proposed = []
    for (const data of messages.slice(offset, offset + MAX_TURN_ITEMS)) {
      const contentHash = hashDurableSecretProvenanceValue(data)
      if (!contentHash) throw new Error('Memory item cannot be serialized')
      const bound = provenance
        ? await bindMemorySecretProvenanceToMessages([data], provenance)
        : EXACT_EMPTY_DURABLE_SECRET_PROVENANCE
      proposed.push({
        data,
        entries: bound.status === 'exact' ? bound.entries : [],
        appendKey: generateId(),
        contentHash,
      })
    }
    const rows = await tx
      .select({
        bytes: plainMemoryItemBytes(
          sql`proposed.item -> 'data'`,
          sql`proposed.item -> 'entries'`,
          sql`proposed.item ->> 'appendKey'`,
          sql`proposed.item ->> 'contentHash'`
        ),
      })
      .from(sql`jsonb_array_elements(${JSON.stringify(proposed)}::jsonb) as proposed(item)`)
    budget.reserve(
      0,
      rows.reduce((bytes, row) => bytes + row.bytes, 0)
    )
  }
}

/** Plain compatibility readers never expose private Agent tool exchanges or journal state. */
export async function readPlainMemoryTail(
  memoryId: string,
  workspaceId: string,
  budget = new PlainMemoryReadBudget()
): Promise<{
  messages: unknown[]
  provenance: DurableSecretProvenance
}> {
  const messages: unknown[] = []
  let provenance: DurableSecretProvenance = EXACT_EMPTY_DURABLE_SECRET_PROVENANCE
  let afterSequence = 0
  while (true) {
    /** Items are append-only: size admission precedes materializing their JSON payloads. */
    const page = await readPlainMemorySizePage(db, memoryId, workspaceId, afterSequence)
    if (page.length === 0) break
    budget.reserve(
      page.length,
      page.reduce((bytes, row) => bytes + row.bytes, 0)
    )
    const rows = await db
      .select({ item: memoryItem })
      .from(memoryItem)
      .innerJoin(memory, eq(memory.id, memoryItem.memoryId))
      .where(
        and(
          plainMemoryScope(memoryId, workspaceId),
          inArray(
            memoryItem.id,
            page.map((row) => row.id)
          )
        )
      )
      .orderBy(asc(memoryItem.sequence))
      .limit(MEMORY_ITEM_PAGE_SIZE)
    for (const { item } of rows) {
      messages.push(item.data)
      provenance = mergeDurableSecretProvenance(provenance, itemProvenance(item))
    }
    if (page.length < MEMORY_ITEM_PAGE_SIZE) break
    afterSequence = page[page.length - 1].sequence
  }
  return { messages, provenance }
}

/** Reads newest groups first so the Agent can stop before materializing an entire conversation. */
export async function readConversationItems(input: ReadConversationItemsInput): Promise<{
  items: ConversationItem[]
  nextBeforeSequence?: number
  unavailableSequence?: number
}> {
  const limit = input.limit ?? MEMORY_ITEM_PAGE_SIZE
  if (!Number.isInteger(limit) || limit < 1 || limit > MEMORY_ITEM_PAGE_SIZE) {
    throw new OrchestrationError('validation', 'Memory item page size must be between 1 and 100')
  }
  const scope = and(
    eq(memory.id, input.memoryId),
    eq(memory.workspaceId, input.workspaceId),
    isNull(memory.deletedAt),
    input.beforeSequence === undefined ? undefined : lt(memoryItem.sequence, input.beforeSequence)
  )
  const page = await db
    .select({
      id: memoryItem.id,
      sequence: memoryItem.sequence,
      bytes: plainMemoryItemBytes(
        memoryItem.data,
        memoryItem.provenanceEntries,
        memoryItem.appendKey,
        memoryItem.contentHash
      ),
    })
    .from(memoryItem)
    .innerJoin(memory, eq(memory.id, memoryItem.memoryId))
    .where(scope)
    .orderBy(desc(memoryItem.sequence))
    .limit(limit + 1)
  let bytes = 0
  let reachedByteLimit = false
  const selectedIds: string[] = []
  for (const item of page.slice(0, limit)) {
    if (
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0 ||
      bytes + item.bytes > MAX_RICH_MEMORY_PAGE_BYTES
    ) {
      reachedByteLimit = true
      break
    }
    bytes += item.bytes
    selectedIds.push(item.id)
  }
  if (selectedIds.length === 0) {
    const unavailable = reachedByteLimit && input.continueAfterByteLimit ? page[0] : undefined
    return {
      items: [],
      ...(unavailable
        ? {
            unavailableSequence: unavailable.sequence,
            nextBeforeSequence: unavailable.sequence,
          }
        : {}),
    }
  }
  const selected = await db
    .select({ item: memoryItem })
    .from(memoryItem)
    .innerJoin(memory, eq(memory.id, memoryItem.memoryId))
    .where(and(scope, inArray(memoryItem.id, selectedIds)))
    .orderBy(desc(memoryItem.sequence))
    .limit(limit)
  return {
    items: selected.map(({ item }) => ({
      sequence: item.sequence,
      appendKey:
        item.turnId && item.appendKey.startsWith(`${item.turnId}:`)
          ? item.appendKey.slice(item.turnId.length + 1)
          : item.appendKey,
      ...(item.turnId ? { turnId: item.turnId } : {}),
      kind: item.kind,
      data: item.data,
      provenance: itemProvenance(item),
    })),
    ...((reachedByteLimit && input.continueAfterByteLimit) ||
    (!reachedByteLimit && page.length > limit)
      ? { nextBeforeSequence: page[selectedIds.length - 1].sequence }
      : {}),
  }
}

/** Freezes a legacy prefix without copying it, and deduplicates the logical invocation. */
export async function openAgentMemoryTurn(
  identity: AgentMemoryTurnIdentity
): Promise<AgentMemoryTurnRecord> {
  return db.transaction(async (tx) => {
    await lockMemoryConversationInTx(tx, identity.workspaceId, identity.conversationId)
    await tx
      .insert(memory)
      .values({
        id: generateId(),
        workspaceId: identity.workspaceId,
        key: identity.conversationId,
        data: [],
        storageVersion: 2,
      })
      .onConflictDoNothing()
    const [conversation] = await tx
      .select({ id: memory.id })
      .from(memory)
      .where(
        and(
          eq(memory.workspaceId, identity.workspaceId),
          eq(memory.key, identity.conversationId),
          isNull(memory.deletedAt)
        )
      )
      .limit(1)
      .for('update')
    if (!conversation) throw new OrchestrationError('not_found', 'Conversation no longer exists')
    await tx.update(memory).set({ storageVersion: 2 }).where(eq(memory.id, conversation.id))
    const [existing] = await tx
      .select({
        id: agentMemoryTurn.id,
        revision: agentMemoryTurn.revision,
        stateBytes: sql<number>`coalesce(octet_length(${agentMemoryTurn.encryptedState}), 0)`,
        encryptedState: sql<
          string | null
        >`CASE WHEN octet_length(${agentMemoryTurn.encryptedState}) <= ${MAX_TURN_STATE_BYTES} THEN ${agentMemoryTurn.encryptedState} ELSE NULL END`,
      })
      .from(agentMemoryTurn)
      .where(turnIdentityPredicate(identity, conversation.id))
      .limit(1)
    if (existing && existing.stateBytes > MAX_TURN_STATE_BYTES)
      throw new OrchestrationError('payload_too_large', 'Agent memory checkpoint is too large')
    if (existing)
      return {
        memoryId: conversation.id,
        turnId: existing.id,
        encryptedState: existing.encryptedState,
        revision: existing.revision,
      }
    const turnId = generateId()
    await tx.insert(agentMemoryTurn).values({
      id: turnId,
      memoryId: conversation.id,
      workflowId: identity.workflowId,
      executionId: identity.executionId,
      blockId: identity.blockId,
      nodeId: identity.nodeId,
      executionOrder: identity.executionOrder,
    })
    return { memoryId: conversation.id, turnId, encryptedState: null, revision: 0 }
  })
}

/** CAS advancement and completed history share one commit; deleted conversations cannot reappear. */
export async function saveAgentMemoryTurn(
  input: SaveAgentMemoryTurnInput
): Promise<{ revision: number }> {
  if (Buffer.byteLength(input.encryptedState, 'utf8') > MAX_TURN_STATE_BYTES)
    throw new Error('Agent memory checkpoint is too large')
  return db.transaction(async (tx) => {
    await lockMemoryConversationInTx(tx, input.workspaceId, input.conversationId)
    const [conversation] = await tx
      .select({ id: memory.id })
      .from(memory)
      .where(
        and(
          eq(memory.id, input.memoryId),
          eq(memory.workspaceId, input.workspaceId),
          eq(memory.key, input.conversationId),
          isNull(memory.deletedAt)
        )
      )
      .limit(1)
      .for('update')
    if (!conversation) throw new OrchestrationError('not_found', 'Conversation no longer exists')
    const [written] = await tx
      .update(agentMemoryTurn)
      .set({
        encryptedState: input.encryptedState,
        revision: input.expectedRevision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentMemoryTurn.id, input.turnId),
          turnIdentityPredicate(input, input.memoryId),
          eq(agentMemoryTurn.revision, input.expectedRevision)
        )
      )
      .returning({ revision: agentMemoryTurn.revision })
    if (!written) throw new OrchestrationError('conflict', 'Agent memory checkpoint changed')
    await appendConversationItemsInTx(
      tx,
      input.memoryId,
      (input.items ?? []).map((item) => ({ ...item, turnId: input.turnId }))
    )
    await tx.update(memory).set({ updatedAt: new Date() }).where(eq(memory.id, input.memoryId))
    return written
  })
}
