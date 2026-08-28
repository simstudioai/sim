/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { zoomGetMeetingRecordingsTool } from '@/tools/zoom/get_meeting_recordings'

describe('Zoom recording operation declaration', () => {
  it('contains typed operation input and no HTTP metadata', () => {
    expect(zoomGetMeetingRecordingsTool.operation).toBeDefined()
    expect('request' in zoomGetMeetingRecordingsTool).toBe(false)
  })
})
