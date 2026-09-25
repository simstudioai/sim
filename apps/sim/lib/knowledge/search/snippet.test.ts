import { describe, expect, it } from 'vitest'
import {
  findTermMatches,
  matchSnippet,
  passageWindow,
  SNIPPET_LENGTH,
  stripLeadingHeaders,
} from '@/lib/knowledge/search/snippet'

const EMAIL = [
  'Subject: Invoice #1010 is overdue',
  'From: Support <support@example.com>',
  'To: Someone <someone@example.com>',
  'Messages: 1',
  '',
  `${'Thanks for your patience. '.repeat(12)}The Volvo order shipped on Monday and the tracking number follows. ${'More text here. '.repeat(20)}`,
].join('\n')

const EVENT = ['Title: Weekly sync', 'Organizer: Ada', 'When: Monday 9am', 'Where: Room 4'].join(
  '\n'
)

describe('stripLeadingHeaders', () => {
  it('drops the header block a connector writes above an email body', () => {
    expect(stripLeadingHeaders(EMAIL).startsWith('\nThanks for your patience.')).toBe(true)
  })

  it('keeps a chunk that is nothing but fields, such as a calendar event', () => {
    expect(stripLeadingHeaders(EVENT)).toBe(EVENT)
    expect(stripLeadingHeaders(`${EVENT}\n\n`)).toBe(`${EVENT}\n\n`)
  })
})

describe('findTermMatches', () => {
  it('matches whole words in any script', () => {
    expect(findTermMatches('Der Bericht über Zürich.', ['Zürich'])).toEqual([
      { index: 17, length: 6 },
    ])
    expect(findTermMatches('Reports on Zürichsee.', ['Zürich'])).toEqual([])
    expect(findTermMatches('東京の天気', ['天気'])).toEqual([{ index: 3, length: 2 }])
  })

  it('reads whole characters beside a hit, not code units', () => {
    expect(findTermMatches('𝔘nicode volvo𝔘 volvo', ['volvo'])).toEqual([{ index: 17, length: 5 }])
  })
})

describe('matchSnippet', () => {
  it.each([
    {
      query: 'Where is the updated backup meeting location for Birch?',
      title: 'Project Birch field kit',
      answer: 'The backup meeting location has changed to the Juniper room.',
      expected: 'Juniper room',
    },
    {
      query: 'Where are the Cedar pilot kits stored?',
      title: 'Project Cedar — Demo handbook',
      answer: 'Equipment pickup: Pilot kits are stored in Room 2B.',
      expected: 'Room 2B',
    },
    {
      query: 'Who owns the Cedar demo checklist?',
      title: 'Project Cedar — Demo decisions',
      answer: 'The owner of the demo checklist is Riley Chen.',
      expected: 'Riley Chen',
    },
  ])(
    'shows the relevant passage past an early title match: $query',
    ({ query, title, answer, expected }) => {
      const content = `${title}\n\n${'Background information. '.repeat(20)}${answer} ${'Further context. '.repeat(20)}`
      const snippet = matchSnippet(content, query)
      expect(snippet).toContain(expected)
      expect(snippet.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 2)
    }
  )

  it('never splits a surrogate pair at a window edge', () => {
    const emoji = `${'🙂'.repeat(200)} volvo ${'🙂'.repeat(200)}`
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const snippet of [matchSnippet(emoji, 'volvo'), matchSnippet(emoji, 'none')]) {
      expect(loneSurrogate.test(snippet)).toBe(false)
    }
  })
})

describe('verbatim model passages', () => {
  it('reassembles long Unicode chunks without splitting characters or losing text', () => {
    const content = '中é🔎\n  code();\n'.repeat(1900)
    let position = 0
    let rebuilt = ''
    while (position < content.length) {
      const page = passageWindow(content, position, 8000)
      expect(page.content.isWellFormed()).toBe(true)
      expect(Buffer.byteLength(page.content)).toBeLessThanOrEqual(24000)
      expect(page.endOffset).toBeGreaterThan(position)
      rebuilt += page.content
      position = page.endOffset
    }
    expect(rebuilt).toBe(content)
  })
})
