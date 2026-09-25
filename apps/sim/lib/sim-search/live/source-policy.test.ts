import { describe, expect, it } from 'vitest'
import { liveSourcePolicy } from '@/lib/sim-search/live/source-policy'

describe('canonical service source filters', () => {
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
