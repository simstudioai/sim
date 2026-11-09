import { describe, expect, it } from 'vitest'
import {
  filterAndCap,
  filterAndSort,
  fuzzyMatch,
} from '@/components/workspace-sidebar/components/search-modal/utils'

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
})

describe('secondary-text matching — no scattered noise', () => {
  it('does not scatter-match a query across long unrelated secondary text', () => {
    const items = [{ name: 'Write Contact', extra: 'Wealthbox Write Contact match snap up' }]

    expect(fuzzyMatch(items[0].extra, 'whatsapp').matched).toBe(true)
    expect(
      filterAndSort(
        items,
        (item) => item.name,
        'whatsapp',
        (item) => item.extra
      )
    ).toEqual([])
  })

  it('still matches secondary text by substring and by whole tokens', () => {
    const items = [{ name: 'Send Message', extra: 'Slack Send Message dm chat' }]

    expect(
      filterAndSort(
        items,
        (item) => item.name,
        'slack',
        (item) => item.extra
      )
    ).toHaveLength(1)
    expect(
      filterAndSort(
        items,
        (item) => item.name,
        'slack chat',
        (item) => item.extra
      )
    ).toHaveLength(1)
    expect(
      filterAndSort(
        items,
        (item) => item.name,
        'whatsapp',
        (item) => item.extra
      )
    ).toHaveLength(0)
  })
})

describe('filterAndCap', () => {
  const id = (s: string) => s

  it('never caps the empty (browse) state, even above the cap', () => {
    const items = Array.from({ length: 75 }, (_, i) => `item ${i}`)
    const result = filterAndCap(items, id, '')
    expect(result).toHaveLength(items.length)
    expect(result).toBe(items)
  })
})
