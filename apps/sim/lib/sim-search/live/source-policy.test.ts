/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { liveSourcePolicy } from '@/lib/sim-search/live/source-policy'

describe('canonical service source filters', () => {
  it('preserves Drive text formats and folder ancestry settings', () => {
    expect(
      liveSourcePolicy('google_drive', { folderId: ['folder'], fileType: 'text' })
    ).toMatchObject({
      mode: 'selected',
      included: ['folder'],
      includeSubfolders: true,
      fileTypes: [
        'text/plain',
        'text/csv',
        'text/html',
        'text/markdown',
        'application/json',
        'application/xml',
      ],
    })
  })
  it('keeps Gmail labels and staging category defaults independent of crawl limits', () => {
    expect(liveSourcePolicy('gmail', { label: ['INBOX', 'Support'], maxItems: '1' })).toMatchObject(
      {
        included: ['INBOX', 'Support'],
        excludePromotions: true,
        excludeSocial: true,
      }
    )
    expect(
      liveSourcePolicy('gmail', { excludePromotions: 'false', excludeSocial: 'false' })
    ).toMatchObject({
      mode: 'all',
      excludePromotions: false,
      excludeSocial: false,
    })
  })
  it('defaults Calendar to the delegated primary calendar and preserves attendee suppression', () => {
    expect(liveSourcePolicy('google_calendar', { includeAttendees: 'false' })).toMatchObject({
      included: ['primary'],
      mode: 'selected',
      includeAttendees: false,
    })
  })
  it('binds Confluence space selections to the configured site', () => {
    expect(
      liveSourcePolicy('confluence', { domain: 'https://Company.atlassian.net', spaceKey: '*' })
    ).toMatchObject({
      included: [],
      mode: 'all',
      sites: ['company.atlassian.net'],
    })
    expect(() =>
      liveSourcePolicy('confluence', {
        domain: 'https://company.atlassian.net/private',
        spaceKey: 'ENG',
      })
    ).toThrow()
  })
  it('rejects unsupported integrations and malformed resource selections', () => {
    expect(() => liveSourcePolicy('slack', {})).toThrow('does not support')
    expect(() => liveSourcePolicy('google_drive', { folderId: '../../other' })).toThrow()
    expect(() => liveSourcePolicy('confluence', { domain: 'company.atlassian.net' })).toThrow(
      'Choose Confluence spaces'
    )
    expect(liveSourcePolicy('coda', { docIds: ['one', 'two'] }).included).toEqual(['one', 'two'])
  })
})
