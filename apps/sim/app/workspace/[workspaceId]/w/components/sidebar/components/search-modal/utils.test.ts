/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { filterAndCap, filterAndSort, fuzzyMatch, MAX_RESULTS_PER_GROUP } from './utils'

/**
 * The matcher that shipped before fuzzy matching was introduced. Re-implemented
 * here verbatim so the new matcher can be proven a strict superset: anything the
 * old matcher returned, the new one must still return. This is the core
 * no-regression guarantee.
 */
function oldScoreMatch(value: string, search: string): number {
  if (!search) return 1
  const v = value.toLowerCase()
  const s = search.toLowerCase()
  if (v === s) return 1
  if (v.startsWith(s)) return 0.9
  if (v.includes(s)) return 0.7
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((w) => v.includes(w))) return 0.5
  return 0
}

function oldFilterAndSort<T>(items: T[], toValue: (item: T) => string, search: string): T[] {
  if (!search) return items
  const scored: [T, number][] = []
  for (const item of items) {
    const score = oldScoreMatch(toValue(item), search)
    if (score > 0) scored.push([item, score])
  }
  scored.sort((a, b) => b[1] - a[1])
  return scored.map(([item]) => item)
}

interface Entry {
  label: string
  /** The string the modal actually searches against (name + type/id junk). */
  value: string
}

/** Mirrors how groups build their `value` strings (name + slug/id suffix). */
function block(label: string, slug: string): Entry {
  return { label, value: `${label} ${slug} block-${slug}` }
}
function workflow(label: string, folder: string): Entry {
  return { label, value: `${label} ${folder} workflow-${slugUuid(label)}` }
}
function action(label: string, keywords: string): Entry {
  const id = label.toLowerCase().replace(/\s+/g, '-')
  return { label, value: `${label} ${keywords} action-${id}` }
}
function slugUuid(label: string): string {
  return `${label.toLowerCase().replace(/\s+/g, '')}-9f2a3b4c5d6e`
}

const CORPUS: Entry[] = [
  block('Slack', 'slack'),
  block('Gmail', 'gmail'),
  block('Google Sheets', 'google_sheets'),
  block('Google PageSpeed', 'google_pagespeed'),
  block('GitHub', 'github'),
  block('Notion', 'notion'),
  block('Postgres', 'postgresql'),
  block('OpenAI', 'openai'),
  block('Airtable', 'airtable'),
  block('HubSpot', 'hubspot'),
  block('Linear', 'linear'),
  block('Discord', 'discord'),
  block('Microsoft Teams', 'microsoft_teams'),
  block('Webhook', 'webhook'),
  block('Schedule', 'schedule'),
  block('Agent', 'agent'),
  block('Function', 'function'),
  block('Condition', 'condition'),
  block('Router', 'router'),
  block('Knowledge Base', 'knowledge'),
  workflow('Customer Onboarding Flow', 'Sales'),
  workflow('Daily Report', 'Ops'),
  workflow('Lead Enrichment', 'Sales'),
  action('Create workflow', 'new add build'),
  action('Create folder', 'new add group'),
  action('Import workflow', 'upload add'),
  action('Toggle theme', 'dark light mode appearance color'),
]

const toValue = (e: Entry) => e.value

/**
 * A broad sweep of realistic query shapes, grouped by intent: single chars,
 * exact-ish names, prefixes, contains/mid-word, multi-word, initialisms and
 * scattered (the new wins), typos, and genuine non-matches.
 */
const QUERIES = [
  's',
  'g',
  'a',
  'w',
  'slack',
  'gmail',
  'github',
  'notion',
  'postgres',
  'openai',
  'agent',
  'goog',
  'micro',
  'know',
  'cond',
  'rout',
  'sched',
  'hook',
  'table',
  'spot',
  'mail',
  'google sheets',
  'sheets google',
  'create workflow',
  'workflow create',
  'customer onboarding',
  'slk',
  'gps',
  'msteams',
  'crwf',
  'cwf',
  'kb',
  'githb',
  'postgrs',
  'zzz',
  'qqqq',
]

