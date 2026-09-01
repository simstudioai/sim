/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getTwilioRecording: vi.fn() }))

vi.mock('@/lib/internal/twilio-voice/operations', () => ({
  getTwilioRecording: mocks.getTwilioRecording,
}))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { executeTwilioVoiceTool } from '@/lib/internal/twilio-voice/execute-tool'

describe('executeTwilioVoiceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTwilioRecording.mockResolvedValue({ success: true, output: { success: true } })
  })

  it('dispatches typed input with cancellation', async () => {
    const controller = new AbortController()
    const input = { accountSid: 'AC123', authToken: 'secret', recordingSid: 'RE123' }
    const request: InternalToolOperationCall = {
      toolId: 'twilio_voice_get_recording',
      input,
      headers: new Headers(),
      context: createExecutionContext(),
      requestId: 'request-1',
      signal: controller.signal,
    }

    expect((await executeTwilioVoiceTool(request)).status).toBe(200)
    expect(mocks.getTwilioRecording).toHaveBeenCalledWith(input, {
      requestId: 'request-1',
      signal: controller.signal,
    })
  })
})
