import { describe, expect, it } from 'vitest'
import { mergeSuggestionSources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/url-suggestions'

describe('debug', () => {
  it('single credential + single site', () => {
    const merged = mergeSuggestionSources(
      [],
      [
        {
          id: 'a',
          origin: 'https://github.com',
          username: 'u',
          createdAt: '2026-07-27T10:00:00.000Z',
          updatedAt: '2026-07-27T10:00:00.000Z',
          source: 'chrome',
        },
      ],
      [
        {
          hostname: 'github.com',
          name: 'GitHub',
          visits: 900,
          importedAt: '2026-07-27T10:00:00.000Z',
        },
      ]
    )
    expect(JSON.stringify(merged)).toBe('SHOW_ME')
  })
})
