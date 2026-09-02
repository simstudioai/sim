/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  matchSnippet,
  SNIPPET_LENGTH,
  snippetTerms,
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

describe('stripLeadingHeaders', () => {
  it('drops the header block a connector writes above an email body', () => {
    expect(stripLeadingHeaders(EMAIL).startsWith('\nThanks for your patience.')).toBe(true)
  })

  it('leaves a document that does not start with headers alone', () => {
    expect(stripLeadingHeaders('Plain prose: with a colon inside.')).toBe(
      'Plain prose: with a colon inside.'
    )
  })
})

describe('snippetTerms', () => {
  it('keeps distinct terms of three or more characters, longest first', () => {
    expect(snippetTerms('the Volvo invoice is volvo')).toEqual(['invoice', 'Volvo', 'volvo', 'the'])
    expect(snippetTerms(undefined)).toEqual([])
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

  it('falls back to the opening when no term appears in the chunk', () => {
    const snippet = matchSnippet(EMAIL, 'unrelated')
    expect(snippet.startsWith('Thanks for your patience.')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })
})
