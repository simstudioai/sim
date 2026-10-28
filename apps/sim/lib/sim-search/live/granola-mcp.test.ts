import { describe, expect, it } from 'vitest'
import { searchGranolaMcp } from '@/lib/sim-search/live/granola-mcp'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'

const meetingId = '11111111-2222-4333-8444-555555555555'

/**
 * Authenticated Granola discovery exposes only preset ranges. Regressions: the implied end date
 * rejects every newest listing; a narrower preset loses meetings; an empty bounded listing is
 * presented as evidence that no older meetings exist. Provider note content remains synthetic.
 */
describe('Granola preset listing coverage', () => {
  it('retrieves meetings beyond this week when custom date arguments are not advertised', async () => {
    const client: ManagedSearchMcpClient = {
      hasArgument: (name, path) => name === 'list_meetings' && path === 'time_range',
      async call(name, args) {
        if (name === 'list_meetings') {
          if (Object.keys(args).some((key) => key !== 'time_range'))
            throw new Error('Granola does not accept custom date arguments')
          return {
            meetings:
              args.time_range === 'last_30_days'
                ? [{ id: meetingId, title: 'Planning', date: '2026-09-10T10:00:00Z' }]
                : [],
          }
        }
        if (name === 'get_meetings')
          return {
            meetings: [
              {
                id: meetingId,
                title: 'Planning',
                date: '2026-09-10T10:00:00Z',
                notes: 'Release approval is pending.',
              },
            ],
          }
        throw new Error('Unexpected Granola operation')
      },
    }
    const result = await searchGranolaMcp(client, {
      query: '',
      limit: 3,
      scopes: [],
      filters: { endDate: '2026-09-26T12:00:00Z', sortBy: 'newest' },
    })
    expect(result.documents.map((document) => document.id)).toEqual([meetingId])
    expect(result.documents[0]?.content).toContain('Release approval is pending.')
    expect(result.partial).toBe(true)
    expect(result.message).toContain('last 30 days')
  })

  it('discloses the preset window when an older date range returns no meeting references', async () => {
    const client: ManagedSearchMcpClient = {
      hasArgument: (name, path) => name === 'list_meetings' && path === 'time_range',
      async call() {
        return { meetings: [] }
      },
    }
    const result = await searchGranolaMcp(client, {
      query: '',
      limit: 3,
      scopes: [],
      filters: { startDate: '2020-01-01T00:00:00Z', endDate: '2020-02-01T00:00:00Z' },
    })
    expect(result.documents).toEqual([])
    expect(result.partial).toBe(true)
    expect(result.message).toContain('last 30 days')
    expect(result.message).toContain('older meetings')
  })
})

/** Real semantic responses can name meeting UUIDs without returning any source URLs. */
describe('Granola semantic meeting references', () => {
  it.each(['Meeting UUID:', '**Meeting UUID:**'])(
    'hydrates the original notes for an explicitly labeled %s instead of returning generated prose',
    async (label) => {
      const client: ManagedSearchMcpClient = {
        async call(name) {
          if (name === 'query_granola_meetings')
            return {
              text: `- ${label} \`${meetingId}\`\n- Original source URL: Not available\n- Notes state: This generated answer is not source evidence.`,
            }
          if (name === 'get_meetings')
            return {
              meetings: [
                {
                  id: meetingId,
                  title: 'Synthetic planning note',
                  private_notes: 'Theo Example owns the rollback drill.',
                },
              ],
            }
          throw new Error('Unexpected Granola operation')
        },
      }
      const result = await searchGranolaMcp(client, {
        query: 'Who owns the rollback drill?',
        limit: 3,
        scopes: [],
      })
      expect(result.documents.map((document) => document.id)).toEqual([meetingId])
      expect(result.documents[0]?.content).toContain('Theo Example owns the rollback drill.')
      expect(result.documents[0]?.content).not.toContain('This generated answer')
      expect(result.partial).toBe(true)
    }
  )
})
