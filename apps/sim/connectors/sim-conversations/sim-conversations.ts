import { db } from '@sim/db'
import { memory, memorySecretProvenance } from '@sim/db/schema'
import { and, asc, eq, gt, isNull, or, type SQL, sql } from 'drizzle-orm'
import { readBoundMemorySecretProvenance } from '@/lib/memory/secret-provenance'
import { simConversationsConnectorMeta } from '@/connectors/sim-conversations/meta'
import type {
  ConnectorConfig,
  ConnectorSyncContext,
  ExternalDocument,
  ExternalDocumentList,
} from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  isSkippedDocument,
  markSkipped,
  parseTagDate,
  sizeLimitSkipReason,
  takeIndexableWithinCap,
} from '@/connectors/utils'
import { MEMORY } from '@/executor/constants'

const PAGE_SIZE = 100

/**
 * Upper bound on messages rendered into one transcript. A conversation is appended to
 * indefinitely (nothing expires an active `memory` row), so without a bound a
 * long-running agent would eventually produce a document too large to embed.
 */
const MAX_TRANSCRIPT_MESSAGES = 5_000

/** Roles the agent itself would read back. Mirrors `Memory.fetchMemory`. */
const INDEXABLE_ROLES = new Set(['system', 'user', 'assistant'])

export interface ConversationRow {
  id: string
  key: string
  createdAt: Date
  updatedAt: Date
  messageCount: number
  approxBytes: number
}

interface Cursor {
  updatedAt: Date
  id: string
}

export function encodeCursor(row: { updatedAt: Date; id: string }): string {
  return `${row.updatedAt.toISOString()}|${row.id}`
}

/** Throws rather than rewinding — see the matching helper in the files connector. */
export function decodeCursor(cursor: string): Cursor {
  const separator = cursor.indexOf('|')
  const updatedAt = separator === -1 ? Number.NaN : Date.parse(cursor.slice(0, separator))
  const id = separator === -1 ? '' : cursor.slice(separator + 1)
  if (Number.isNaN(updatedAt) || !id) {
    throw new Error(`Malformed conversation cursor: ${cursor}`)
  }
  return { updatedAt: new Date(updatedAt), id }
}

/**
 * Escapes LIKE metacharacters so a prefix is matched literally.
 *
 * Without this a prefix of `%` matches every conversation in the workspace and `_`
 * matches any single character — turning a narrow filter into a full export.
 * Must be paired with `ESCAPE '\'`.
 */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Parses an optional positive-integer config field. `null` signals invalid input. */
export function parseOptionalPositiveInt(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

/**
 * The full `where` for a listing page.
 *
 * `workspaceId` is the engine-supplied one and is applied unconditionally, so a
 * `sourceConfig` carrying its own cannot widen the query. `deletedAt IS NULL` is
 * required and is notably *absent* from `Memory.fetchMemory`; do not copy that.
 * Kept pure and exported so both invariants are directly testable.
 */
export function buildConversationListingFilters(args: {
  workspaceId: string
  prefix: string
  cursor?: Cursor
}): SQL[] {
  const filters: SQL[] = [eq(memory.workspaceId, args.workspaceId), isNull(memory.deletedAt)]

  if (args.prefix) {
    filters.push(sql`${memory.key} LIKE ${`${escapeLikePrefix(args.prefix)}%`} ESCAPE '\\'` as SQL)
  }

  if (args.cursor) {
    filters.push(
      or(
        gt(memory.updatedAt, args.cursor.updatedAt),
        and(eq(memory.updatedAt, args.cursor.updatedAt), gt(memory.id, args.cursor.id))
      ) as SQL
    )
  }

  return filters
}

/**
 * Renders a stored conversation as a markdown transcript.
 *
 * Message filtering mirrors `Memory.fetchMemory` (`executor/handlers/agent/memory.ts`)
 * so a transcript never surfaces anything the agent itself would not read back — the
 * `data` column is untyped `jsonb` and can hold partially-written or legacy shapes.
 *
 * Keeps the most recent messages when truncating: recent turns are what an owner
 * analyzing an agent actually wants, and the header records that it happened.
 */
export function renderTranscript(
  meta: { conversationId: string; startedAt: string; lastActivity: string },
  rawData: unknown
): string {
  const all = Array.isArray(rawData) ? rawData : []
  const messages = all.filter(
    (entry): entry is { role: string; content: string } =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as { role?: unknown }).role === 'string' &&
      INDEXABLE_ROLES.has((entry as { role: string }).role) &&
      typeof (entry as { content?: unknown }).content === 'string'
  )

  const truncated = messages.length > MAX_TRANSCRIPT_MESSAGES
  const kept = truncated ? messages.slice(-MAX_TRANSCRIPT_MESSAGES) : messages

  const header = [
    `# Conversation: ${meta.conversationId}`,
    '',
    `- Conversation ID: ${meta.conversationId}`,
    `- Messages: ${messages.length}`,
    `- Started: ${meta.startedAt}`,
    `- Last activity: ${meta.lastActivity}`,
    ...(truncated
      ? [`- Note: only the most recent ${MAX_TRANSCRIPT_MESSAGES} messages are indexed.`]
      : []),
    '',
    '---',
    '',
  ]

  const body = kept.map(
    (message) =>
      `## ${message.role.charAt(0).toUpperCase()}${message.role.slice(1)}\n\n${message.content.replace(/\r\n/g, '\n').trim()}\n`
  )

  return [...header, ...body].join('\n')
}

