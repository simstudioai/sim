/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  dedupeOverlappingWorkflowSearchMatches,
  OVERLAPPING_MATCH_KIND_PRIORITY,
  workflowSearchMatchMatchesQuery,
} from '@/lib/workflows/search-replace/resources/resolvers'
import type {
  WorkflowSearchMatch,
  WorkflowSearchMatchKind,
} from '@/lib/workflows/search-replace/types'

function createMatch(overrides: Partial<WorkflowSearchMatch>): WorkflowSearchMatch {
  return {
    id: 'match',
    blockId: 'block-1',
    blockName: 'Block',
    blockType: 'function',
    subBlockId: 'code',
    canonicalSubBlockId: 'code',
    subBlockType: 'code',
    valuePath: [],
    target: { kind: 'subblock' },
    kind: 'text',
    rawValue: '',
    searchText: '',
    editable: true,
    navigable: true,
    protected: false,
    ...overrides,
  }
}

describe('dedupeOverlappingWorkflowSearchMatches', () => {
  it('keeps the narrower text hit when a partial literal query overlaps an inline reference', () => {
    const textMatch = createMatch({
      id: 'text-partial',
      kind: 'text',
      rawValue: '<start.h',
      searchText: "return '<start.hello>'",
      range: { start: 8, end: 16 },
    })
    const referenceMatch = createMatch({
      id: 'workflow-reference',
      kind: 'workflow-reference',
      rawValue: '<start.hello>',
      searchText: 'start.hello',
      range: { start: 8, end: 21 },
      resource: { kind: 'workflow-reference', token: '<start.hello>', key: 'start.hello' },
    })

    expect(dedupeOverlappingWorkflowSearchMatches([textMatch, referenceMatch])).toEqual([textMatch])
  })

  it('keeps the inline reference when it covers the same span as a text hit', () => {
    const textMatch = createMatch({
      id: 'text-full',
      kind: 'text',
      rawValue: '<start.hello>',
      searchText: "return '<start.hello>'",
      range: { start: 8, end: 21 },
    })
    const referenceMatch = createMatch({
      id: 'workflow-reference',
      kind: 'workflow-reference',
      rawValue: '<start.hello>',
      searchText: 'start.hello',
      range: { start: 8, end: 21 },
      resource: { kind: 'workflow-reference', token: '<start.hello>', key: 'start.hello' },
    })

    expect(dedupeOverlappingWorkflowSearchMatches([textMatch, referenceMatch])).toEqual([
      referenceMatch,
    ])
  })

  it('uses kind priority rather than iteration order for equal-span non-text matches', () => {
    const workflowReferenceMatch = createMatch({
      id: 'workflow-reference',
      kind: 'workflow-reference',
      rawValue: '{{API_KEY}}',
      searchText: 'API_KEY',
      range: { start: 0, end: 11 },
      resource: { kind: 'workflow-reference', token: '{{API_KEY}}', key: 'API_KEY' },
    })
    const environmentMatch = createMatch({
      id: 'environment',
      kind: 'environment',
      rawValue: '{{API_KEY}}',
      searchText: 'API_KEY',
      range: { start: 0, end: 11 },
      resource: { kind: 'environment', token: '{{API_KEY}}', key: 'API_KEY' },
    })

    expect(
      dedupeOverlappingWorkflowSearchMatches([workflowReferenceMatch, environmentMatch])
    ).toEqual([workflowReferenceMatch])
    expect(
      dedupeOverlappingWorkflowSearchMatches([environmentMatch, workflowReferenceMatch])
    ).toEqual([workflowReferenceMatch])
  })

  it('does not collapse matches from different fields', () => {
    const firstMatch = createMatch({
      id: 'first',
      range: { start: 0, end: 4 },
      valuePath: ['first'],
    })
    const secondMatch = createMatch({
      id: 'second',
      range: { start: 0, end: 4 },
      valuePath: ['second'],
    })

    expect(dedupeOverlappingWorkflowSearchMatches([firstMatch, secondMatch])).toEqual([
      firstMatch,
      secondMatch,
    ])
  })

  /**
   * The bucketed dedupe replaced an O(n^2) linear rescan. This pins it to a
   * transcription of the original algorithm over randomized inputs, so any
   * divergence in which overlapping match wins shows up as a diff rather than
   * as a subtly wrong result the fixed examples above would miss.
   */
  describe('bucketed dedupe matches the original linear scan', () => {
    function scopeKey(match: WorkflowSearchMatch): string | null {
      if (!match.range) return null
      if (match.target.kind !== 'subblock') return null
      const path = match.valuePath.map((s) => `${typeof s}:${String(s)}`).join('/')
      return [match.blockId, match.subBlockId, path].join(':')
    }

    function rangeLength(match: WorkflowSearchMatch): number {
      return match.range ? match.range.end - match.range.start : Number.POSITIVE_INFINITY
    }

    function prefers(candidate: WorkflowSearchMatch, current: WorkflowSearchMatch): boolean {
      const a = rangeLength(candidate)
      const b = rangeLength(current)
      if (a !== b) return a < b
      const pa = OVERLAPPING_MATCH_KIND_PRIORITY[candidate.kind]
      const pb = OVERLAPPING_MATCH_KIND_PRIORITY[current.kind]
      if (pa !== pb) return pa > pb
      return false
    }

    /** Straight transcription of the pre-optimization implementation. */
    function referenceDedupe(matches: WorkflowSearchMatch[]): WorkflowSearchMatch[] {
      const deduped: WorkflowSearchMatch[] = []
      for (const match of matches) {
        const key = scopeKey(match)
        const range = match.range
        const existingIndex =
          key && range
            ? deduped.findIndex(
                (candidate) =>
                  scopeKey(candidate) === key &&
                  candidate.range &&
                  candidate.range.start < range.end &&
                  range.start < candidate.range.end
              )
            : -1
        if (existingIndex === -1) {
          deduped.push(match)
          continue
        }
        if (prefers(match, deduped[existingIndex])) deduped[existingIndex] = match
      }
      return deduped
    }

    /** Deterministic PRNG so a failure is reproducible from the seed alone. */
    function makeRandom(seed: number) {
      let state = seed
      return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        return state / 0x7fffffff
      }
    }

    const KINDS = Object.keys(OVERLAPPING_MATCH_KIND_PRIORITY) as WorkflowSearchMatchKind[]

    function randomMatches(seed: number, count: number): WorkflowSearchMatch[] {
      const random = makeRandom(seed)
      const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)]
      return Array.from({ length: count }, (_, index) => {
        const start = Math.floor(random() * 30)
        const hasRange = random() > 0.15
        // Degenerate spans too: the bucketed scan keys off range arithmetic, so
        // the oracle has to defend inverted, empty and non-finite ends as well.
        const degenerate = random()
        const end =
          degenerate > 0.98
            ? Number.NaN
            : degenerate > 0.96
              ? Number.POSITIVE_INFINITY
              : degenerate > 0.94
                ? Number.NEGATIVE_INFINITY
                : degenerate > 0.91
                  ? start - 1 - Math.floor(random() * 3)
                  : degenerate > 0.88
                    ? start
                    : start + 1 + Math.floor(random() * 8)
        const isSubBlockTarget = random() > 0.15
        return createMatch({
          id: `m-${index}`,
          blockId: pick(['b1', 'b2', 'b3']),
          subBlockId: pick(['s1', 's2']),
          valuePath: pick([[], ['content'], [0], ['rows', 1]]),
          kind: pick(KINDS),
          target: isSubBlockTarget ? { kind: 'subblock' } : { kind: 'block-name' },
          range: hasRange ? { start, end } : undefined,
        })
      })
    }

    /**
     * A sequential sweep, not a handful of hand-picked seeds. An earlier version
     * pinned 8 seeds that happened to be clean while 7.7% of the space diverged,
     * so the count is what gives this test its power - keep it wide.
     */
    it('agrees with the original scan across 400 seeded inputs', () => {
      const diverged: number[] = []

      for (let seed = 1; seed <= 400; seed++) {
        const matches = randomMatches(seed, 120)
        const actual = dedupeOverlappingWorkflowSearchMatches(matches).map((m) => m.id)
        const expected = referenceDedupe(matches).map((m) => m.id)
        if (actual.join('|') !== expected.join('|')) diverged.push(seed)
      }

      expect(diverged).toEqual([])
    })

    /**
     * The exact shape that broke the `maxEnd` short-circuit: a shorter range
     * evicts a longer one but ends further right, so a stale `maxEnd` let the
     * next match skip the overlap scan and leak through as a duplicate.
     */
    it.each([
      {
        name: 'shorter replacement ends further right',
        spans: [
          { kind: 'workflow-reference' as const, start: 0, end: 13 },
          { kind: 'environment' as const, start: 10, end: 17 },
          { kind: 'text' as const, start: 13, end: 16 },
        ],
      },
      {
        name: 'replacement extends past the evicted range',
        spans: [
          { kind: 'text' as const, start: 0, end: 10 },
          { kind: 'environment' as const, start: 5, end: 15 },
          { kind: 'text' as const, start: 10, end: 14 },
        ],
      },
    ])('collapses overlaps when a $name', ({ spans }) => {
      const matches = spans.map((span, index) =>
        createMatch({
          id: `span-${index}`,
          blockId: 'b1',
          subBlockId: 's1',
          valuePath: [],
          kind: span.kind,
          range: { start: span.start, end: span.end },
        })
      )

      expect(dedupeOverlappingWorkflowSearchMatches(matches).map((m) => m.id)).toEqual(
        referenceDedupe(matches).map((m) => m.id)
      )
      expect(dedupeOverlappingWorkflowSearchMatches(matches)).toHaveLength(1)
    })

    it('agrees when a positive-infinity range contains a later range', () => {
      const matches = [
        createMatch({
          id: 'unbounded',
          kind: 'workflow-reference',
          range: { start: 0, end: Number.POSITIVE_INFINITY },
        }),
        createMatch({
          id: 'inside',
          kind: 'text',
          range: { start: 1, end: 2 },
        }),
      ]

      expect(dedupeOverlappingWorkflowSearchMatches(matches).map((match) => match.id)).toEqual(
        referenceDedupe(matches).map((match) => match.id)
      )
      expect(dedupeOverlappingWorkflowSearchMatches(matches).map((match) => match.id)).toEqual([
        'inside',
      ])
    })

    it.each([0, 1])('agrees on a %i-element input', (count) => {
      const matches = randomMatches(5, count)

      expect(dedupeOverlappingWorkflowSearchMatches(matches).map((m) => m.id)).toEqual(
        referenceDedupe(matches).map((m) => m.id)
      )
    })

    /**
     * The bucketed scan is still linear *within* one scope, so a single field
     * holding many non-overlapping hits is the residual worst case. It stays
     * cheap because the inner loop is two integer comparisons - the old code
     * rebuilt a scope-key string per candidate, which is where the 100x went.
     */
    it('agrees when one scope holds many non-overlapping ranges', () => {
      const matches = Array.from({ length: 300 }, (_, index) =>
        createMatch({
          id: `disjoint-${index}`,
          blockId: 'b1',
          subBlockId: 'code',
          valuePath: [],
          kind: 'text',
          range: { start: index * 4, end: index * 4 + 1 },
        })
      )

      expect(dedupeOverlappingWorkflowSearchMatches(matches)).toHaveLength(300)
      expect(dedupeOverlappingWorkflowSearchMatches(matches).map((m) => m.id)).toEqual(
        referenceDedupe(matches).map((m) => m.id)
      )
    })

    /**
     * Pins the asymptotics, not a stopwatch. 20k disjoint hits in one scope run
     * in single-digit ms bucketed; the O(n^2) rescan this replaced took ~30s on
     * the same input, so the bound has roughly three orders of magnitude of
     * headroom and only trips on a genuine complexity regression.
     */
    it('stays sub-quadratic on a single scope full of disjoint ranges', () => {
      const matches = Array.from({ length: 20_000 }, (_, index) =>
        createMatch({
          id: `wide-${index}`,
          blockId: 'b1',
          subBlockId: 'code',
          valuePath: [],
          kind: 'text',
          range: { start: index * 4, end: index * 4 + 1 },
        })
      )

      const startedAt = performance.now()
      const deduped = dedupeOverlappingWorkflowSearchMatches(matches)

      expect(deduped).toHaveLength(20_000)
      expect(performance.now() - startedAt).toBeLessThan(2_000)
    })

    it('agrees when every match shares one scope and range', () => {
      const matches = Array.from({ length: 40 }, (_, index) =>
        createMatch({
          id: `same-${index}`,
          blockId: 'b1',
          subBlockId: 's1',
          valuePath: [],
          kind: index % 2 === 0 ? 'text' : 'table',
          range: { start: 0, end: 5 },
        })
      )

      expect(dedupeOverlappingWorkflowSearchMatches(matches).map((m) => m.id)).toEqual(
        referenceDedupe(matches).map((m) => m.id)
      )
    })
  })
})

describe('workflowSearchMatchMatchesQuery', () => {
  it('does not keep structured resource matches alive from only block or field label text', () => {
    const selectorMatch = createMatch({
      id: 'selector-resource',
      blockName: 'Testy',
      fieldTitle: 'Select Presentation',
      subBlockId: 'presentationId',
      subBlockType: 'file-selector',
      kind: 'file',
      rawValue: 'opaque-presentation-id',
      searchText: 'opaque-presentation-id',
      range: undefined,
      resource: { kind: 'file', key: 'opaque-presentation-id' },
    })

    expect(
      workflowSearchMatchMatchesQuery({ ...selectorMatch, displayLabel: 'Gucci Case' }, 'Test')
    ).toBe(false)
    expect(
      workflowSearchMatchMatchesQuery({ ...selectorMatch, displayLabel: 'Gucci Case' }, 'Gucci')
    ).toBe(true)
  })
})