describe('fuzzyMatch / filterAndSort — no regression vs. old matcher', () => {
  it('returns a strict superset of the old matcher for every query (never loses a result)', () => {
    for (const query of QUERIES) {
      const oldLabels = new Set(oldFilterAndSort(CORPUS, toValue, query).map((e) => e.label))
      const newLabels = new Set(filterAndSort(CORPUS, toValue, query).map((e) => e.label))
      for (const label of oldLabels) {
        expect(
          newLabels.has(label),
          `query "${query}": new matcher dropped "${label}" that the old matcher returned`
        ).toBe(true)
      }
    }
  })

  it('preserves the old #1 result for exact/prefix/contains queries (no top-rank regression)', () => {
    const exactish = [
      'slack',
      'gmail',
      'github',
      'notion',
      'postgres',
      'openai',
      'agent',
      'goog',
      'micro',
      'know',
      'cond',
      'rout',
      'sched',
    ]
    for (const query of exactish) {
      const oldTop = oldFilterAndSort(CORPUS, toValue, query)[0]
      const newTop = filterAndSort(CORPUS, toValue, query)[0]
      if (oldTop) {
        expect(newTop?.label, `query "${query}" top result changed`).toBe(oldTop.label)
      }
    }
  })
})

describe('fuzzyMatch — new wins (initialisms & scattered)', () => {
  const wins: Array<[string, string]> = [
    ['slk', 'Slack'],
    ['gps', 'Google PageSpeed'],
    ['crwf', 'Create workflow'],
    ['msteams', 'Microsoft Teams'],
  ]
  for (const [query, expectedTop] of wins) {
    it(`"${query}" surfaces "${expectedTop}" as the top result`, () => {
      const results = filterAndSort(CORPUS, toValue, query)
      expect(results[0]?.label).toBe(expectedTop)
    })
  }

  it('finds initialisms the old matcher missed entirely (old returns 0 for "slk")', () => {
    expect(oldFilterAndSort(CORPUS, toValue, 'slk')).toHaveLength(0)
    expect(filterAndSort(CORPUS, toValue, 'slk').map((e) => e.label)).toContain('Slack')
  })
})

describe('fuzzyMatch — noise control', () => {
  it('rejects a mid-word scattered subsequence ("oge" in P-o-st-g-r-e-s is not a substring)', () => {
    expect(fuzzyMatch('Postgres', 'oge').matched).toBe(false)
  })

  it('ranks every "g"-prefixed result above results that only contain "g" deeper', () => {
    const results = filterAndSort(CORPUS, toValue, 'g')
    const labels = results.map((e) => e.label)
    const firstNonPrefix = labels.findIndex((l) => !l.toLowerCase().startsWith('g'))
    const lastPrefix = labels.reduce((acc, l, i) => (l.toLowerCase().startsWith('g') ? i : acc), -1)
    if (firstNonPrefix !== -1 && lastPrefix !== -1) {
      expect(lastPrefix).toBeLessThan(firstNonPrefix)
    }
  })

  it('returns no matches for genuine non-matches', () => {
    expect(filterAndSort(CORPUS, toValue, 'zzz')).toHaveLength(0)
    expect(filterAndSort(CORPUS, toValue, 'qqqq')).toHaveLength(0)
  })
})

describe('fuzzyMatch — positions for highlighting', () => {
  it('reports prefix match positions', () => {
    expect(fuzzyMatch('Slack', 'sla').positions).toEqual([0, 1, 2])
  })

  it('reports scattered match positions for "slk" against "Slack" (S, l, k)', () => {
    expect(fuzzyMatch('Slack', 'slk').positions).toEqual([0, 1, 4])
  })

  it('highlights the substring itself, not an earlier scattered occurrence', () => {
    const result = fuzzyMatch('a_apple', 'apple')
    expect(result.matched).toBe(true)
    expect(result.positions).toEqual([2, 3, 4, 5, 6])
  })

  it('highlights a mid-string substring at its real position', () => {
    expect(fuzzyMatch('Webhook', 'hook').positions).toEqual([3, 4, 5, 6])
  })

  it('reports empty positions for empty query', () => {
    const result = fuzzyMatch('Slack', '')
    expect(result.matched).toBe(true)
    expect(result.positions).toEqual([])
  })

  it('matches multi-word tokens order-independently', () => {
    const result = fuzzyMatch('Slack Send Message', 'message slack')
    expect(result.matched).toBe(true)
  })
})

