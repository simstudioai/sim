/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockGenerateId } = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
}))

import { namedRowMapper } from '@/lib/table/cell-format'
import {
  buildIdByName,
  buildNameById,
  filterNamesToIds,
  generateColumnId,
  getColumnId,
  remapGroupColumnRefs,
  remapViewConfigColumnRefs,
  rowDataNameToId,
  sortNamesToIds,
  withGeneratedColumnIds,
} from '@/lib/table/column-keys'
import type { TableSchema, WorkflowGroup } from '@/lib/table/types'

describe('getColumnId', () => {
  it('returns the explicit id when present', () => {
    expect(getColumnId({ id: 'col_abc', name: 'email' })).toBe('col_abc')
  })
  it('falls back to name for legacy id-less columns', () => {
    expect(getColumnId({ name: 'email' })).toBe('email')
  })
})

describe('generateColumnId', () => {
  it('mints a col_-prefixed id with the uuid dashes stripped', () => {
    mockGenerateId.mockReturnValue('11111111-2222-4333-8444-555566667777')
    expect(generateColumnId()).toBe('col_11111111222243338444555566667777')
  })

  it('produces an id that satisfies NAME_PATTERN (valid JSONB key / filter field)', () => {
    mockGenerateId.mockReturnValue('0a1b2c3d-4e5f-4607-8809-0a1b2c3d4e5f')
    // Must start with a letter/underscore and contain only [a-z0-9_].
    expect(generateColumnId()).toMatch(/^[a-z_][a-z0-9_]*$/i)
  })
})

describe('name ↔ id maps', () => {
  const schema: TableSchema = {
    columns: [
      { id: 'col_1', name: 'email', type: 'string' },
      { name: 'age', type: 'number' }, // legacy: id == name
    ],
  }

  it('buildIdByName maps display name → storage id', () => {
    expect(Object.fromEntries(buildIdByName(schema))).toEqual({ email: 'col_1', age: 'age' })
  })
  it('buildNameById maps storage id → display name', () => {
    expect(Object.fromEntries(buildNameById(schema))).toEqual({ col_1: 'email', age: 'age' })
  })
})

describe('row data translation', () => {
  const schema: TableSchema = {
    columns: [
      { id: 'col_1', name: 'email', type: 'string' },
      { name: 'age', type: 'number' },
    ],
  }
  const idByName = buildIdByName(schema)
  // The outbound half lives in `cell-format` (it also translates select values).
  const toNamedRow = namedRowMapper(schema.columns)

  it('round-trips name → id → name', () => {
    const wire = { email: 'a@b.c', age: 30 }
    const stored = rowDataNameToId(wire, idByName)
    expect(stored).toEqual({ col_1: 'a@b.c', age: 30 })
    expect(toNamedRow(stored)).toEqual(wire)
  })

  it('drops keys with no matching column (orphans / unknowns)', () => {
    expect(rowDataNameToId({ email: 'x', ghost: 1 }, idByName)).toEqual({ col_1: 'x' })
    expect(toNamedRow({ col_1: 'x', col_gone: 9 })).toEqual({ email: 'x' })
  })
})

describe('filter / sort translation', () => {
  const idByName = new Map([
    ['email', 'col_1'],
    ['age', 'col_2'],
  ])

  it('translates field names, recurses $or/$and, passes through unknown fields', () => {
    const filter = {
      email: 'a@b.c',
      $or: [{ age: { $gt: 18 } }, { createdAt: { $gt: '2024' } }],
    }
    expect(filterNamesToIds(filter, idByName)).toEqual({
      col_1: 'a@b.c',
      $or: [{ col_2: { $gt: 18 } }, { createdAt: { $gt: '2024' } }],
    })
  })

  it('translates sort field names, passes through unknown', () => {
    expect(sortNamesToIds({ email: 'asc', createdAt: 'desc' }, idByName)).toEqual({
      col_1: 'asc',
      createdAt: 'desc',
    })
  })
})

