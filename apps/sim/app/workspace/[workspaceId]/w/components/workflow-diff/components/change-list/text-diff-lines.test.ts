/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildDiffRows,
  capOneSided,
  type DiffLine,
  foldRows,
  MAX_DIFF_LINES,
  markWordChanges,
  ONE_SIDED_VISIBLE_LINES,
  splitLines,
  toLines,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/text-diff-lines'

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

    /* Whitespace is its own token, so the unchanged space between them stays unmarked. */
    expect(removed.parts?.filter((part) => part.changed).map((part) => part.value)).toEqual([
      'one',
      'sentence',
    ])
    expect(added.parts?.filter((part) => part.changed).map((part) => part.value)).toEqual([
      'two',
      'sentences',
    ])
  })

  it('keeps an indentation-only edit visible', () => {
    const [removed, added] = markWordChanges([
      { kind: 'removed', text: '    return result' },
      { kind: 'added', text: '        return result' },
    ])

    expect(removed.parts?.map((part) => part.value).join('')).toBe('    return result')
    expect(added.parts?.map((part) => part.value).join('')).toBe('        return result')
    expect(added.parts?.some((part) => part.changed)).toBe(true)
  })

  it('leaves a rewrite and an oversized pair as plain lines', () => {
    const rewrite = markWordChanges([
      { kind: 'removed', text: 'alpha beta gamma' },
      { kind: 'added', text: 'one two three four' },
    ])
    expect(rewrite.every((line) => line.parts === undefined)).toBe(true)

    const huge = markWordChanges([
      { kind: 'removed', text: 'a '.repeat(3000) },
      { kind: 'added', text: `${'a '.repeat(2999)}b` },
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

  it('never caps two identical long bodies as if they were new', () => {
    const body = Array.from({ length: ONE_SIDED_VISIBLE_LINES + 5 }, (_, i) => `l${i}`).join('\n')
    const rows = buildDiffRows(body, body)
    expect(rows.some((row) => row.type === 'tail')).toBe(false)
    expect(rows.every((row) => row.type === 'line' || row.type === 'fold')).toBe(true)
    expect(buildDiffRows('', '')).toEqual([])
  })

  it('summarizes bodies too long to diff inline', () => {
    const lines = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `a${i}`).join('\n')
    expect(buildDiffRows(lines, `${lines}\nb`)).toEqual([
      { type: 'oversized', oldLines: MAX_DIFF_LINES, newLines: MAX_DIFF_LINES + 1 },
    ])
  })
  it('gives up on word marks for a heavily rewritten pair instead of diffing it word by word', () => {
    const before = Array.from({ length: 150 }, (_, i) => `alpha${i}`).join(' ')
    const after = Array.from({ length: 150 }, (_, i) => `beta${i}`).join(' ')
    const lines = markWordChanges(toLines(before, after))

    expect(lines.map((line) => line.kind)).toEqual(['removed', 'added'])
    expect(lines.every((line) => line.parts === undefined)).toBe(true)
  })
  it('reads CRLF and bare CR endings as line breaks', () => {
    const rows = buildDiffRows('a\r\nb\rc', 'a\nb\nd')

    expect(
      rows.map((row) => (row.type === 'line' ? [row.line.kind, row.line.text] : row.type))
    ).toEqual([
      ['context', 'a'],
      ['context', 'b'],
      ['removed', 'c'],
      ['added', 'd'],
    ])
  })
})
