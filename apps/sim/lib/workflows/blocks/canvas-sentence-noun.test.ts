import { describe, expect, it } from 'vitest'
import { articleFor, resolveFieldNoun } from '@/lib/workflows/blocks/canvas-sentence-noun'

const noun = (title: string, canvasNoun?: string) => resolveFieldNoun({ title, canvasNoun })

describe('resolveFieldNoun', () => {
  it('lowers a title into running prose with its article', () => {
    expect(noun('Channel')).toBe('a channel')
    expect(noun('Email Address')).toBe('an email address')
  })

  it('prefers an explicit canvasNoun over anything derived', () => {
    /* The escape hatch for titles no rule can rescue. */
    expect(noun('Message ID to Reply To', 'a message')).toBe('a message')
  })

  it('drops the parenthetical hint a form label carries', () => {
    expect(noun('Radius (meters)')).toBe('a radius')
    expect(noun('Table Name (optional)')).toBe('a table name')
    expect(noun('Attendees (comma-separated emails)')).toBe('attendees')
  })

  it('drops the imperative a picker label opens with', () => {
    /* Otherwise every selector reads "posts to ⟨a select channel⟩". */
    expect(noun('Select Channel')).toBe('a channel')
    expect(noun('Choose Spreadsheet')).toBe('a spreadsheet')
  })

  it('splits a spaceless API identifier into words', () => {
    expect(noun('SalesOrderType')).toBe('a sales order type')
    expect(noun('HTTPMethod')).toBe('an HTTP method')
  })

  it('treats a pluralised initialism as plural, not as a Latin singular', () => {
    /*
     * `-us`/`-is` marks a Latin singular (radius, analysis), but `URIs` and
     * `APIs` end the same way. Matching them gave "a track URIs", and the
     * camelCase splitter compounded it by reading `APIs` as `AP` + `Is`.
     */
    expect(noun('Track URIs')).toBe('track URIs')
    expect(noun('APIs')).toBe('APIs')
    expect(noun('SKUs')).toBe('SKUs')
    expect(noun('KPIs')).toBe('KPIs')
  })
})

describe('articleFor', () => {
  it('agrees with the sound, not the spelling', () => {
    expect(articleFor('user')).toBe('a')
    expect(articleFor('one-time budget')).toBe('a')
    expect(articleFor('hour')).toBe('an')
    expect(articleFor('email')).toBe('an')
  })

  it('reads an initialism letter by letter', () => {
    expect(articleFor('SMS')).toBe('an')
    expect(articleFor('MCP')).toBe('an')
  })
})
