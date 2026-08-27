/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getZoomMeetingRecordings: vi.fn() }))

vi.mock('@/lib/internal/zoom/operations', () => ({
  getZoomMeetingRecordings: mocks.getZoomMeetingRecordings,
}))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { ZoomOperationError } from '@/lib/internal/zoom/errors'
import { executeZoomTool } from '@/lib/internal/zoom/execute-tool'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'zoom_get_meeting_recordings',
    input: { accessToken: 'token', meetingId: 'meeting-1' },
    headers: new Headers(),
    context: createExecutionContext({ workflowId: 'workflow-1' }),
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeZoomTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getZoomMeetingRecordings.mockResolvedValue({
      success: true,
      output: { recording: { recording_files: [] } },
    })
  })

  it('dispatches with defaults and the operation signal', async () => {
    const controller = new AbortController()
    const response = await executeZoomTool(request({ signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(mocks.getZoomMeetingRecordings).toHaveBeenCalledWith(
      { accessToken: 'token', meetingId: 'meeting-1', downloadFiles: false },
      { requestId: 'request-1', signal: controller.signal }
    )
  })

  it('preserves operation statuses', async () => {
    mocks.getZoomMeetingRecordings.mockRejectedValue(new ZoomOperationError('too large', 413))

    const response = await executeZoomTool(request())

    expect(response.status).toBe(413)
  })
})