describe('filterAndSort — name ranked above secondary text', () => {
  interface Item {
    name: string
    searchValue: string
  }
  const toName = (i: Item) => i.name
  const toExtra = (i: Item) => i.searchValue

  it('ranks an exact name match above a substring buried in another item’s option text', () => {
    const items: Item[] = [
      // Matches "agent" only inside a long secondary string (its model catalog).
      { name: 'Pi Coding Agent', searchValue: `Pi Coding Agent pi ${'model-x '.repeat(60)}` },
      // Exact name match, but an even longer secondary string.
      { name: 'Agent', searchValue: `Agent agent ${'claude-sonnet gpt-4o '.repeat(60)}` },
    ]
    const sorted = filterAndSort(items, toName, 'agent', toExtra)
    expect(sorted[0].name).toBe('Agent')
  })

  it('keeps every name match above every secondary-only match', () => {
    const items: Item[] = [
      { name: 'Zeta', searchValue: 'Zeta agent agent agent' }, // strong secondary hit, no name hit
      { name: 'Agent', searchValue: 'Agent agent' }, // name hit
    ]
    const sorted = filterAndSort(items, toName, 'agent', toExtra)
    expect(sorted[0].name).toBe('Agent')
  })

  it('still surfaces an item matched only by its secondary text', () => {
    const items: Item[] = [{ name: 'Agent', searchValue: 'Agent agent claude-sonnet gpt-4o' }]
    expect(filterAndSort(items, toName, 'gpt-4o', toExtra)).toHaveLength(1)
  })

  it('is byte-identical to single-field ranking when no secondary accessor is given', () => {
    const items = ['Slack message', 'Send message to Slack']
    expect(filterAndSort(items, (s) => s, 'slack')).toEqual(
      filterAndSort(items, (s) => s, 'slack', undefined)
    )
  })
})

describe('filterAndCap', () => {
  const id = (s: string) => s

  it('caps an active search to MAX_RESULTS_PER_GROUP', () => {
    const items = Array.from({ length: MAX_RESULTS_PER_GROUP + 25 }, (_, i) => `item ${i}`)
    expect(filterAndCap(items, id, 'item')).toHaveLength(MAX_RESULTS_PER_GROUP)
  })

  it('never caps the empty (browse) state, even above the cap', () => {
    const items = Array.from({ length: MAX_RESULTS_PER_GROUP + 25 }, (_, i) => `item ${i}`)
    const result = filterAndCap(items, id, '')
    expect(result).toHaveLength(items.length)
    expect(result).toBe(items)
  })

  it('treats whitespace-only input as browse: unfiltered and uncapped', () => {
    const items = Array.from({ length: MAX_RESULTS_PER_GROUP + 25 }, (_, i) => `item ${i}`)
    const result = filterAndCap(items, id, '   ')
    expect(result).toBe(items)
  })

  it('returns every match untrimmed when under the cap', () => {
    const items = ['Slack', 'Slate', 'Slalom']
    expect(filterAndCap(items, id, 'sl')).toHaveLength(3)
  })

  it('caps to the top-ranked matches, preserving filterAndSort order', () => {
    const items = Array.from({ length: MAX_RESULTS_PER_GROUP + 5 }, (_, i) => `item ${i}`)
    const capped = filterAndCap(items, id, 'item')
    expect(capped).toEqual(filterAndSort(items, id, 'item').slice(0, MAX_RESULTS_PER_GROUP))
  })
})
