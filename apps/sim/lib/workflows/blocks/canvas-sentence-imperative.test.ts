/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { toImperativeLead } from '@/lib/workflows/blocks/canvas-sentence-imperative'

describe('toImperativeLead', () => {
  it('drops the third-person -s', () => {
    expect(toImperativeLead('Lists channels')).toBe('List channels')
    expect(toImperativeLead('Sends')).toBe('Send')
    expect(toImperativeLead('Marks message')).toBe('Mark message')
  })

  it('reverts -ies to -y rather than truncating', () => {
    expect(toImperativeLead('Copies file')).toBe('Copy file')
    expect(toImperativeLead('Queries rows from')).toBe('Query rows from')
    expect(toImperativeLead('Identifies the sender')).toBe('Identify the sender')
  })

  it('keeps the base of a -ys verb, which is not an -ies inflection', () => {
    expect(toImperativeLead('Pays invoice')).toBe('Pay invoice')
    expect(toImperativeLead('Deploys')).toBe('Deploy')
  })

  it('drops the whole -es where it attaches to a non-e base', () => {
    expect(toImperativeLead('Fetches thread')).toBe('Fetch thread')
    expect(toImperativeLead('Searches messages matching')).toBe('Search messages matching')
    expect(toImperativeLead('Pushes')).toBe('Push')
    expect(toImperativeLead('Indexes')).toBe('Index')
    expect(toImperativeLead('Compresses')).toBe('Compress')
  })

  it('keeps the e on a base that already ends in one', () => {
    /* The -zes/-ses trap: dropping `es` here yields "Analyz" and "Eras". */
    expect(toImperativeLead('Analyzes')).toBe('Analyze')
    expect(toImperativeLead('Summarizes')).toBe('Summarize')
    expect(toImperativeLead('Erases')).toBe('Erase')
    expect(toImperativeLead('Closes')).toBe('Close')
    expect(toImperativeLead('Merges')).toBe('Merge')
  })

  it('finds the verb behind a leading modifier', () => {
    expect(toImperativeLead('Permanently deletes agent')).toBe('Permanently delete agent')
    expect(toImperativeLead('Bulk inserts rows into')).toBe('Bulk insert rows into')
    expect(toImperativeLead('Batch triggers task')).toBe('Batch trigger task')
    expect(toImperativeLead('Full-text searches')).toBe('Full-text search')
  })

  it('inflects a hyphenated verb as one word', () => {
    expect(toImperativeLead('Bulk-imports accounts from')).toBe('Bulk-import accounts from')
  })

  it('leaves an imperative lead untouched, so the rewrite doubles as the check', () => {
    expect(toImperativeLead('List channels')).toBe('List channels')
    expect(toImperativeLead('Permanently delete agent')).toBe('Permanently delete agent')
    expect(toImperativeLead('Run on Pull Request Opened')).toBe('Run on Pull Request Opened')
  })

  it('does not mistake the plural noun after an imperative verb for the verb', () => {
    /* Scanning past word one without a modifier would give "Set label". */
    expect(toImperativeLead('Set labels')).toBe('Set labels')
    expect(toImperativeLead('Add tags to')).toBe('Add tags to')
  })

  it('leaves a base form that already ends in s alone', () => {
    expect(toImperativeLead('Process rows')).toBe('Process rows')
    expect(toImperativeLead('Focus on')).toBe('Focus on')
  })

  it('handles a sentence with no leading copy', () => {
    expect(toImperativeLead('')).toBe('')
  })
})
