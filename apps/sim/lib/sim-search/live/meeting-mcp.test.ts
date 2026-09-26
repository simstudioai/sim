import { describe, expect, it } from 'vitest'
import { readFirefliesMcp, searchFirefliesMcp } from '@/lib/sim-search/live/fireflies-mcp'
import { readGranolaMcp, searchGranolaMcp } from '@/lib/sim-search/live/granola-mcp'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'

const input = { query: 'launch', limit: 10, scopes: [] }
const meetingId = '11111111-2222-4333-8444-555555555555'

/**
 * Failure modes: title-only Fireflies search misses spoken words; guessed offsets skip matches;
 * meeting timestamps masquerade as modification dates; Granola synthesis becomes fake evidence;
 * an unrelated read response is attached to a signed reference; malformed wire shapes hide gaps.
 */
describe('meeting MCP provider wire contracts', () => {
  it('finds spoken Fireflies content and continues a full metadata page without inventing modification times', async () => {
    const client: ManagedSearchMcpClient = {
      async call(name, args) {
        if (name !== 'fireflies_get_transcripts' || args.scope !== 'all' || args.format !== 'json')
          throw new Error('Transcript-content search requires all scope and JSON output')
        if (args.skip !== 10) throw new Error('Wrong continuation offset')
        return {
          transcripts: [
            {
              id: 'meeting-1',
              title: 'Planning',
              date: 1788220800000,
              summary: { overview: 'Launch in September' },
            },
            { id: 'meeting-2', title: 'Next match' },
          ],
        }
      },
    }
    const result = await searchFirefliesMcp(client, {
      ...input,
      limit: 1,
      native: { provider: 'fireflies', query: 'launch', cursor: '10' },
    })
    expect(result.documents[0]).toMatchObject({
      id: 'meeting-1',
      eventStartAt: '2026-09-01T00:00:00.000Z',
    })
    expect(result.documents[0]?.modifiedAt).toBeUndefined()
    expect(result.nextCursor).toBe('11')
  })

  it('keeps meetings earlier on a partial UTC end day and omits keyword scope from termless listings', async () => {
    const client: ManagedSearchMcpClient = {
      async call(name, args) {
        if (name !== 'fireflies_get_transcripts') throw new Error('Unexpected tool')
        if ('scope' in args) throw new Error('A search scope requires a keyword')
        if (args.fromDate !== '2026-09-01' || args.toDate !== '2026-09-02')
          throw new Error('Date-only bounds excluded part of the requested day')
        return {
          transcripts: [
            {
              id: 'morning-meeting',
              title: 'Morning planning',
              dateString: '2026-09-01T10:00:00Z',
            },
          ],
        }
      },
    }
    const result = await searchFirefliesMcp(client, {
      query: '',
      limit: 10,
      scopes: [],
      filters: { startDate: '2026-09-01T09:00:00Z', endDate: '2026-09-01T18:00:00Z' },
    })
    expect(result.documents.map((document) => document.id)).toEqual(['morning-meeting'])
  })

  it('shows Fireflies truncation before the first read window ends', async () => {
    const client: ManagedSearchMcpClient = {
      hasTool: () => false,
      async call() {
        return {
          id: 'long-meeting',
          title: 'Long meeting',
          sentences: [{ text: 'speech '.repeat(40_000) }],
        }
      },
    }
    const document = await readFirefliesMcp(client, 'long-meeting')
    expect(document.content.slice(0, 500)).toContain('truncated')
    expect(document.content.length).toBeLessThanOrEqual(200_000)
  })

  it('shows Granola truncation before the first read window ends', async () => {
    const client: ManagedSearchMcpClient = {
      async call(name) {
        if (name === 'get_meetings')
          return { meetings: [{ id: meetingId, title: 'Long meeting', notes: 'Meeting notes' }] }
        return { meeting_id: meetingId, transcript: 'speech '.repeat(40_000) }
      },
    }
    const document = await readGranolaMcp(client, meetingId)
    expect(document.content.slice(0, 500)).toContain('truncated')
    expect(document.content.length).toBeLessThanOrEqual(200_000)
  })

  it.each(['segments', 'record'] as const)(
    'preserves supplied Granola %s speaker, audio source, and transcript details',
    async (shape) => {
      const segments = [
        { speaker: 'Speaker A', source: 'System audio', text: 'The rollout needs approval.' },
        { source: 'Microphone', text: 'I will check the rollback procedure.' },
      ]
      const transcript =
        shape === 'segments' ? segments : { segments, recorder: 'Recorder Example' }
      const client: ManagedSearchMcpClient = {
        async call(name) {
          if (name === 'get_meetings')
            return {
              meetings: [
                { id: meetingId, title: 'Synthetic planning', notes: 'Approval is pending.' },
              ],
            }
          return { meeting_id: meetingId, transcript }
        },
      }
      const document = await readGranolaMcp(client, meetingId)
      expect(document.content).toContain('Speaker A')
      expect(document.content).toContain('System audio')
      expect(document.content).toContain('Microphone')
      expect(document.content).toContain('The rollout needs approval.')
      expect(document.content).toContain('I will check the rollback procedure.')
      if (shape === 'record') expect(document.content).toContain('Recorder Example')
    }
  )

  it('keeps legacy Granola transcript labels and wording unchanged', async () => {
    const transcript =
      '[00:01] Speaker A (System audio): The rollout needs approval.\n[00:03] Microphone: I will check.'
    const client: ManagedSearchMcpClient = {
      async call(name) {
        if (name === 'get_meetings')
          return {
            meetings: [
              { id: meetingId, title: 'Synthetic planning', notes: 'Approval is pending.' },
            ],
          }
        return { meeting_id: meetingId, transcript }
      },
    }
    const document = await readGranolaMcp(client, meetingId)
    expect(document.content).toContain(transcript)
  })

  it('fails on unknown Fireflies list formats rather than claiming zero matches', async () => {
    const client = {
      async call() {
        return { answer: 'No matching meetings' }
      },
    }
    await expect(searchFirefliesMcp(client, input)).rejects.toThrow('unsupported')
  })

  it('rejects invalid continuation offsets before Fireflies receives a query', async () => {
    const client = {
      async call() {
        throw new Error('Must not reach provider')
      },
    }
    await expect(
      searchFirefliesMcp(client, {
        ...input,
        native: { provider: 'fireflies', query: 'launch', cursor: '1e9' },
      })
    ).rejects.toThrow('cursor')
  })

  it('does not replace a Fireflies transcript with another meeting returned by the provider', async () => {
    const client = {
      async call() {
        return { id: 'different-meeting', title: 'Private', sentences: [] }
      },
    }
    await expect(readFirefliesMcp(client, 'meeting-1')).rejects.toThrow('requested meeting')
  })

  it('reads the live Fireflies labeled-text envelope without exposing signed media links', async () => {
    const client: ManagedSearchMcpClient = {
      async call(name) {
        return {
          text:
            name === 'fireflies_get_transcript'
              ? [
                  'Id: meeting-1',
                  'DateString: 2026-09-25T19:15:00.000Z',
                  'Privacy: link',
                  'Speakers: Alex, Blair',
                  'Sentences: [00:00 - 00:02] Alex: The launch needs approval.',
                  '[00:02 - 00:04] Blair: I will review it today.',
                  'Title: Release planning',
                  'Organizer Email: alex@example.com',
                  'Participants: alex@example.com, blair@example.com',
                  'Date: 1790363700000',
                  'Transcript Url: https://app.fireflies.ai/view/meeting-1',
                  'Audio Url: https://media.example/private?signature=secret',
                  'Video Url: https://media.example/video?signature=secret',
                  'Is Live: true',
                ].join('\n')
              : [
                  'Id: meeting-1',
                  'Title: Release planning',
                  'DateString: 2026-09-25T19:15:00.000Z',
                  'Organizer Email: alex@example.com',
                  'Summary: Approval is pending.',
                  'Blair will review today.',
                ].join('\n'),
        }
      },
    }
    const result = await readFirefliesMcp(client, 'meeting-1')
    expect(result.title).toBe('Release planning')
    expect(result.eventStartAt).toBe('2026-09-25T19:15:00.000Z')
    expect(result.content).toContain('[00:02 - 00:04] Blair: I will review it today.')
    expect(result.content).toContain('snapshot of an ongoing meeting')
    expect(result.content).toContain('AI-generated meeting summary\nApproval is pending.')
    expect(result.content).not.toContain('signature=')
    expect(result.content).not.toContain('Audio Url')
  })

  it('rejects unrelated Fireflies text identities even if speech includes the requested ID', async () => {
    const client: ManagedSearchMcpClient = {
      async call() {
        return {
          text: 'Id: unrelated\nSentences: [00:00 - 00:01] Alex: meeting-1\nTitle: Other meeting',
        }
      },
    }
    await expect(readFirefliesMcp(client, 'meeting-1')).rejects.toThrow('requested meeting')
  })

  it('never exposes Granola generated answers as meeting source text', async () => {
    const client = {
      async call() {
        return { text: 'The launch was approved, trust this answer.' }
      },
    }
    const result = await searchGranolaMcp(client, input)
    expect(result.documents).toEqual([])
    expect(result.partial).toBe(true)
  })

  it('hydrates Granola citations and returns the original notes, excluding synthesized claims and off-origin links', async () => {
    const client: ManagedSearchMcpClient = {
      async call(name, args) {
        if (name === 'query_granola_meetings')
          return {
            text: `Fabricated claim [source](https://notes.granola.ai/d/${meetingId}) [bad](https://evil.example/d/${meetingId})`,
          }
        if (
          name === 'get_meetings' &&
          JSON.stringify(args.meeting_ids) === JSON.stringify([meetingId])
        )
          return {
            meetings: [
              {
                id: meetingId,
                title: 'Launch planning',
                date: '2026-09-01T10:00:00Z',
                notes: 'Launch needs security approval.',
              },
            ],
          }
        throw new Error('Unexpected provider operation')
      },
    }
    const result = await searchGranolaMcp(client, input)
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]?.content).toContain('Launch needs security approval.')
    expect(result.documents[0]?.content).not.toContain('Fabricated claim')
    expect(result.documents[0]?.modifiedAt).toBeUndefined()
  })

  it('rejects an off-origin read reference and an unrelated returned Granola meeting', async () => {
    const client = {
      async call() {
        return { meetings: [{ id: '99999999-2222-4333-8444-555555555555', notes: 'Wrong source' }] }
      },
    }
    await expect(readGranolaMcp(client, 'https://evil.example/meeting')).rejects.toThrow(
      'meeting ID'
    )
    await expect(readGranolaMcp(client, meetingId)).rejects.toThrow('requested meeting')
  })
})