describe('withGeneratedColumnIds', () => {
  it('stamps ids on id-less columns and remaps group refs name → id', () => {
    mockGenerateId.mockReturnValueOnce('a').mockReturnValueOnce('b')
    const schema: TableSchema = {
      columns: [
        { name: 'email', type: 'string', workflowGroupId: 'g1' },
        { name: 'score', type: 'number', workflowGroupId: 'g1' },
      ],
      workflowGroups: [
        {
          id: 'g1',
          workflowId: 'wf',
          outputs: [{ blockId: 'b', path: 'p', columnName: 'score' }],
          dependencies: { columns: ['email'] },
          inputMappings: [{ inputName: 'in', columnName: 'email' }],
        },
      ],
    }
    const out = withGeneratedColumnIds(schema)
    expect(out.columns[0].id).toBe('col_a')
    expect(out.columns[1].id).toBe('col_b')
    const g = out.workflowGroups![0]
    expect(g.outputs[0].columnName).toBe('col_b') // score
    expect(g.dependencies!.columns).toEqual(['col_a']) // email
    expect(g.inputMappings![0].columnName).toBe('col_a')
  })

  it('is idempotent for columns that already have an id', () => {
    const schema: TableSchema = {
      columns: [{ id: 'col_keep', name: 'email', type: 'string' }],
    }
    expect(withGeneratedColumnIds(schema).columns[0].id).toBe('col_keep')
  })
})

describe('remapGroupColumnRefs', () => {
  it('rewrites refs that are names, leaves refs that are already ids', () => {
    const idByName = new Map([['email', 'col_1']])
    const group: WorkflowGroup = {
      id: 'g',
      workflowId: 'wf',
      outputs: [{ blockId: 'b', path: 'p', columnName: 'email' }],
      dependencies: { columns: ['col_existing'] },
    }
    const out = remapGroupColumnRefs(group, idByName)
    expect(out.outputs[0].columnName).toBe('col_1')
    expect(out.dependencies!.columns).toEqual(['col_existing'])
  })
})

describe('remapViewConfigColumnRefs', () => {
  const idByName = new Map([
    ['Name', 'col_a'],
    ['Email', 'col_b'],
  ])
  const config = {
    columnOrder: ['Email', 'col_a'],
    pinnedColumns: ['Email'],
    hiddenColumns: ['Name'],
    columnWidths: { Name: 180, col_b: 240 },
    sort: [{ field: 'Name', direction: 'asc' as const }],
    filter: { all: [{ field: 'Email', op: 'eq' as const, value: 'x' }] },
  }

  it('rewrites every column reference and leaves an already-mapped ref alone', () => {
    expect(remapViewConfigColumnRefs(config, idByName)).toEqual({
      columnOrder: ['col_b', 'col_a'],
      pinnedColumns: ['col_b'],
      hiddenColumns: ['col_a'],
      columnWidths: { col_a: 180, col_b: 240 },
      sort: [{ field: 'col_a', direction: 'asc' }],
      filter: { all: [{ field: 'col_b', op: 'eq', value: 'x' }] },
    })
  })

  it('inverts cleanly, which is what makes the write/read pair symmetric', () => {
    const nameById = new Map([...idByName].map(([name, id]) => [id, name]))
    const stored = remapViewConfigColumnRefs(config, idByName)
    expect(remapViewConfigColumnRefs(stored, nameById)).toEqual({
      columnOrder: ['Email', 'Name'],
      pinnedColumns: ['Email'],
      hiddenColumns: ['Name'],
      columnWidths: { Name: 180, Email: 240 },
      sort: [{ field: 'Name', direction: 'asc' }],
      filter: { all: [{ field: 'Email', op: 'eq', value: 'x' }] },
    })
  })

  it('leaves a system row column and a since-deleted ref untouched', () => {
    const out = remapViewConfigColumnRefs(
      { sort: [{ field: 'createdAt', direction: 'desc' }], hiddenColumns: ['col_gone'] },
      idByName
    )
    expect(out.sort).toEqual([{ field: 'createdAt', direction: 'desc' }])
    expect(out.hiddenColumns).toEqual(['col_gone'])
  })

  it('leaves absent keys absent rather than materializing empty ones', () => {
    expect(remapViewConfigColumnRefs({}, idByName)).toEqual({})
  })
})
