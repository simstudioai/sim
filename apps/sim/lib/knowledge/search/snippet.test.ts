/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  findTermMatches,
  matchSnippet,
  queryTerms,
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

  it('leaves a document that does not start with headers alone', () => {
    expect(stripLeadingHeaders('Plain prose: with a colon inside.')).toBe(
      'Plain prose: with a colon inside.'
    )
  })

  it('keeps a chunk that is nothing but fields, such as a calendar event', () => {
    expect(stripLeadingHeaders(EVENT)).toBe(EVENT)
    expect(stripLeadingHeaders(`${EVENT}\n\n`)).toBe(`${EVENT}\n\n`)
  })
})

describe('queryTerms', () => {
  it('keeps distinct terms of three or more characters, longest first', () => {
    expect(queryTerms('the Volvo invoice is volvo')).toEqual(['invoice', 'Volvo', 'volvo', 'the'])
    expect(queryTerms(undefined)).toEqual([])
  })

  it('strips the quotes and punctuation around a term', () => {
    expect(queryTerms('"foo bar" (baz),')).toEqual(['foo', 'bar', 'baz'])
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

  it('skips a hit glued to another word character', () => {
    expect(findTermMatches('subvolvo volvo_x volvo', ['volvo'])).toEqual([{ index: 17, length: 5 }])
  })
})

describe('matchSnippet', () => {
  it('returns a short document whole, without its headers', () => {
    expect(matchSnippet('Subject: Hi\nFrom: A\n\nShort body.', 'body')).toBe('Short body.')
  })

  it('windows around the first query term with ellipses on both sides', () => {
    const snippet = matchSnippet(EMAIL, 'volvo')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('The Volvo order shipped')
    expect(snippet).not.toContain('Subject:')
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 2)
  })

  it('centres on a quoted phrase and on a non-ASCII term', () => {
    expect(matchSnippet(EMAIL, '"Volvo order"')).toContain('The Volvo order shipped')
    const german = `${'Einleitung. '.repeat(30)}Die Lieferung nach Zürich ist unterwegs. ${'Mehr. '.repeat(30)}`
    expect(matchSnippet(german, 'Zürich')).toContain('nach Zürich')
  })

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

  it('keeps the earliest passage when matching terms are equally specific', () => {
    const content = `Cedar information. ${'Background. '.repeat(40)}Birch information.`
    expect(matchSnippet(content, 'Birch Cedar')).toContain('Cedar information')
    expect(matchSnippet(content, 'Birch Cedar')).not.toContain('Birch information')
  })

  it('never splits a surrogate pair at a window edge', () => {
    const emoji = `${'🙂'.repeat(200)} volvo ${'🙂'.repeat(200)}`
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const snippet of [matchSnippet(emoji, 'volvo'), matchSnippet(emoji, 'none')]) {
      expect(loneSurrogate.test(snippet)).toBe(false)
    }
  })

  it('falls back to the opening when no term appears in the chunk', () => {
    const snippet = matchSnippet(EMAIL, 'unrelated')
    expect(snippet.startsWith('Thanks for your patience.')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })
})