/**
 * Builds the listing stub for one conversation.
 *
 * Single source of truth for `contentHash`, used by both listing and hydration.
 * `updatedAt` is the right watermark here: `Memory.appendMessage` bumps it on every
 * appended message, so it moves exactly when the transcript changes.
 */
export function conversationToStub(row: ConversationRow): ExternalDocument {
  return {
    externalId: row.id,
    title: `Conversation: ${row.key}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    // No sourceUrl: conversations have no page of their own in the app.
    contentHash: `memory:${row.id}:${row.updatedAt.toISOString()}`,
    metadata: {
      conversationId: row.key,
      messageCount: row.messageCount,
      lastActivity: row.updatedAt.toISOString(),
      startedAt: row.createdAt.toISOString(),
      /**
       * Paces hydration against the engine's in-flight byte budget. `pg_column_size`
       * reports the compressed, post-TOAST size, so this under-reports — it is a
       * batching hint only, and `getDocument` makes the authoritative size decision
       * against the rendered transcript.
       */
      fileSize: row.approxBytes,
    },
  }
}

const CONVERSATION_ROW_COLUMNS = {
  id: memory.id,
  key: memory.key,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
  /**
   * Never select `data` while listing — the transcript is the entire payload, and a
   * page of them would dwarf the metadata this phase actually needs. `jsonb_typeof`
   * guards the untyped column: `jsonb_array_length` errors on a non-array.
   */
  messageCount: sql<number>`
    CASE WHEN jsonb_typeof(${memory.data}) = 'array'
         THEN jsonb_array_length(${memory.data}) ELSE 0 END`,
  approxBytes: sql<number>`pg_column_size(${memory.data})`,
} as const

function readPrefix(sourceConfig: Record<string, unknown>): string {
  return typeof sourceConfig.conversationIdPrefix === 'string'
    ? sourceConfig.conversationIdPrefix.trim()
    : ''
}

export const simConversationsConnector: ConnectorConfig = {
  ...simConversationsConnectorMeta,

  listDocuments: async (
    _accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor: string | undefined,
    syncContext: ConnectorSyncContext
  ): Promise<ExternalDocumentList> => {
    const workspaceId = syncContext.workspaceId
    const minMessages = parseOptionalPositiveInt(sourceConfig.minMessages) ?? 1
    const maxConversations = parseOptionalPositiveInt(sourceConfig.maxConversations) ?? 0

    const rows = await db
      .select(CONVERSATION_ROW_COLUMNS)
      .from(memory)
      .where(
        and(
          ...buildConversationListingFilters({
            workspaceId,
            prefix: readPrefix(sourceConfig),
            cursor: cursor ? decodeCursor(cursor) : undefined,
          })
        )
      )
      .orderBy(asc(memory.updatedAt), asc(memory.id))
      .limit(PAGE_SIZE)

    const items: ExternalDocument[] = []
    for (const row of rows) {
      // A deliberate scope filter, so it must not set `listingCapped` — a conversation
      // that drops below the threshold should reconcile away like any other removal.
      if (row.messageCount < minMessages) continue
      items.push(conversationToStub(row))
    }

    const lastRow = rows.at(-1)
    const pageFilled = rows.length === PAGE_SIZE

    const indexedSoFar = (syncContext.simConversationsIndexed as number | undefined) ?? 0
    const { documents, indexableCount, capReached } = takeIndexableWithinCap(
      items,
      isSkippedDocument,
      maxConversations,
      indexedSoFar
    )
    syncContext.simConversationsIndexed = indexedSoFar + indexableCount

    if (capReached) {
      // The listing stops short of the source, so it cannot be used to infer deletions.
      syncContext.listingCapped = true
      return { documents, hasMore: false }
    }

    return {
      documents,
      nextCursor: pageFilled && lastRow ? encodeCursor(lastRow) : undefined,
      hasMore: pageFilled,
    }
  },

  getDocument: async (
    _accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext: ConnectorSyncContext
  ): Promise<ExternalDocument | null> => {
    const workspaceId = syncContext.workspaceId

    // Re-read through the same predicates: never fetch by external id alone.
    // Left-joins the provenance sidecar so the secret check below has its inputs.
    const rows = await db
      .select({
        ...CONVERSATION_ROW_COLUMNS,
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
          eq(memory.id, externalId),
          eq(memory.workspaceId, workspaceId),
          isNull(memory.deletedAt)
        )
      )
      .limit(1)

    const row = rows[0]
    if (!row) return null

    const stub = conversationToStub(row)

    /**
     * Agent memory is where resolved credentials and env values land in message
     * text, so every other reader of `memory.data` pairs it with this sidecar
     * (see `app/api/memory/route.ts`). Indexing a transcript copies it into KB
     * chunks and embeddings, which are readable by anyone with *any* permission on
     * the workspace — a wider audience than the write/admin needed to create the
     * connector — so only a provably secret-free conversation is indexed.
     *
     * `readBoundMemorySecretProvenance` returns exact-empty for untracked legacy
     * rows and `unknown` for malformed ones, so this fails closed.
     */
    const provenance = readBoundMemorySecretProvenance({
      secretProvenanceVersion: row.secretProvenanceVersion,
      data: row.data,
      provenanceContentHash: row.provenanceContentHash,
      status: row.provenanceStatus,
      entries: row.provenanceEntries,
    })
    if (provenance.status !== 'exact' || provenance.entries.length > 0) {
      return markSkipped(
        stub,
        'Conversation contains secret-derived values or its provenance is unavailable, so it was not indexed'
      )
    }

    const content = renderTranscript(
      {
        conversationId: row.key,
        startedAt: row.createdAt.toISOString(),
        lastActivity: row.updatedAt.toISOString(),
      },
      row.data
    )

    if (Buffer.byteLength(content, 'utf8') > CONNECTOR_MAX_FILE_BYTES) {
      return markSkipped(stub, sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES))
    }
    if (!content.trim()) return null

    return { ...stub, content, contentDeferred: false }
  },

  validateConfig: async (
    _accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const prefix = readPrefix(sourceConfig)
    if (prefix.length > MEMORY.MAX_CONVERSATION_ID_LENGTH) {
      return {
        valid: false,
        error: `Conversation ID Prefix cannot exceed ${MEMORY.MAX_CONVERSATION_ID_LENGTH} characters`,
      }
    }

    if (parseOptionalPositiveInt(sourceConfig.minMessages) === null) {
      return { valid: false, error: 'Minimum Messages must be a positive whole number' }
    }
    if (parseOptionalPositiveInt(sourceConfig.maxConversations) === null) {
      return { valid: false, error: 'Max Conversations must be a positive whole number' }
    }

    return { valid: true }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const tags: Record<string, unknown> = {}

    if (typeof metadata.conversationId === 'string' && metadata.conversationId) {
      tags.conversationId = metadata.conversationId
    }
    if (typeof metadata.messageCount === 'number' && Number.isFinite(metadata.messageCount)) {
      tags.messageCount = metadata.messageCount
    }
    const lastActivity = parseTagDate(metadata.lastActivity)
    if (lastActivity) tags.lastActivity = lastActivity

    return tags
  },
}
