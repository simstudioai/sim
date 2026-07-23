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

import {
  buildIdByName,
  buildNameById,
  filterNamesToIds,
  generateColumnId,
  getColumnId,
  nameShadowsColumnId,
  remapGroupColumnRefs,
  rowDataIdToName,
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

  it('buildIdByName maps lowercased display name → storage id', () => {
    expect(Object.fromEntries(buildIdByName(schema))).toEqual({ email: 'col_1', age: 'age' })
    const mixed: TableSchema = { columns: [{ id: 'col_9', name: 'First Name', type: 'string' }] }
    expect(Object.fromEntries(buildIdByName(mixed))).toEqual({ 'first name': 'col_9' })
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
  const nameById = buildNameById(schema)

  it('round-trips name → id → name', () => {
    const wire = { email: 'a@b.c', age: 30 }
    const stored = rowDataNameToId(wire, idByName)
    expect(stored).toEqual({ col_1: 'a@b.c', age: 30 })
    expect(rowDataIdToName(stored, nameById)).toEqual(wire)
  })

  it('drops keys with no matching column (orphans / unknowns)', () => {
    expect(rowDataNameToId({ email: 'x', ghost: 1 }, idByName)).toEqual({ col_1: 'x' })
    expect(rowDataIdToName({ col_1: 'x', col_gone: 9 }, nameById)).toEqual({ email: 'x' })
  })

  it('matches wire keys case-insensitively instead of silently dropping them', () => {
    expect(rowDataNameToId({ EMAIL: 'x', Age: 1 }, idByName)).toEqual({ col_1: 'x', age: 1 })
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

  it('matches filter/sort fields case-insensitively, preserving unknown keys verbatim', () => {
    expect(filterNamesToIds({ EMAIL: 'x', Ghost: 1 }, idByName)).toEqual({ col_1: 'x', Ghost: 1 })
    expect(sortNamesToIds({ Email: 'asc' }, idByName)).toEqual({ col_1: 'asc' })
  })
})

describe('nameShadowsColumnId', () => {
  const columns: TableSchema['columns'] = [
    { id: 'col_abc', name: 'email', type: 'string' },
    { name: 'age', type: 'number' }, // legacy: storage key is the name
  ]

  it('flags a name equal to another column storage key', () => {
    expect(nameShadowsColumnId(columns, 'col_abc')).toBe(true)
    expect(nameShadowsColumnId(columns, 'age')).toBe(true)
    expect(nameShadowsColumnId(columns, 'First Name')).toBe(false)
  })

  it('excludes the column being renamed', () => {
    expect(nameShadowsColumnId(columns, 'age', 1)).toBe(false)
    expect(nameShadowsColumnId(columns, 'col_abc', 1)).toBe(true)
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
