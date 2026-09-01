/**
 * Pins the response-key mappings and Link-header pagination the Circleback tools rely on.
 * Wrong top-level keys fail silently as empty results, and a broken cursor parse would
 * silently end pagination after one page, so both are asserted against realistic payloads.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getMeetingTool } from '@/tools/circleback/get_meeting'
import { listActionItemsTool } from '@/tools/circleback/list_action_items'
import { listMeetingsTool } from '@/tools/circleback/list_meetings'
import { updateActionItemTool } from '@/tools/circleback/update_action_item'
import { mapMeeting, parseNextCursor, toIdList, toStringList } from '@/tools/circleback/utils'

function jsonResponse(body: unknown, init?: { status?: number; link?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: init?.link ? { link: init.link } : undefined,
  })
}

const rawMeeting = {
  id: 'm1',
  name: 'Weekly Sync',
  createdAt: '2026-01-27T15:30:00Z',
  updatedAt: '2026-01-27T16:45:00Z',
  duration: 1800,
  url: 'https://meet.example.com/abc',
  recordingUrl: null,
  tags: [{ id: 1, name: 'Customer', description: null }],
  icalUid: null,
  attendees: [
    {
      profileId: 1,
      name: 'Oat Benson',
      title: null,
      companyName: 'Example',
      email: 'oat@example.com',
      isCalendarEventOrganizer: true,
      isCalendarInvitee: true,
    },
  ],
  notes: '## Recap',
  privateNotes: '',
  actionItems: [
    { id: 10, title: 'Send follow-up', description: '', assignee: null, status: 'PENDING' },
  ],
  insights: {},
  linkAccess: 'Viewer',
  calendarEvent: null,
}

describe('circleback pagination', () => {
  it('extracts the cursor from an RFC 8288 next link', () => {
    const response = jsonResponse([], {
      link: '<https://circleback.ai/api/meetings?ownership=Mine&cursor=cur_2>; rel="next", <https://circleback.ai/api/meetings>; rel="first"',
    })
    expect(parseNextCursor(response)).toBe('cur_2')
  })

  it('resolves a relative next link against the API base', () => {
    const response = jsonResponse([], { link: '</api/meetings?cursor=rel_2>; rel="next"' })
    expect(parseNextCursor(response)).toBe('rel_2')
  })

  it('returns null when there is no next link', () => {
    expect(parseNextCursor(jsonResponse([]))).toBeNull()
    expect(
      parseNextCursor(
        jsonResponse([], { link: '<https://circleback.ai/api/meetings>; rel="prev"' })
      )
    ).toBeNull()
  })

  it('list meetings surfaces the cursor and hasMore from the header', async () => {
    const result = await listMeetingsTool.transformResponse?.(
      jsonResponse([rawMeeting], {
        link: '<https://circleback.ai/api/meetings?cursor=cur_2>; rel="next"',
      }),
      { params: {} } as never
    )

    expect(result?.output.meetings).toHaveLength(1)
    expect(result?.output.meetings[0].id).toBe('m1')
    expect(result?.output.nextCursor).toBe('cur_2')
    expect(result?.output.hasMore).toBe(true)
  })
})

describe('circleback response mapping', () => {
  it('maps the full meeting payload with nullable defaults', () => {
    const mapped = mapMeeting(rawMeeting)
    expect(mapped.name).toBe('Weekly Sync')
    expect(mapped.recordingUrl).toBeNull()
    expect(mapped.tags[0]).toEqual({ id: 1, name: 'Customer', description: null })
    expect(mapped.attendees[0].email).toBe('oat@example.com')
    expect(mapped.actionItems[0].assignee).toBeNull()
    expect(mapped.linkAccess).toBe('Viewer')

    const empty = mapMeeting({})
    expect(empty.id).toBe('')
    expect(empty.tags).toEqual([])
    expect(empty.attendees).toEqual([])
    expect(empty.insights).toEqual({})
  })

  it('get meeting maps the payload as flat output', async () => {
    const result = await getMeetingTool.transformResponse?.(jsonResponse(rawMeeting), {
      params: {},
    } as never)
    expect(result?.output.id).toBe('m1')
    expect(result?.output.notes).toBe('## Recap')
  })

  it('list action items pins the bare-array payload and canEditActionItem', async () => {
    const result = await listActionItemsTool.transformResponse?.(
      jsonResponse([
        {
          id: 10,
          title: 'Send follow-up',
          description: '',
          assignee: null,
          canEditActionItem: true,
          completedAt: null,
          meetingId: 'm1',
          status: 'PENDING',
          meetings: [{ id: 'm1', name: 'Weekly Sync', createdAt: '2026-01-27T15:30:00Z' }],
        },
      ]),
      { params: {} } as never
    )
    expect(result?.output.actionItems).toHaveLength(1)
    expect(result?.output.actionItems[0].canEditActionItem).toBe(true)
    expect(result?.output.actionItems[0].meetings[0].id).toBe('m1')
  })

  it('throws a descriptive error on a failed response', async () => {
    await expect(
      listMeetingsTool.transformResponse?.(
        jsonResponse({ error: 'Invalid cursor', code: 'BAD_REQUEST', issues: [] }, { status: 400 }),
        { params: {} } as never
      )
    ).rejects.toThrow(/Circleback API error \(400\).*Invalid cursor/)
  })
})

describe('circleback request shaping', () => {
  it('builds repeated query params from comma-separated ID lists', () => {
    expect(toIdList('3, oops, 7')).toEqual([3, 7])
    expect(toIdList('[1,2]')).toEqual([1, 2])
    expect(toStringList('a, b,,c')).toEqual(['a', 'b', 'c'])

    const url = new URL(
      (listMeetingsTool.request.url as (p: Record<string, unknown>) => string)({
        apiKey: 'cb_x',
        tagIds: '3,7',
        ownership: 'All',
      })
    )
    expect(url.searchParams.getAll('tagIds')).toEqual(['3', '7'])
    expect(url.searchParams.get('ownership')).toBe('All')
  })

  it('sends null to clear the assignee and numbers otherwise', () => {
    const body = (
      updateActionItemTool.request.body as (p: Record<string, unknown>) => Record<string, unknown>
    )({ apiKey: 'cb_x', actionItemId: '10', assigneeProfileId: 'null' })
    expect(body.assigneeProfileId).toBeNull()

    const assigned = (
      updateActionItemTool.request.body as (p: Record<string, unknown>) => Record<string, unknown>
    )({ apiKey: 'cb_x', actionItemId: '10', assigneeProfileId: '42', status: 'DONE' })
    expect(assigned.assigneeProfileId).toBe(42)
    expect(assigned.status).toBe('DONE')
  })

  it('rejects traversal in path params', () => {
    expect(() =>
      (getMeetingTool.request.url as (p: Record<string, unknown>) => string)({
        apiKey: 'cb_x',
        meetingId: '..',
      })
    ).toThrow(/path traversal/)
  })
})
