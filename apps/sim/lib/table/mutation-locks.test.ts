/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertColumnDestructive,
  assertRowDelete,
  assertRowInsert,
  assertRowUpdate,
  assertSchemaMutable,
  TableLockedError,
} from '@/lib/table/mutation-locks'
import type { TableDefinition, TableLocks } from '@/lib/table/types'

const UNLOCKED: TableLocks = {
  schemaLocked: false,
  insertLocked: false,
  updateLocked: false,
  deleteLocked: false,
}

function makeTable(
  locks: Partial<TableLocks> = {},
  columns: TableDefinition['schema']['columns'] = []
): TableDefinition {
  return {
    id: 'tbl_1',
    name: 't',
    schema: { columns },
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'ws_1',
    createdBy: 'user_1',
    locks: { ...UNLOCKED, ...locks },
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('mutation-locks', () => {
  it('passes every assert on an unlocked table', () => {
    const table = makeTable()
    expect(() => assertRowInsert(table)).not.toThrow()
    expect(() => assertRowUpdate(table, ['col_a'])).not.toThrow()
    expect(() => assertRowDelete(table)).not.toThrow()
    expect(() => assertSchemaMutable(table)).not.toThrow()
    expect(() => assertColumnDestructive(table)).not.toThrow()
  })

  it('blocks only its own verb with a 423 and the right lock name', () => {
    expect(() => assertRowInsert(makeTable({ insertLocked: true }))).toThrowError(
      expect.objectContaining({ statusCode: 423, lock: 'insert' })
    )
    expect(() => assertRowUpdate(makeTable({ updateLocked: true }), ['col_a'])).toThrowError(
      expect.objectContaining({ statusCode: 423, lock: 'update' })
    )
    expect(() => assertRowDelete(makeTable({ deleteLocked: true }))).toThrowError(
      expect.objectContaining({ statusCode: 423, lock: 'delete' })
    )
    expect(() => assertSchemaMutable(makeTable({ schemaLocked: true }))).toThrowError(
      expect.objectContaining({ statusCode: 423, lock: 'schema' })
    )
  })

  it('does not cross-block: an insert lock permits update/delete/schema', () => {
    const table = makeTable({ insertLocked: true })
    expect(() => assertRowUpdate(table, ['col_a'])).not.toThrow()
    expect(() => assertRowDelete(table)).not.toThrow()
    expect(() => assertSchemaMutable(table)).not.toThrow()
  })

  describe('update lock exemptions', () => {
    it('permits an empty (executions-only) patch', () => {
      expect(() => assertRowUpdate(makeTable({ updateLocked: true }))).not.toThrow()
      expect(() => assertRowUpdate(makeTable({ updateLocked: true }), [])).not.toThrow()
    })

    it('permits a patch touching only workflow-group output columns', () => {
      const table = makeTable({ updateLocked: true }, [
        { id: 'col_wf', name: 'Enriched', type: 'string', workflowGroupId: 'grp_1' },
      ])
      expect(() => assertRowUpdate(table, ['col_wf'])).not.toThrow()
    })

    it('blocks a patch touching a user-authored column', () => {
      const table = makeTable({ updateLocked: true }, [
        { id: 'col_wf', name: 'Enriched', type: 'string', workflowGroupId: 'grp_1' },
        { id: 'col_user', name: 'Name', type: 'string' },
      ])
      expect(() => assertRowUpdate(table, ['col_wf', 'col_user'])).toThrow(TableLockedError)
    })
  })

  describe('assertColumnDestructive', () => {
    it('requires BOTH schema and delete clear', () => {
      expect(() => assertColumnDestructive(makeTable({ schemaLocked: true }))).toThrowError(
        expect.objectContaining({ lock: 'schema' })
      )
      // schema clear but delete locked → delete error (destroying row data)
      expect(() => assertColumnDestructive(makeTable({ deleteLocked: true }))).toThrowError(
        expect.objectContaining({ lock: 'delete' })
      )
    })
  })

  it('treats an absent locks field as fully unlocked (fail-open for mocks)', () => {
    const table = { ...makeTable(), locks: undefined } as unknown as TableDefinition
    expect(() => assertRowInsert(table)).not.toThrow()
    expect(() => assertSchemaMutable(table)).not.toThrow()
  })
})
