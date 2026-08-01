/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createMemoryTableDefinition,
  getMemoryTableId,
  isMemoryTableId,
  mapMemoryRecordToTableRow,
} from '@/lib/virtual-tables/memory-virtual-table'

const WORKSPACE = {
  id: 'workspace-1',
  ownerId: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('Memory virtual table', () => {
  it('uses a workspace-bound synthetic ID', () => {
    const tableId = getMemoryTableId(WORKSPACE.id)

    expect(tableId).toBe('system_memory_workspace-1')
    expect(isMemoryTableId(tableId)).toBe(true)
    expect(isMemoryTableId('table-1')).toBe(false)
  })

  it('defines a permanently locked table with the transcript in a JSON column', () => {
    const table = createMemoryTableDefinition({
      workspace: WORKSPACE,
      rowCount: 2,
      lastMemoryUpdatedAt: new Date('2026-01-03T00:00:00.000Z'),
    })

    expect(table).toMatchObject({
      id: getMemoryTableId(WORKSPACE.id),
      name: 'Memory',
      workspaceId: WORKSPACE.id,
      isVirtual: true,
      createdBy: WORKSPACE.ownerId,
      folderId: null,
      rowCount: 2,
      locks: {
        schemaLocked: true,
        insertLocked: true,
        updateLocked: true,
        deleteLocked: true,
      },
    })
    expect(table.schema.columns).toEqual([
      expect.objectContaining({ id: 'id', name: 'ID', type: 'string' }),
      expect.objectContaining({ id: 'conversation_id', name: 'Conversation ID', type: 'string' }),
      expect.objectContaining({ id: 'transcript', name: 'Transcript', type: 'json' }),
      expect.objectContaining({ id: 'message_count', name: 'Message Count', type: 'number' }),
      expect.objectContaining({ id: 'created_at', name: 'Created', type: 'date' }),
      expect.objectContaining({ id: 'updated_at', name: 'Updated', type: 'date' }),
    ])
  })

  it('maps one memory record to one conversation row without truncating its transcript', () => {
    const transcript = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]
    const row = mapMemoryRecordToTableRow({
      id: 'mem_1',
      key: 'conversation-1',
      data: transcript,
      messageCount: 2,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    })

    expect(row.id).toBe('mem_1')
    expect(row.orderKey).toBe('2026-01-02T00:00:00.000Z')
    expect(row.data).toEqual({
      id: 'mem_1',
      conversation_id: 'conversation-1',
      transcript,
      message_count: 2,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    })
  })
})
