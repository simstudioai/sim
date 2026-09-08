/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getCredentialGroupIndexingConnector } from '@/lib/credential-groups/indexing'

describe('connected account indexing capabilities', () => {
  it.each([
    ['gmail', 'gmail'],
    ['google-drive', 'google_drive'],
    ['google-calendar', 'google_calendar'],
    ['github-repositories', 'github'],
    ['confluence', 'confluence'],
    ['jira', 'jira'],
    ['slack', 'slack'],
  ] as const)('uses the permission-aware connector registry for %s', (provider, type) => {
    expect(getCredentialGroupIndexingConnector(provider)?.type).toBe(type)
  })
  it.each(['notion', 'outlook', 'hubspot'] as const)(
    'does not advertise generic KB ingestion as per-person indexing for %s',
    (provider) => {
      expect(getCredentialGroupIndexingConnector(provider)).toBeUndefined()
    }
  )
})
