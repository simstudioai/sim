import { describe, expect, it } from 'vitest'
import { zoomDeleteRecordingTool } from '@/tools/zoom/delete_recording'
import { zoomListPastParticipantsTool } from '@/tools/zoom/list_past_participants'

function requestUrl<P>(tool: { request: { url: string | ((params: P) => string) } }, params: P) {
  const { url } = tool.request
  return typeof url === 'function' ? url(params) : url
}

describe('Zoom meeting UUID path encoding', () => {
  it('double encodes a UUID with a slash for past participants', () => {
    expect(
      requestUrl(zoomListPastParticipantsTool, { accessToken: 't', meetingId: 'ab/cd==' })
    ).toBe('https://api.zoom.us/v2/past_meetings/ab%252Fcd%253D%253D/participants')
  })

  it('double encodes a UUID that starts with a slash for recording deletes', () => {
    expect(requestUrl(zoomDeleteRecordingTool, { accessToken: 't', meetingId: '/ajXp112==' })).toBe(
      'https://api.zoom.us/v2/meetings/%252FajXp112%253D%253D/recordings'
    )
  })

  it('encodes numeric IDs and plain UUIDs once', () => {
    expect(
      requestUrl(zoomDeleteRecordingTool, { accessToken: 't', meetingId: '85746065432' })
    ).toBe('https://api.zoom.us/v2/meetings/85746065432/recordings')
    expect(
      requestUrl(zoomListPastParticipantsTool, { accessToken: 't', meetingId: 'aBc+d==' })
    ).toBe('https://api.zoom.us/v2/past_meetings/aBc%2Bd%3D%3D/participants')
  })
})
