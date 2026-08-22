/**
 * @vitest-environment node
 */
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

  it('leaves a spaced title alone, so brand names survive', () => {
    /* Splitting inside a human-written title turns "LinkedIn" into "linked in". */
    expect(noun('LinkedIn Slug')).toBe('a LinkedIn slug')
  })

  it('keeps a word the author capitalised whole', () => {
    /* Trusting the title beats maintaining a list of every acronym in use. */
    expect(noun('MCP Server')).toBe('an MCP server')
    expect(noun('SKU')).toBe('a SKU')
  })

  it('keeps a pluralised initialism readable', () => {
    expect(noun('Calendar IDs')).toBe('calendar IDs')
    expect(noun('Webhook URLs')).toBe('webhook URLs')
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

  it('gives a plural noun no article', () => {
    expect(noun('Recipients')).toBe('recipients')
    expect(noun('Labels')).toBe('labels')
  })

  it('does not mistake a singular ending in s for a plural', () => {
    expect(noun('Status')).toBe('a status')
    expect(noun('Address')).toBe('an address')
    expect(noun('Business')).toBe('a business')
  })

  it('falls back when a title is missing entirely', () => {
    expect(resolveFieldNoun({ title: undefined })).toBe('a value')
    expect(noun('   ')).toBe('a value')
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

  it('does not treat an all-caps word read as a word as an initialism', () => {
    /* `MERGE` and `HEAD` are HTTP verbs — "a MERGE request". */
    expect(articleFor('MERGE')).toBe('a')
    expect(articleFor('HEAD')).toBe('a')
  })

  it('handles the URL family, which is spelled vowel-first but read as "you"', () => {
    expect(articleFor('URL')).toBe('a')
    expect(articleFor('UUID')).toBe('a')
  })
})
