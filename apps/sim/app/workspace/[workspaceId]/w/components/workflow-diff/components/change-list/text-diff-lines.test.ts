/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildDiffRows,
  capOneSided,
  type DiffLine,
  foldRows,
  markWordChanges,
  ONE_SIDED_VISIBLE_LINES,
  splitLines,
  toLines,
} from './text-diff-lines'

const context = (count: number): DiffLine[] =>
  Array.from({ length: count }, (_, index) => ({ kind: 'context', text: `ctx ${index}` }))

describe('splitLines and toLines', () => {
  it('drops only the trailing newline and keeps interior blank lines', () => {
    expect(splitLines('')).toEqual([''])
    expect(splitLines('a\n')).toEqual(['a'])
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b'])
  })

  it('flattens a line diff into kinds', () => {
    expect(toLines('a\nb\n', 'a\nc\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'c' },
    ])
  })
})

describe('foldRows', () => {
  it('keeps two lines of context on each side of a change and folds the rest', () => {
    const rows = foldRows([...context(6), { kind: 'added', text: 'x' }, ...context(6)])

    expect(rows.map((row) => row.type)).toEqual([
      'fold',
      'line',
      'line',
      'line',
      'line',
      'line',
      'fold',
    ])
    expect(rows[0]).toMatchObject({ type: 'fold', lines: context(6).slice(0, 4) })
    expect(rows[6]).toMatchObject({ type: 'fold', lines: context(6).slice(2) })
  })

  it('never folds a run too short to be worth it', () => {
    const rows = foldRows([...context(3), { kind: 'removed', text: 'x' }, ...context(5)])
    expect(rows.every((row) => row.type === 'line')).toBe(true)
  })
})

describe('markWordChanges', () => {
  it('marks the words that differ when most of a line pair survived', () => {
    const [removed, added] = markWordChanges([
      { kind: 'removed', text: 'reply warmly in one sentence' },
      { kind: 'added', text: 'reply warmly in two sentences' },
    ])

    /* Adjacent changed words come back as one run. */
    expect(removed.parts?.filter((part) => part.changed).map((part) => part.value)).toEqual([
      'one sentence',
    ])
    expect(added.parts?.filter((part) => part.changed).map((part) => part.value)).toEqual([
      'two sentences',
    ])
  })

  it('leaves a rewrite and an oversized pair as plain lines', () => {
    const rewrite = markWordChanges([
      { kind: 'removed', text: 'alpha beta gamma' },
      { kind: 'added', text: 'one two three four' },
    ])
    expect(rewrite.every((line) => line.parts === undefined)).toBe(true)

    const huge = markWordChanges([
      { kind: 'removed', text: 'a '.repeat(3000) },
      { kind: 'added', text: 'a '.repeat(2999) + 'b' },
    ])
    expect(huge.every((line) => line.parts === undefined)).toBe(true)
  })

  it('pairs only as many lines as both runs have', () => {
    const lines = markWordChanges([
      { kind: 'removed', text: 'keep this one' },
      { kind: 'removed', text: 'keep this two' },
      { kind: 'added', text: 'keep this three' },
    ])
    expect(lines[0].parts).toBeDefined()
    expect(lines[1].parts).toBeUndefined()
    expect(lines[2].parts).toBeDefined()
  })
})

describe('capOneSided', () => {
  it('tucks a long one-sided body behind one tail row and folds mixed bodies normally', () => {
    const added = Array.from({ length: ONE_SIDED_VISIBLE_LINES + 3 }, (_, index) => ({
      kind: 'added' as const,
      text: `line ${index}`,
    }))
    const rows = capOneSided(added)
    expect(rows).toHaveLength(ONE_SIDED_VISIBLE_LINES + 1)
    expect(rows[ONE_SIDED_VISIBLE_LINES]).toMatchObject({ type: 'tail' })
    expect(rows[ONE_SIDED_VISIBLE_LINES]).toHaveProperty('lines.length', 3)

    expect(
      capOneSided(added.slice(0, ONE_SIDED_VISIBLE_LINES)).every((row) => row.type === 'line')
    ).toBe(true)
    expect(
      capOneSided([...added, { kind: 'context', text: 'c' }]).some((row) => row.type === 'tail')
    ).toBe(false)
  })
})

describe('buildDiffRows', () => {
  it('renders a brand new body as added lines only', () => {
    expect(buildDiffRows('', 'return 1\n')).toEqual([
      { type: 'line', line: { kind: 'added', text: 'return 1' } },
    ])
  })
})
