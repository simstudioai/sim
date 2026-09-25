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

  it('finds the verb behind a leading modifier', () => {
    expect(toImperativeLead('Permanently deletes agent')).toBe('Permanently delete agent')
    expect(toImperativeLead('Bulk inserts rows into')).toBe('Bulk insert rows into')
    expect(toImperativeLead('Batch triggers task')).toBe('Batch trigger task')
    expect(toImperativeLead('Full-text searches')).toBe('Full-text search')
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
})
