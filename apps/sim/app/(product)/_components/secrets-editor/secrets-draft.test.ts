import { describe, expect, it } from 'vitest'
import {
  appendPastedRows,
  duplicateRowKeys,
  mergeSecretsDraft,
  planSecretsPaste,
  planSecretsSave,
  rebaseAfterSecretsSave,
  removeSecretRow,
  sameSecretsDraft,
} from '@/app/(product)/_components/secrets-editor/secrets-draft'

const row = (id: number, key: string, value: string) => ({ id, key, value })
const EMPTY = row(1, '', '')

describe('planSecretsSave', () => {
  it('sends only what differs from the baseline', () => {
    const plan = planSecretsSave(
      { KEEP: '1', EDIT: 'old', DROP: 'x' },
      { variables: { KEEP: '1', EDIT: 'new' }, rows: [row(2, 'ADD', 'a'), EMPTY] }
    )
    expect(plan.upsert).toEqual({ EDIT: 'new', ADD: 'a' })
    expect(plan.remove).toEqual(['DROP'])
    expect(plan.changed).toBe(true)
  })

  it('reports no change for an untouched draft', () => {
    const plan = planSecretsSave({ A: '1' }, { variables: { A: '1' }, rows: [EMPTY] })
    expect(plan.changed).toBe(false)
  })

  it('leaves half-typed rows out of the write', () => {
    const plan = planSecretsSave({}, { variables: {}, rows: [row(2, 'ONLY_NAME', '')] })
    expect(plan.upsert).toEqual({})
    expect(plan.changed).toBe(false)
  })

  it('keeps a change made elsewhere that the draft never touched in the full set it leaves', () => {
    const plan = planSecretsSave(
      { MINE: 'old', THEIRS: 'old' },
      { variables: { MINE: 'new', THEIRS: 'old' }, rows: [EMPTY] },
      { MINE: 'old', THEIRS: 'changed elsewhere', ADDED: 'elsewhere' }
    )
    expect(plan.upsert).toEqual({ MINE: 'new' })
    expect(plan.saved).toEqual({ MINE: 'new', THEIRS: 'changed elsewhere', ADDED: 'elsewhere' })
  })

  it('removes a deleted secret and nothing else', () => {
    const plan = planSecretsSave(
      { KEEP: '1', GONE: '2' },
      { variables: { KEEP: '1' }, rows: [EMPTY] },
      { KEEP: '1', GONE: '2', NEWER: '3' }
    )
    expect(plan.upsert).toEqual({})
    expect(plan.remove).toEqual(['GONE'])
    expect(plan.saved).toEqual({ KEEP: '1', NEWER: '3' })
  })

  it('writes a prototype-named key as data, without touching the prototype', () => {
    const plan = planSecretsSave({}, { variables: {}, rows: [row(2, '__proto__', 'x')] })
    expect(Object.hasOwn(plan.upsert, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(plan.upsert)).toBe(Object.prototype)
  })
})

describe('rebaseAfterSecretsSave', () => {
  const submitted = { variables: { A: '1' }, rows: [row(2, 'NEW', 'n'), EMPTY] }
  const saved = { A: '1', NEW: 'n' }

  it('moves a saved row into the saved variables and leaves an empty row', () => {
    const next = rebaseAfterSecretsSave(submitted, submitted, saved)
    expect(next.variables).toEqual({ A: '1', NEW: 'n' })
    expect(next.rows.map((entry) => entry.id)).toEqual([EMPTY.id])
  })

  it('keeps a value typed into a variable while the save ran', () => {
    const current = { variables: { A: 'typed' }, rows: submitted.rows }
    expect(rebaseAfterSecretsSave(submitted, current, saved).variables.A).toBe('typed')
  })

  it('keeps a row added while the save ran', () => {
    const added = row(3, 'LATER', 'l')
    const current = { ...submitted, rows: [...submitted.rows, added] }
    expect(rebaseAfterSecretsSave(submitted, current, saved).rows).toContainEqual(added)
  })

  it('takes the newer value of a saved row edited while the save ran', () => {
    const current = { ...submitted, rows: [row(2, 'NEW', 'edited'), EMPTY] }
    expect(rebaseAfterSecretsSave(submitted, current, saved).variables.NEW).toBe('edited')
  })

  it('drops a saved row cleared while the save ran, so the draft stays unsaved', () => {
    const current = { ...submitted, rows: [row(2, '', ''), EMPTY] }
    const next = rebaseAfterSecretsSave(submitted, current, saved)
    expect(Object.hasOwn(next.variables, 'NEW')).toBe(false)
    expect(Object.keys(next.variables)).toEqual(['A'])
  })

  it('restores the prior value when a row that overwrote a variable was cleared', () => {
    const overwriting = { variables: { A: '1' }, rows: [row(2, 'A', 'over'), EMPTY] }
    const current = { ...overwriting, rows: [row(2, '', ''), EMPTY] }
    const next = rebaseAfterSecretsSave(overwriting, current, { A: 'over' })
    expect(next.variables.A).toBe('1')
  })

  it('never produces zero rows', () => {
    const only = { variables: {}, rows: [row(2, 'K', 'v')] }
    expect(rebaseAfterSecretsSave(only, only, { K: 'v' }).rows).toHaveLength(1)
  })
})

describe('mergeSecretsDraft', () => {
  const base = { variables: { A: '1', B: '2' }, rows: [EMPTY] }
  const theirs = { variables: { A: '1', B: '2', THEIRS: 't' }, rows: [] }

  it('keeps a key another admin added under an edit', () => {
    const mine = { ...base, variables: { A: 'mine', B: '2' } }
    expect(mergeSecretsDraft(mine, base, theirs).variables).toEqual({
      A: 'mine',
      B: '2',
      THEIRS: 't',
    })
  })

  it('keeps a delete and the rows being typed', () => {
    const typing = row(2, 'TYPING', '')
    const mine = { variables: { A: '1' }, rows: [typing] }
    const merged = mergeSecretsDraft(mine, base, theirs)
    expect(Object.hasOwn(merged.variables, 'B')).toBe(false)
    expect(merged.rows).toEqual([typing])
  })
})

describe('sameSecretsDraft', () => {
  const left = { variables: { A: '1' }, rows: [row(4, '', '')] }

  it('ignores blank rows and row identity', () => {
    expect(sameSecretsDraft(left, { variables: { A: '1' }, rows: [] })).toBe(true)
  })

  it('counts a new row that repeats a saved secret as an edit, so the row is never dropped', () => {
    const saved = { variables: { FOO: 'a' }, rows: [EMPTY] }
    expect(sameSecretsDraft(saved, { ...saved, rows: [row(5, 'FOO', 'a'), EMPTY] })).toBe(false)
  })

  it('counts a second row with the same name and value as different from one', () => {
    const one = { variables: {}, rows: [row(5, 'FOO', 'a')] }
    expect(
      sameSecretsDraft(one, { variables: {}, rows: [row(5, 'FOO', 'a'), row(6, 'FOO', 'a')] })
    ).toBe(false)
  })

  it('counts a half-typed row and a changed value as different', () => {
    expect(sameSecretsDraft(left, { ...left, rows: [row(4, 'K', '')] })).toBe(false)
    expect(sameSecretsDraft(left, { ...left, variables: { A: '2' } })).toBe(false)
    expect(sameSecretsDraft(left, { ...left, variables: { A: '1', B: '2' } })).toBe(false)
  })
})

describe('duplicateRowKeys', () => {
  it('names a secret typed into two new rows, which a save would collapse into one', () => {
    expect([
      ...duplicateRowKeys([row(2, 'FOO', 'x'), row(3, 'FOO', 'y'), row(4, 'BAR', 'z')]),
    ]).toEqual(['FOO'])
  })

  it('ignores blank names', () => {
    expect(duplicateRowKeys([row(2, '', 'x'), row(3, '', 'y')]).size).toBe(0)
  })
})

describe('removeSecretRow', () => {
  it('deletes the row and leaves one empty row to type into', () => {
    const rows = removeSecretRow([row(2, 'A', '1'), row(3, 'B', '2'), EMPTY], 0)
    expect(rows.map((entry) => entry.key)).toEqual(['B', ''])
  })

  it('adds an empty row when the last row is deleted', () => {
    const rows = removeSecretRow([row(2, 'A', '1')], 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: '', value: '' })
  })
})

describe('planSecretsPaste', () => {
  it('refuses a paste with more rows than the limit, whole', () => {
    expect(planSecretsPaste('A=1\nB=2\nC=3', 2)).toEqual({ kind: 'too-many' })
  })

  it('takes over KEY=VALUE lines as rows, skipping comments', () => {
    const paste = planSecretsPaste('# comment\nA=1\nexport B="two"', 10)
    expect(paste.kind).toBe('rows')
    if (paste.kind !== 'rows') return
    expect(paste.rows.map(({ key, value }) => [key, value])).toEqual([
      ['A', '1'],
      ['B', 'two'],
    ])
  })

  it('leaves plain text and empty-valued patterns to the native paste', () => {
    expect(planSecretsPaste('just a value', 10)).toEqual({ kind: 'native' })
    expect(planSecretsPaste('A=', 10)).toEqual({ kind: 'native' })
    expect(planSecretsPaste('   ', 10)).toEqual({ kind: 'native' })
  })

  it('puts pasted rows after the typed ones, with an empty row to follow', () => {
    const rows = appendPastedRows([row(2, 'A', '1'), EMPTY], [row(3, 'B', '2')])
    expect(rows.map((entry) => entry.key)).toEqual(['A', 'B', ''])
  })
})
