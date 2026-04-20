/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAsyncToolCall,
  getRunSegment,
  upsertAsyncToolCall,
  completeAsyncToolCall,
  publishToolConfirmation,
} = vi.hoisted(() => ({
  getAsyncToolCall: vi.fn(),
  getRunSegment: vi.fn(),
  upsertAsyncToolCall: vi.fn(),
  completeAsyncToolCall: vi.fn(),
  publishToolConfirmation: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getAsyncToolCall,
  getRunSegment,
  upsertAsyncToolCall,
  completeAsyncToolCall,
}))

vi.mock('@/lib/copilot/persistence/tool-confirm', () => ({
  publishToolConfirmation,
}))

import { POST } from './route'

describe('Copilot Confirm API Route', () => {
  const existingRow = {
    toolCallId: 'tool-call-123',
    runId: 'run-1',
    checkpointId: 'checkpoint-1',
    toolName: 'client_tool',
    args: { foo: 'bar' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    getAsyncToolCall.mockResolvedValue(existingRow)
    getRunSegment.mockResolvedValue({ id: 'run-1', userId: 'user-1' })
    upsertAsyncToolCall.mockResolvedValue(existingRow)
    completeAsyncToolCall.mockResolvedValue(existingRow)
  })

  function createMockPostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost:3000/api/copilot/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('returns 401 when the session is unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: null,
      isAuthenticated: false,
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when the tool call row does not exist', async () => {
    getAsyncToolCall.mockResolvedValue(null)

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'missing-tool',
        status: 'success',
      })
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Tool call not found' })
  })

  it('returns 403 when the tool call belongs to a different user', async () => {
    getRunSegment.mockResolvedValue({ id: 'run-1', userId: 'user-2' })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })

  it('persists terminal confirmations through completeAsyncToolCall', async () => {
    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
        message: 'Tool executed successfully',
        data: { ok: true },
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'completed',
      result: { ok: true },
      error: null,
    })
    expect(upsertAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-123',
        status: 'success',
        data: { ok: true },
      })
    )
  })

  it('accepts primitive terminal confirmation data', async () => {
    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
        message: 'Tool executed successfully',
        data: 'done',
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'completed',
      result: 'done',
      error: null,
    })
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-123',
        status: 'success',
        data: 'done',
      })
    )
  })

  it('keeps background as a live pending detach confirmation', async () => {
    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'background',
      })
    )

    expect(response.status).toBe(200)
    expect(upsertAsyncToolCall).not.toHaveBeenCalled()
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-123',
        status: 'background',
      })
    )
  })

  it('rejects unsupported accepted and rejected confirmation statuses', async () => {
    const acceptedResponse = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'accepted',
      })
    )

    expect(acceptedResponse.status).toBe(400)
    expect(await acceptedResponse.json()).toEqual({
      error: 'Invalid request data: Invalid notification status',
    })

    const rejectedResponse = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'rejected',
      })
    )

    expect(rejectedResponse.status).toBe(400)
    expect(await rejectedResponse.json()).toEqual({
      error: 'Invalid request data: Invalid notification status',
    })
  })

  it('returns 400 when the durable write fails before publish', async () => {
    completeAsyncToolCall.mockRejectedValueOnce(new Error('db down'))

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })
    )

    expect(response.status).toBe(400)
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })
})
