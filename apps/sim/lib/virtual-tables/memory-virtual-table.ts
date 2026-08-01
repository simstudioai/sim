import type { JsonValue, TableDefinition, TableRow, TableSchema } from '@/lib/table/types'

const MEMORY_TABLE_ID_PREFIX = 'system_memory_'

export const MEMORY_TABLE_COLUMNS = {
  id: 'id',
  conversationId: 'conversation_id',
  transcript: 'transcript',
  messageCount: 'message_count',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
} as const

export const MEMORY_TABLE_SCHEMA: TableSchema = {
  columns: [
    {
      id: MEMORY_TABLE_COLUMNS.id,
      name: 'ID',
      type: 'string',
      required: true,
    },
    {
      id: MEMORY_TABLE_COLUMNS.conversationId,
      name: 'Conversation ID',
      type: 'string',
      required: true,
    },
    {
      id: MEMORY_TABLE_COLUMNS.transcript,
      name: 'Transcript',
      type: 'json',
      required: true,
    },
    {
      id: MEMORY_TABLE_COLUMNS.messageCount,
      name: 'Message Count',
      type: 'number',
      required: true,
    },
    {
      id: MEMORY_TABLE_COLUMNS.createdAt,
      name: 'Created',
      type: 'date',
      required: true,
    },
    {
      id: MEMORY_TABLE_COLUMNS.updatedAt,
      name: 'Updated',
      type: 'date',
      required: true,
    },
  ],
}

const MEMORY_TABLE_LOCKS = {
  schemaLocked: true,
  insertLocked: true,
  updateLocked: true,
  deleteLocked: true,
} as const

interface MemoryTableWorkspace {
  id: string
  ownerId: string
  createdAt: Date
  updatedAt: Date
}

interface CreateMemoryTableDefinitionInput {
  workspace: MemoryTableWorkspace
  rowCount: number
  lastMemoryUpdatedAt: Date | null
}

interface MemoryRecord {
  id: string
  key: string
  data: JsonValue
  messageCount: number
  createdAt: Date
  updatedAt: Date
}

export function getMemoryTableId(workspaceId: string): string {
  return `${MEMORY_TABLE_ID_PREFIX}${workspaceId}`
}

export function isMemoryTableId(tableId: string): boolean {
  return tableId.startsWith(MEMORY_TABLE_ID_PREFIX)
}

export function createMemoryTableDefinition({
  workspace,
  rowCount,
  lastMemoryUpdatedAt,
}: CreateMemoryTableDefinitionInput): TableDefinition {
  return {
    id: getMemoryTableId(workspace.id),
    isVirtual: true,
    name: 'Memory',
    description: 'Read-only agent conversation memory for this workspace',
    schema: MEMORY_TABLE_SCHEMA,
    metadata: null,
    rowCount,
    maxRows: Number.MAX_SAFE_INTEGER,
    workspaceId: workspace.id,
    folderId: null,
    createdBy: workspace.ownerId,
    locks: MEMORY_TABLE_LOCKS,
    archivedAt: null,
    createdAt: workspace.createdAt,
    updatedAt: lastMemoryUpdatedAt ?? workspace.updatedAt,
  }
}

export function mapMemoryRecordToTableRow(record: MemoryRecord, position = 0): TableRow {
  return {
    id: record.id,
    data: {
      [MEMORY_TABLE_COLUMNS.id]: record.id,
      [MEMORY_TABLE_COLUMNS.conversationId]: record.key,
      [MEMORY_TABLE_COLUMNS.transcript]: record.data,
      [MEMORY_TABLE_COLUMNS.messageCount]: record.messageCount,
      [MEMORY_TABLE_COLUMNS.createdAt]: record.createdAt.toISOString(),
      [MEMORY_TABLE_COLUMNS.updatedAt]: record.updatedAt.toISOString(),
    },
    executions: {},
    position,
    orderKey: record.updatedAt.toISOString(),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
